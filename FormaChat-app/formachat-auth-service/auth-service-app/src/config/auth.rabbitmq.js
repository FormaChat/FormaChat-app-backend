// auth.rabbitmq.js
const amqp = require('amqplib');
const { env, isDevelopment } = require('./auth.env');
const { logger } = require('../utils/auth.logger.utils');

class RabbitMQConnection {
  static instance;
  connection = null;
  channel = null;
  isConnected = false;
  connectionRetries = 0;
  maxRetries = 5;
  retryDelay = 5000;
  isReconnecting = false;
  
  // NEW: Message buffer for when connection is down
  messageBuffer = [];
  maxBufferSize = 100;

  exchanges = {
    auth: 'auth.exchange',
    email: 'email.exchange',
    dlx: 'auth.exchange.dlx'
  };

  queues = {
    userCreated: 'auth.user.created',
    otpGenerated: 'auth.otp.generated',
    passwordChanged: 'auth.password.changed',
    userDeactivated: 'auth.user.deactivated',
    feedbackSubmitted: 'auth.feedback.submitted',
    emailResponse: 'auth.email.response'
  };

  routingKeys = {
    userCreated: 'user.created',
    otpGenerated: 'otp.generated',
    passwordChanged: 'password.changed',
    userDeactivated: 'user.deactivated',
    feedbackSubmitted: 'feedback.submitted',
    emailResponse: 'email.response'
  };

  constructor() {}

  static getInstance() {
    if (!RabbitMQConnection.instance) {
      RabbitMQConnection.instance = new RabbitMQConnection();
    }
    return RabbitMQConnection.instance;
  }

  async connect() {
    if (this.isConnected) {
      logger.info('RabbitMQ already connected');
      return;
    }

    try {
      logger.info('Attempting to connect to RabbitMQ...', {
        url: this.maskUrl(env.RABBITMQ_URL)
      });

      this.connection = await amqp.connect(env.RABBITMQ_URL);
      this.setupConnectionEventListeners();

      this.channel = await this.connection.createChannel();
      this.setupChannelEventListeners();
      await this.channel.prefetch(10);

      await this.setupInfrastructure();

      this.isConnected = true;
      this.connectionRetries = 0;
      this.isReconnecting = false;

      logger.info('✅ RabbitMQ connected successfully', {
        url: this.maskUrl(env.RABBITMQ_URL)
      });

      // NEW: Flush buffered messages after successful connection
      await this.flushMessageBuffer();

    } catch (error) {
      logger.error('❌ RabbitMQ connection failed', {
        error: error.message || 'Unknown error',
        code: error.code,
        retryAttempt: this.connectionRetries + 1,
        maxRetries: this.maxRetries
      });
      await this.handleConnectionError();
    }
  }

  // NEW: Flush buffered messages after reconnection
  async flushMessageBuffer() {
    if (this.messageBuffer.length === 0) return;

    logger.info(`Flushing ${this.messageBuffer.length} buffered messages...`);
    
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];

    for (const { routingKey, data, options } of messages) {
      try {
        await this.publishMessage(routingKey, data, options);
      } catch (error) {
        logger.error('Failed to flush buffered message', {
          routingKey,
          eventId: options.eventId,
          error: error.message
        });
      }
    }

