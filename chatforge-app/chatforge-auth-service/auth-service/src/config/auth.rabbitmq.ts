import amqp, { SimpleConnection, SimpleChannel } from 'amqplib';
import { env, isDevelopment } from './auth.env';
import { logger } from '../utils/auth.logger.utils';

export interface RabbitMQMessage {
  eventId: string;
  eventType: string;
  timestamp: number;
  data: object;
}

class RabbitMQConnection {
  private static instance: RabbitMQConnection;
  private connection: SimpleConnection | null = null;
  private channel: SimpleChannel | null = null;
  private isConnected = false;
  private connectionRetries = 0;
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000; // 5 seconds

  

  // Queue and Exchange configurations
  private readonly exchanges = {
    auth: env.RABBITMQ_EXCHANGE,
    dlx: `${env.RABBITMQ_EXCHANGE}.dlx` // Dead Letter Exchange
  };

  private readonly queues = {
    userCreated: 'auth.user.created',
    otpGenerated: 'auth.otp.generated',
    passwordResetRequested: 'auth.password.reset.requested',
    emailResponse: 'auth.email.response'
  };

  private readonly routingKeys = {
    userCreated: 'user.created',
    otpGenerated: 'otp.generated',
    passwordResetRequested: 'password.reset.requested',
    emailResponse: 'email.response'
  };

  private constructor() {}

  public static getInstance(): RabbitMQConnection {
    if (!RabbitMQConnection.instance) {
      RabbitMQConnection.instance = new RabbitMQConnection();
    }
    return RabbitMQConnection.instance;
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      logger.info('RabbitMQ already connected');
      return;
    }

    try {
      // Create connection
      this.connection = await amqp.connect(env.RABBITMQ_URL);
      
      // Setup connection event listeners
      this.setupConnectionEventListeners();

      // Create channel
      this.channel = await this.connection.createChannel();
      
      // Setup channel event listeners
      this.setupChannelEventListeners();

      // Set prefetch for better message distribution
      await this.channel.prefetch(10);

      // Setup exchanges and queues
      await this.setupInfrastructure();

      this.isConnected = true;
      this.connectionRetries = 0;

      logger.info('RabbitMQ connected successfully', {
        url: this.maskUrl(env.RABBITMQ_URL),
        exchange: env.RABBITMQ_EXCHANGE
      });

    } catch (error) {
      logger.error('RabbitMQ connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        retryAttempt: this.connectionRetries + 1,
        maxRetries: this.maxRetries
      });

