const amqp = require('amqplib');
const { env, isDevelopment } = require('./email.env');
const { logger } = require('../utils/email.logger.utils');

class RabbitMQConnection {
  static instance;
  connection = null;
  channel = null;
  isConnected = false;
  connectionRetries = 0;
  maxRetries = 5;
  retryDelay = 5000; // 5 seconds.

  exchanges = {
    email: 'email.exchange',      // For email → auth responses  
    auth: 'auth.exchange',        // For auth → email messages
    dlx: 'email.exchange.dlx'
  };

  queues = {
    // Consumer queues - receiving messages from auth services
    authUserCreated: 'email.consumer.user.created',
    authOtpGenerated: 'email.consumer.otp.generated',
    authPasswordChanged: 'email.consumer.password.changed',
    authUserDeactivated: 'email.consumer.user.deactivated',
    
    // Producer queues - sending messages to auth services
    authEmailResponse: 'email.producer.email.response',
    
    // DLQ
    emailDlq: 'email.dlq'
  };

  routingKeys = {
    // Producer routing keys (for publishing responses)
    authEmailResponse: 'email.response',
    
    // Consumer routing keys (for binding to receive events)
    authUserCreated: 'user.created',
    authOtpGenerated: 'otp.generated',
    authPasswordChanged: 'password.changed',
    authUserDeactivated: 'user.deactivated',
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
      this.connection = await amqp.connect(env.RABBITMQ_URL);
      this.setupConnectionEventListeners();

      this.channel = await this.connection.createChannel();
      this.setupChannelEventListeners();
      await this.channel.prefetch(10);

      await this.setupInfrastructure();

      this.isConnected = true;
      this.connectionRetries = 0;

      logger.info('RabbitMQ connected successfully', {
        url: this.maskUrl(env.RABBITMQ_URL),
        exchange: env.RABBITMQ_EXCHANGE
      });
    } catch (error) {
      logger.error('RabbitMQ connection failed', {
        error: error.message || 'Unknown error',
        retryAttempt: this.connectionRetries + 1,
        maxRetries: this.maxRetries
      });
      await this.handleConnectionError();
    }
  }

  setupConnectionEventListeners() {
    if (!this.connection) return;

    this.connection.on('error', (error) => {
      this.isConnected = false;
      logger.error('RabbitMQ connection error', { error: error.message });
    });

    this.connection.on('close', () => {
      this.isConnected = false;
      logger.warn('RabbitMQ connection closed');
    });

    process.on('SIGINT', async () => await this.disconnect());
    process.on('SIGTERM', async () => await this.disconnect());
  }

  setupChannelEventListeners() {
    if (!this.channel) return;

    this.channel.on('error', (error) => {
      logger.error('RabbitMQ channel error', { error: error.message });
    });

    this.channel.on('close', () => {
      logger.warn('RabbitMQ channel closed');
    });
  }

  async setupInfrastructure() {
    if (!this.channel) throw new Error('Channel not available');

    try {
      // Assert email service exchange (for publishing)
      await this.channel.assertExchange(this.exchanges.email, 'topic', { durable: true });
      
      // Assert DLX and DLQ
      await this.channel.assertExchange(this.exchanges.dlx, 'direct', { durable: true });
      await this.channel.assertQueue(this.queues.emailDlq, { durable: true });
      await this.channel.bindQueue(this.queues.emailDlq, this.exchanges.dlx, 'failed');

      
      
      // Setup producer queues (sending messages to other services)
      await this.declareProducerQueues();
      await this.declareConsumerQueues();


      logger.info('RabbitMQ infrastructure setup completed');
    } catch (error) {
      logger.error('Failed to setup RabbitMQ infrastructure', { error: error.message || 'Unknown error' });
      throw error;
    }
  }

  async declareConsumerQueues() {
    if (!this.channel) return;

    const options = {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchanges.dlx,
        'x-dead-letter-routing-key': 'failed',
        'x-message-ttl': 86400000 // 24 hours
      }
    };

    // Consumer queues from AUTH service
    await this.channel.assertQueue(this.queues.authUserCreated, options);
    await this.channel.bindQueue(
      this.queues.authUserCreated,
      this.exchanges.email,
      this.routingKeys.authUserCreated
    );

    await this.channel.assertQueue(this.queues.authOtpGenerated, options);
    await this.channel.bindQueue(
      this.queues.authOtpGenerated,
      this.exchanges.email,
      this.routingKeys.authOtpGenerated
    );

    await this.channel.assertQueue(this.queues.authPasswordChanged, options);
    await this.channel.bindQueue(
      this.queues.authPasswordChanged,
      this.exchanges.email,
      this.routingKeys.authPasswordChanged
    );

    await this.channel.assertQueue(this.queues.authUserDeactivated, options);
    await this.channel.bindQueue(
      this.queues.authUserDeactivated,
      this.exchanges.email,
      this.routingKeys.authUserDeactivated
    );
    
    logger.info('Consumer queues declared and bound');
  }

  async declareProducerQueues() {
    if (!this.channel) return;

    const options = {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchanges.dlx,
        'x-dead-letter-routing-key': 'failed'
      }
    };

    // Producer queue for auth service responses
    await this.channel.assertQueue(this.queues.authEmailResponse, options);
    await this.channel.bindQueue(
      this.queues.authEmailResponse,
      this.exchanges.auth, // Bind to auth exchange so auth service can consume it
      this.routingKeys.authEmailResponse
    );

    // Add more producer queues for other services here
    // Example for ORDER service:
    // await this.channel.assertQueue(this.queues.orderEmailResponse, options);
    // await this.channel.bindQueue(
    //   this.queues.orderEmailResponse,
    //   this.exchanges.order,
    //   this.routingKeys.orderEmailResponse
    // );

    logger.info('Producer queues declared and bound');
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
      logger.error('RabbitMQ connection failed after maximum retry attempts', { maxRetries: this.maxRetries });
      if (!isDevelopment) process.exit(1);
    }
  }

  async disconnect() {
    try {
      if (this.channel) { await this.channel.close(); this.channel = null; }
      if (this.connection) { await this.connection.close(); this.connection = null; }

      this.isConnected = false;
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection', { error: error.message || 'Unknown error' });
    }
  }

  /**
   * Publish message to a queue
   * @param {string} routingKey - The routing key name from this.routingKeys
   * @param {object} data - The message payload
   * @param {object} options - Publishing options
   * @param {string} options.eventId - Unique event identifier
   * @param {string} options.eventType - Type of event
   * @param {boolean} options.persistent - Message persistence (default: true)
   * @param {number} options.priority - Message priority (default: 0)
   * @param {string} options.targetExchange - Override default exchange (optional)
   */
  async publishMessage(routingKey, data, options) {
    if (!this.channel || !this.isConnected) throw new Error('RabbitMQ not connected');

    const message = {
      eventId: options.eventId,
      eventType: options.eventType,
      timestamp: Date.now(),
      data
    };

    try {
      // Use targetExchange if provided, otherwise use email exchange
      const exchange = options.targetExchange || this.exchanges.email;
      
      const published = this.channel.publish(
        exchange,
        this.routingKeys[routingKey],
        Buffer.from(JSON.stringify(message)),
        { persistent: options.persistent ?? true, priority: options.priority ?? 0 }
      );

      if (!published) logger.warn('Message might not have been routed', { routingKey, eventId: options.eventId });
      logger.info('Message published', { routingKey, eventId: options.eventId, exchange });
    } catch (error) {
      logger.error('Failed to publish message', { routingKey, eventId: options.eventId, error: error.message || 'Unknown error' });
      throw error;
    }
  }

  /**
   * Consume messages from a queue
   * @param {string} queueName - The queue name from this.queues
   * @param {function} handler - Message handler function
   * @param {object} options - Consumer options
   */
  async consumeMessages(queueName, handler, options = {}) {
    if (!this.channel || !this.isConnected) throw new Error('RabbitMQ not connected');

    try {
      await this.channel.consume(
        this.queues[queueName],
        async (msg) => {
          if (!msg) return;
          
          try {
            const message = JSON.parse(msg.content.toString());
            
            // Extract retry count from headers
            const retryCount = (msg.properties.headers?.['x-retry-count']) || 0;
            message.retryCount = retryCount;
            
            await handler(message);
            
            // ✅ ONLY ACK ONCE - if successful
            if (!options.noAck) this.channel.ack(msg);
            
          } catch (error) {
            logger.error('Failed to process message', { 
              queue: queueName, 
              error: error.message,
              retryCount: (msg.properties.headers?.['x-retry-count']) || 0
            });
            
            if (!options.noAck) {
              // Let the handler's retry logic decide what to do
              // If handler throws, we NACK with requeue for retries
              // If handler doesn't throw, we ACK (message goes to DLQ via publishToDLQ)
              this.channel.nack(msg, false, true); // ← REQUeUE for retries
            }
          }
        },
        { noAck: options.noAck ?? false, exclusive: options.exclusive ?? false }
      );
      
      logger.info(`Started consuming messages from queue: ${this.queues[queueName]}`);
    } catch (error) {
      logger.error('Failed to setup consumer', { queue: queueName, error: error.message });
      throw error;
    }
  }

  /**
   * Publish message to DLQ
   * @param {object} message - Original message
   * @param {string} reason - Failure reason
   * @param {object} metadata - Additional metadata
   */
  async publishToDLQ(message, reason, metadata = {}) {
    if (!this.channel || !this.isConnected) throw new Error('RabbitMQ not connected');

    const dlqMessage = {
      originalMessage: message,
      reason,
      timestamp: Date.now(),
      service: 'email',
      metadata
    };

    try {
      this.channel.publish(
        this.exchanges.dlx,
        'failed',
        Buffer.from(JSON.stringify(dlqMessage)),
        { persistent: true }
      );
      logger.info('Message published to DLQ', { reason });
    } catch (error) {
      logger.error('Failed to publish to DLQ', { error: error.message || 'Unknown error' });
    }
  }

  async healthCheck() {
    try {
      if (!this.connection || !this.isConnected) return { status: 'unhealthy', details: { connected: false } };
      const tempChannel = await this.connection.createChannel();
      await tempChannel.close();
      return { status: 'healthy', details: { connected: true, channelCount: 1 } };
    } catch {
      return { status: 'unhealthy', details: { connected: false } };
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
  publishToDLQ: (message, reason, metadata) => rabbitmq.publishToDLQ(message, reason, metadata),
  getRabbitMQHealth: () => rabbitmq.healthCheck()
};