    logger.info('Message buffer flushed successfully');
  }

  setupConnectionEventListeners() {
    if (!this.connection) return;

    this.connection.on('error', (error) => {
      this.isConnected = false;
      logger.error('RabbitMQ connection error', { 
        error: error.message,
        code: error.code 
      });
      this.handleConnectionLoss();
    });

    this.connection.on('close', () => {
      this.isConnected = false;
      logger.warn('RabbitMQ connection closed');
      this.handleConnectionLoss();
    });

    process.on('SIGINT', async () => await this.disconnect());
    process.on('SIGTERM', async () => await this.disconnect());
  }

  async handleConnectionLoss() {
    if (this.isReconnecting) {
      logger.info('Reconnection already in progress, skipping...');
      return;
    }

    this.isReconnecting = true;
    this.isConnected = false;

    try {
      if (this.channel) {
        await this.channel.close().catch(() => {});
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close().catch(() => {});
        this.connection = null;
      }
    } catch (error) {
      logger.error('Error cleaning up connection', { error: error.message });
    }

    await this.reconnect();
  }

  async reconnect() {
    if (this.connectionRetries >= this.maxRetries) {
      logger.error('Maximum reconnection attempts reached', {
        maxRetries: this.maxRetries
      });
      this.isReconnecting = false;
      if (!isDevelopment) {
        process.exit(1);
      }
      return;
    }

    this.connectionRetries++;
    
    logger.info(`Attempting to reconnect to RabbitMQ...`, {
      attempt: this.connectionRetries,
      maxRetries: this.maxRetries,
      delay: this.retryDelay / 1000 + 's'
    });

    await new Promise(resolve => setTimeout(resolve, this.retryDelay));

    try {
      await this.connect();
      
      if (this.isConnected) {
        logger.info('Reconnection successful, restarting consumer...');
        if (global.restartEmailConsumer) {
          await global.restartEmailConsumer();
        }
      }
    } catch (error) {
      logger.error('Reconnection attempt failed', {
        attempt: this.connectionRetries,
        error: error.message
      });
      await this.reconnect();
    }
  }

  setupChannelEventListeners() {
    if (!this.channel) return;

    this.channel.on('error', (error) => {
      logger.error('RabbitMQ channel error', { error: error.message });
      this.handleConnectionLoss();
    });

    this.channel.on('close', () => {
      logger.warn('RabbitMQ channel closed');
    });
  }

  async setupInfrastructure() {
    if (!this.channel) throw new Error('Channel not available');

    try {
      await this.channel.assertExchange(this.exchanges.auth, 'topic', { durable: true });
      await this.channel.assertExchange(this.exchanges.dlx, 'direct', { durable: true });
      await this.channel.assertQueue('auth.dlq', { durable: true });
      await this.channel.bindQueue('auth.dlq', this.exchanges.dlx, 'failed');

      await this.declareProducerQueues();
      await this.declareConsumerQueues();

      logger.info('RabbitMQ infrastructure setup completed');
    } catch (error) {
      logger.error('Failed to setup RabbitMQ infrastructure', { 
        error: error.message || 'Unknown error' 
      });
      throw error;
    }
  }

  async declareProducerQueues() {
    if (!this.channel) return;

    const options = {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchanges.dlx,
        'x-dead-letter-routing-key': 'failed',
        'x-message-ttl': 86400000
      }
    };

    await this.channel.assertQueue(this.queues.userCreated, options);
    await this.channel.bindQueue(this.queues.userCreated, this.exchanges.email, this.routingKeys.userCreated);

    await this.channel.assertQueue(this.queues.otpGenerated, options);
    await this.channel.bindQueue(this.queues.otpGenerated, this.exchanges.email, this.routingKeys.otpGenerated);

    await this.channel.assertQueue(this.queues.passwordChanged, options);
    await this.channel.bindQueue(this.queues.passwordChanged, this.exchanges.email, this.routingKeys.passwordChanged);

    await this.channel.assertQueue(this.queues.userDeactivated, options);
    await this.channel.bindQueue(this.queues.userDeactivated, this.exchanges.email, this.routingKeys.userDeactivated);
  
    await this.channel.assertQueue(this.queues.feedbackSubmitted, options);
    await this.channel.bindQueue(this.queues.feedbackSubmitted, this.exchanges.email, this.routingKeys.feedbackSubmitted);
  }

  async declareConsumerQueues() {
    if (!this.channel) return;

    const options = {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchanges.dlx,
        'x-dead-letter-routing-key': 'failed'
      }
    };

    await this.channel.assertQueue(this.queues.emailResponse, options);
    await this.channel.bindQueue(
      this.queues.emailResponse,
      this.exchanges.auth, 
      this.routingKeys.emailResponse
    );
  }

  async handleConnectionError() {
    if (this.connectionRetries < this.maxRetries) {
      this.connectionRetries++;
      logger.info(`Retrying RabbitMQ connection in ${this.retryDelay / 1000}s...`, {
        attempt: this.connectionRetries,
        maxRetries: this.maxRetries
      });

      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      await this.connect();
    } else {
      logger.error('RabbitMQ connection failed after maximum retry attempts', { 
        maxRetries: this.maxRetries 
      });
      if (!isDevelopment) process.exit(1);
    }
  }

  async disconnect() {
    try {
      this.isConnected = false;
      this.isReconnecting = false;
      
      if (this.channel) { 
        await this.channel.close(); 
        this.channel = null; 
      }
      if (this.connection) { 
        await this.connection.close(); 
        this.connection = null; 
      }

      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection', { 
        error: error.message || 'Unknown error' 
      });
    }
  }

  async publishMessage(routingKey, data, options) {
    // NEW: Buffer messages if not connected
    if (!this.channel || !this.isConnected) {
      logger.warn('RabbitMQ not connected, buffering message', {
        routingKey,
        eventId: options.eventId,
        bufferSize: this.messageBuffer.length
      });

      if (this.messageBuffer.length < this.maxBufferSize) {
        this.messageBuffer.push({ routingKey, data, options });
        logger.info('Message buffered for later delivery', {
          eventId: options.eventId,
          bufferSize: this.messageBuffer.length
        });
      } else {
        logger.error('Message buffer full, dropping message', {
          eventId: options.eventId,
          maxBufferSize: this.maxBufferSize
        });
      }
      
      return; // Don't throw error, just buffer
    }

    const message = {
      eventId: options.eventId,
      eventType: options.eventType,
      timestamp: Date.now(),
      data
    };

    try {
      const published = this.channel.publish(
        this.exchanges.email,
        this.routingKeys[routingKey],
        Buffer.from(JSON.stringify(message)),
        { 
          persistent: options.persistent ?? true, 
          priority: options.priority ?? 0 
        }
      );

      if (!published) {
        logger.warn('Message might not have been routed', { 
          routingKey, 
          eventId: options.eventId 
        });
      } else {
        logger.info('Message published successfully', { 
          routingKey, 
          eventId: options.eventId 
        });
      }
    } catch (error) {
      logger.error('Failed to publish message', { 
        routingKey, 
        eventId: options.eventId, 
        error: error.message || 'Unknown error' 
      });
      
      // Buffer on failure
      if (this.messageBuffer.length < this.maxBufferSize) {
        this.messageBuffer.push({ routingKey, data, options });
      }
    }
  }

  async consumeMessages(queueName, handler, options = {}) {
    if (!this.channel || !this.isConnected) {
      throw new Error('RabbitMQ not connected');
    }

    try {
      await this.channel.consume(
        this.queues[queueName],
        async (msg) => {
          if (!msg) return;
          try {
            const message = JSON.parse(msg.content.toString());
            await handler(message);
            if (!options.noAck) this.channel.ack(msg);
          } catch (error) {
            logger.error('Failed to process message', { 
              queue: queueName, 
              error: error.message || 'Unknown error' 
            });
            if (!options.noAck) this.channel.nack(msg, false, false);
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
        error: error.message || 'Unknown error' 
      });
      throw error;
    }
  }

  async healthCheck() {
    try {
      if (!this.connection || !this.isConnected) {
        return { 
          status: 'unhealthy', 
          details: { 
            connected: false,
            bufferedMessages: this.messageBuffer.length 
          } 
        };
      }
      
      const tempChannel = await this.connection.createChannel();
      await tempChannel.close();
      
      return { 
        status: 'healthy', 
        details: { 
          connected: true, 
          channelCount: 1,
          bufferedMessages: this.messageBuffer.length 
        } 
      };
    } catch {
      return { 
        status: 'unhealthy', 
        details: { 
          connected: false,
          bufferedMessages: this.messageBuffer.length 
        } 
      };
    }
  }

  maskUrl(url) {
    try {
      const u = new URL(url);
      if (u.password) u.password = '***';
      return u.toString();
    } catch {
      return url;
    }
  }
}

const rabbitmq = RabbitMQConnection.getInstance();

module.exports = {
  rabbitmq,
  connectRabbitMQ: () => rabbitmq.connect(),
  disconnectRabbitMQ: () => rabbitmq.disconnect(),
  publishMessage: (routingKey, data, options) => rabbitmq.publishMessage(routingKey, data, options),
  consumeMessages: (queueName, handler, options) => rabbitmq.consumeMessages(queueName, handler, options),
  getRabbitMQHealth: () => rabbitmq.healthCheck()
};