      await this.handleConnectionError();
    }
  }

  private setupConnectionEventListeners(): void {
    if (!this.connection) return;

    this.connection.on('error', (error:any) => {
      this.isConnected = false;
      logger.error('RabbitMQ connection error', {
        error: error.message
      });
    });

    this.connection.on('close', () => {
      this.isConnected = false;
      logger.warn('RabbitMQ connection closed');
    });

    // Handle application termination
    process.on('SIGINT', async () => {
      await this.disconnect();
    });

    process.on('SIGTERM', async () => {
      await this.disconnect();
    });
  }

  private setupChannelEventListeners(): void {
    if (!this.channel) return;

    this.channel.on('error', (error:any) => {
      logger.error('RabbitMQ channel error', {
        error: error.message
      });
    });

    this.channel.on('close', () => {
      logger.warn('RabbitMQ channel closed');
    });
  }

  private async setupInfrastructure(): Promise<void> {
    if (!this.channel) throw new Error('Channel not available');

    try {
      // Declare main exchange
      await this.channel.assertExchange(this.exchanges.auth, 'topic', {
        durable: true
      });

      // Declare dead letter exchange
      await this.channel.assertExchange(this.exchanges.dlx, 'direct', {
        durable: true
      });

      // Declare dead letter queue
      await this.channel.assertQueue('auth.dlq', {
        durable: true
      });

      // Bind dead letter queue to dead letter exchange
      await this.channel.bindQueue('auth.dlq', this.exchanges.dlx, 'failed');

      // Declare producer queues (for outgoing messages to email service)
      await this.declareProducerQueues();

      // Declare consumer queues (for incoming messages from email service)
      await this.declareConsumerQueues();

      logger.info('RabbitMQ infrastructure setup completed');

    } catch (error) {
      logger.error('Failed to setup RabbitMQ infrastructure', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async declareProducerQueues(): Promise<void> {
    if (!this.channel) return;

    const queueOptions = {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchanges.dlx,
        'x-dead-letter-routing-key': 'failed',
        'x-message-ttl': 86400000 // 24 hours
      }
    };

    // User Created Queue
    await this.channel.assertQueue(this.queues.userCreated, queueOptions);
    await this.channel.bindQueue(this.queues.userCreated, this.exchanges.auth, this.routingKeys.userCreated);

    // OTP Generated Queue
    await this.channel.assertQueue(this.queues.otpGenerated, queueOptions);
    await this.channel.bindQueue(this.queues.otpGenerated, this.exchanges.auth, this.routingKeys.otpGenerated);

    // Password Reset Requested Queue
    await this.channel.assertQueue(this.queues.passwordResetRequested, queueOptions);
    await this.channel.bindQueue(this.queues.passwordResetRequested, this.exchanges.auth, this.routingKeys.passwordResetRequested);
  }

  private async declareConsumerQueues(): Promise<void> {
    if (!this.channel) return;

    const queueOptions = {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchanges.dlx,
        'x-dead-letter-routing-key': 'failed'
      }
    };

    // Email Response Queue (for responses from email service)
    await this.channel.assertQueue(this.queues.emailResponse, queueOptions);
    await this.channel.bindQueue(this.queues.emailResponse, this.exchanges.auth, this.routingKeys.emailResponse);
  }

  private async handleConnectionError(): Promise<void> {
    if (this.connectionRetries < this.maxRetries) {
      this.connectionRetries++;
      
      logger.info(`Retrying RabbitMQ connection in ${this.retryDelay / 1000} seconds...`, {
        attempt: this.connectionRetries,
        maxRetries: this.maxRetries
      });

      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      await this.connect();
    } else {
      logger.error('RabbitMQ connection failed after maximum retry attempts', {
        maxRetries: this.maxRetries
      });
      
      if (!isDevelopment) {
        process.exit(1);
      }
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.isConnected = false;
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  public async publishMessage(
    routingKey: keyof typeof this.routingKeys,
    data: object,
    options: {
      eventId: string;
      eventType: string;
      priority?: number;
      persistent?: boolean;
    }
  ): Promise<void> {
    if (!this.channel || !this.isConnected) {
      throw new Error('RabbitMQ not connected');
    }

    const message: RabbitMQMessage = {
      eventId: options.eventId,
      eventType: options.eventType,
      timestamp: Date.now(),
      data
    };

    const messageBuffer = Buffer.from(JSON.stringify(message));
    
    const publishOptions = {
      persistent: options.persistent ?? true,
      priority: options.priority ?? 0,
      timestamp: Date.now(),
      messageId: options.eventId,
      headers: {
        eventType: options.eventType,
        source: 'auth-service'
      }
    };

    try {
      const published = this.channel.publish(
        this.exchanges.auth,
        this.routingKeys[routingKey],
        messageBuffer,
        publishOptions
      );

      if (!published) {
        logger.warn('Message might not have been routed', {
          routingKey,
          eventId: options.eventId
        });
      }

      logger.debug('Message published successfully', {
        routingKey,
        eventId: options.eventId,
        eventType: options.eventType
      });

    } catch (error) {
      logger.error('Failed to publish message', {
        routingKey,
        eventId: options.eventId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  public async consumeMessages(
    queueName: keyof typeof this.queues,
    handler: (message: RabbitMQMessage) => Promise<void>,
    options: {
      noAck?: boolean;
      exclusive?: boolean;
    } = {}
  ): Promise<void> {
    if (!this.channel || !this.isConnected) {
      throw new Error('RabbitMQ not connected');
    }

    try {
      await this.channel.consume(
        this.queues[queueName],
        async (msg:any) => {
          if (!msg) return;

          try {
            const message: RabbitMQMessage = JSON.parse(msg.content.toString());
            
            logger.debug('Message received', {
              queue: queueName,
              eventId: message.eventId,
              eventType: message.eventType
            });

            await handler(message);

            if (!options.noAck) {
              this.channel!.ack(msg);
            }

            logger.debug('Message processed successfully', {
              queue: queueName,
              eventId: message.eventId
            });

          } catch (error) {
            logger.error('Failed to process message', {
              queue: queueName,
              error: error instanceof Error ? error.message : 'Unknown error'
            });

            if (!options.noAck) {
              // Reject and don't requeue to send to DLX
              this.channel!.nack(msg, false, false);
            }
          }
        },
        {
          noAck: options.noAck ?? false,
          exclusive: options.exclusive ?? false
        }
      );

      logger.info(`Started consuming messages from queue: ${this.queues[queueName]}`);

    } catch (error) {
      logger.error('Failed to setup consumer', {
        queue: queueName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    details: {
      connected: boolean;
      channelCount?: number;
    };
  }> {
    try {
      if (!this.connection || !this.isConnected) {
        return {
          status: 'unhealthy',
          details: {
            connected: false
          }
        };
      }

      // Check if we can create a temporary channel
      const tempChannel = await this.connection.createChannel();
      await tempChannel.close();

      return {
        status: 'healthy',
        details: {
          connected: true,
          channelCount: 1 // We maintain one main channel
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          connected: false
        }
      };
    }
  }

  public getQueues() {
    return this.queues;
  }

  public getRoutingKeys() {
    return this.routingKeys;
  }

  public getExchanges() {
    return this.exchanges;
  }

  public isConnectedStatus(): boolean {
    return this.isConnected;
  }

  private maskUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      if (urlObj.password) {
        urlObj.password = '***';
      }
      return urlObj.toString();
    } catch {
      return url;
    }
  }
}

// Export singleton instance
export const rabbitmq = RabbitMQConnection.getInstance();

// Helper functions for easy import
export const connectRabbitMQ = () => rabbitmq.connect();
export const disconnectRabbitMQ = () => rabbitmq.disconnect();
export const publishMessage = (routingKey: any, data: object, options: any) => 
  rabbitmq.publishMessage(routingKey, data, options);
export const consumeMessages = (queueName: any, handler: any, options?: any) => 
  rabbitmq.consumeMessages(queueName, handler, options);
export const getRabbitMQHealth = () => rabbitmq.healthCheck();