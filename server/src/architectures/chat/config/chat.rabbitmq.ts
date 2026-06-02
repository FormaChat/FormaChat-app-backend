import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { env } from './chat.env.config';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('chat-rabbitmq');

const EMAIL_EXCHANGE = 'email.exchange';
const ANALYTICS_EXCHANGE = 'analytics.exchange';

interface ChatRabbitMQ {
  connection: any;
  channel: any;
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

    await state.channel.assertExchange(EMAIL_EXCHANGE, 'topic', { durable: true });
    // Analytics exchange — consumers can be added later without touching this service
    await state.channel.assertExchange(ANALYTICS_EXCHANGE, 'topic', { durable: true });

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

function publishAnalytics(routingKey: string, data: object): void {
  if (!state.channel || !state.isConnected) return;
  try {
    state.channel.publish(
      ANALYTICS_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify({ eventId: uuidv4(), eventType: routingKey, timestamp: Date.now(), data })),
      { persistent: false }
    );
  } catch { /* best-effort */ }
}

export function publishSessionStarted(data: { businessId: string; sessionId: string; visitorId?: string }): void {
  publishAnalytics('chat.session.started', data);
}

export function publishSessionEnded(data: { businessId: string; sessionId: string; messageCount: number; durationMs: number }): void {
  publishAnalytics('chat.session.ended', data);
}

export function publishMessageSent(data: { businessId: string; sessionId: string; role: 'user' | 'assistant'; tokensUsed?: number }): void {
  publishAnalytics('chat.message.sent', data);
}

export async function disconnectChatRabbitMQ(): Promise<void> {
  try {
    if (state.channel) await state.channel.close();
    if (state.connection) await state.connection.close();
    state.isConnected = false;
  } catch (_) { /* ignore on shutdown */ }
}
