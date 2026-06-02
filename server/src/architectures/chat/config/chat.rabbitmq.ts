import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { env } from './chat.env.config';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('chat-rabbitmq');

const EMAIL_EXCHANGE = 'email.exchange';

interface ChatRabbitMQ {
  connection: amqp.Connection | null;
  channel: amqp.Channel | null;
  isConnected: boolean;
}

const state: ChatRabbitMQ = {
  connection: null,
  channel: null,
  isConnected: false,
};

export async function connectChatRabbitMQ(): Promise<void> {
  try {
    state.connection = await amqp.connect(env.RABBITMQ_URL);
    state.channel = await state.connection.createChannel();

    // Assert the email exchange (topic, durable) — email service owns it, we just need it declared
    await state.channel.assertExchange(EMAIL_EXCHANGE, 'topic', { durable: true });

    state.isConnected = true;

    state.connection.on('error', () => { state.isConnected = false; });
    state.connection.on('close', () => { state.isConnected = false; });

    logger.info('Chat RabbitMQ connected');
  } catch (error: any) {
    logger.error('Chat RabbitMQ connection failed', { error: error.message });
    // Non-fatal: lead notifications are best-effort, do not crash the service
  }
}

export async function publishLeadCaptured(data: {
  businessId: string;
  businessOwnerEmail: string;
  businessName: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  sessionId: string;
  messageCount: number;
  capturedAt: Date;
}): Promise<void> {
  if (!state.channel || !state.isConnected) {
    logger.warn('RabbitMQ not connected — lead notification skipped', { businessId: data.businessId });
    return;
  }

  const message = {
    eventId: uuidv4(),
    eventType: 'lead.captured',
    timestamp: Date.now(),
    data,
  };

  try {
    state.channel.publish(
      EMAIL_EXCHANGE,
      'lead.captured',
      Buffer.from(JSON.stringify(message)),
      { persistent: true }
    );
    logger.info('lead.captured event published', { businessId: data.businessId, sessionId: data.sessionId });
  } catch (error: any) {
    logger.error('Failed to publish lead.captured event', { error: error.message });
    // Best-effort — do not propagate, lead is already saved in DB
  }
}

export async function disconnectChatRabbitMQ(): Promise<void> {
  try {
    if (state.channel) await state.channel.close();
    if (state.connection) await state.connection.close();
    state.isConnected = false;
  } catch (_) { /* ignore on shutdown */ }
}
