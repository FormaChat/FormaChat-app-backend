import amqp from 'amqplib';
import { env } from './chat.env.config';
import { createLogger } from '../util/chat.logger.utils';
import { AnalyticsEvent } from '../model/analyticsEvent.model';

const logger = createLogger('analytics-consumer');

const ANALYTICS_EXCHANGE = 'analytics.exchange';
const QUEUE_NAME = 'analytics.consumer.chat-events';

let connection: any = null;
let channel: any = null;

/**
 * Consumes everything published to analytics.exchange (session.started/ended,
 * message.sent - see chat.rabbitmq.ts's publishAnalytics) and writes it to the
 * AnalyticsEvent collection. Previously nothing consumed this exchange at all,
 * so every event published before this was silently dropped.
 *
 * Best-effort like the rest of the analytics pipeline: a failure here never
 * blocks chat - it just means that one event doesn't show up in reports.
 */
export async function connectAnalyticsConsumer(): Promise<void> {
  try {
    connection = await amqp.connect(env.RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange(ANALYTICS_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    // All current routing keys are chat.session.started / chat.session.ended / chat.message.sent
    await channel.bindQueue(QUEUE_NAME, ANALYTICS_EXCHANGE, 'chat.*');

    await channel.consume(QUEUE_NAME, async (msg: any) => {
      if (!msg) return;

      try {
        const parsed = JSON.parse(msg.content.toString());
        const { eventId, eventType, timestamp, data } = parsed;

        await AnalyticsEvent.updateOne(
          { eventId },
          {
            $setOnInsert: {
              eventId,
              eventType,
              businessId: data?.businessId,
              sessionId: data?.sessionId,
              data,
              occurredAt: new Date(timestamp),
            },
          },
          { upsert: true }
        );

        channel.ack(msg);
      } catch (error: any) {
        logger.error('Failed to process analytics event', { error: error.message });
        // Drop rather than requeue - a malformed analytics event will never succeed,
        // and this is best-effort reporting data, not something worth blocking on.
        channel.ack(msg);
      }
    });

    connection.on('error', () => { connection = null; channel = null; });
    connection.on('close', () => { connection = null; channel = null; });

    logger.info('Analytics consumer connected and listening on analytics.exchange');
  } catch (error: any) {
    logger.error('Analytics consumer connection failed', { error: error.message });
    // Non-fatal: analytics is best-effort, must not crash the app
  }
}

export async function disconnectAnalyticsConsumer(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch (_) { /* ignore on shutdown */ }
}
