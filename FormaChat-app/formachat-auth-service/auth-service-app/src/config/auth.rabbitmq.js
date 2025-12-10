// auth.rabbitmq.js
const amqp = require('amqplib');
const { env, isDevelopment } = require('./auth.env');
const { logger } = require('../utils/auth.logger.utils');
const { email } = require('zod');

class RabbitMQConnection {
  static instance;
  connection = null;
  channel = null;
  isConnected = false;
  connectionRetries = 0;
  maxRetries = 5;
  retryDelay = 5000; // 5 seconds.

  exchanges = {
    auth: 'auth.exchange',        // For auth → email messages
    email: 'email.exchange',      // For email → auth responses
    dlx: 'auth.exchange.dlx'
  };

  queues = {
    // Producer queues = sending messages to email service
    userCreated: 'auth.user.created',
    otpGenerated: 'auth.otp.generated',
    passwordChanged: 'auth.password.changed',
    userDeactivated: 'auth.user.deactivated',
    feedbackSubmitted: 'auth.feedback.submitted',

    // Consumer queue recieveing message from email service
    emailResponse: 'auth.email.response'
  };

  routingKeys = {
    // Producer routing keys
    userCreated: 'user.created',
    otpGenerated: 'otp.generated',
    passwordChanged: 'password.changed',
    userDeactivated: 'user.deactivated',
    feedbackSubmitted: 'feedback.submitted',

    //consumer routing keys
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
      await this.channel.assertExchange(this.exchanges.auth, 'topic', { durable: true });
      await this.channel.assertExchange(this.exchanges.dlx, 'direct', { durable: true });
      await this.channel.assertQueue('auth.dlq', { durable: true });
      await this.channel.bindQueue('auth.dlq', this.exchanges.dlx, 'failed');

      await this.declareProducerQueues();
      await this.declareConsumerQueues();

      logger.info('RabbitMQ infrastructure setup completed');
    } catch (error) {
      logger.error('Failed to setup RabbitMQ infrastructure', { error: error.message || 'Unknown error' });
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

    // User created queue
    await this.channel.assertQueue(this.queues.userCreated, options);
    await this.channel.bindQueue(this.queues.userCreated, this.exchanges.email, this.routingKeys.userCreated);

    // OTP generated queue
    await this.channel.assertQueue(this.queues.otpGenerated, options);
    await this.channel.bindQueue(this.queues.otpGenerated, this.exchanges.email, this.routingKeys.otpGenerated);

    // Password changed queue
    await this.channel.assertQueue(this.queues.passwordChanged, options);
    await this.channel.bindQueue(this.queues.passwordChanged, this.exchanges.email, this.routingKeys.passwordChanged);

    // User deactivated queue
    await this.channel.assertQueue(this.queues.userDeactivated, options);
    await this.channel.bindQueue(this.queues.userDeactivated, this.exchanges.email, this.routingKeys.userDeactivated);
  
    // Feedback submitted queue
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

  async publishMessage(routingKey, data, options) {
    if (!this.channel || !this.isConnected) throw new Error('RabbitMQ not connected');

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
        { persistent: options.persistent ?? true, priority: options.priority ?? 0 }
      );

      if (!published) logger.warn('Message might not have been routed', { routingKey, eventId: options.eventId });
      logger.info('Message published', { routingKey, eventId: options.eventId });
    } catch (error) {
      logger.error('Failed to publish message', { routingKey, eventId: options.eventId, error: error.message || 'Unknown error' });
      throw error;
    }
  }

  async consumeMessages(queueName, handler, options = {}) {
    if (!this.channel || !this.isConnected) throw new Error('RabbitMQ not connected');

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
            logger.error('Failed to process message', { queue: queueName, error: error.message || 'Unknown error' });
            if (!options.noAck) this.channel.nack(msg, false, false);
          }
        },
        { noAck: options.noAck ?? false, exclusive: options.exclusive ?? false }
      );
      logger.info(`Started consuming messages from queue: ${this.queues[queueName]}`);
    } catch (error) {
      logger.error('Failed to setup consumer', { queue: queueName, error: error.message || 'Unknown error' });
      throw error;
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
  getRabbitMQHealth: () => rabbitmq.healthCheck()
};
