import crypto from 'crypto';
import axios from 'axios';
import WebhookModel, { IWebhook, WEBHOOK_EVENTS } from '../models/webhook.model';
import WebhookDeliveryModel, { IWebhookDelivery } from '../models/webhookDelivery.model';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('webhook-service');

// 3 total attempts: immediate, then +5min, then +30min
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000];
const DELIVERY_TIMEOUT_MS = 8000;

export class WebhookService {
  /**
   * Generate a webhook signing secret, shown to the owner once on creation.
   */
  static generateSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString('hex')}`;
  }

  static signPayload(secret: string, rawBody: string): string {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  async createWebhook(businessId: string, url: string, events: string[]): Promise<IWebhook> {
    const validEvents = events.filter(e => (WEBHOOK_EVENTS as readonly string[]).includes(e));
    const webhook = await WebhookModel.create({
      businessId,
      url,
      secret: WebhookService.generateSecret(),
      events: validEvents.length > 0 ? validEvents : [...WEBHOOK_EVENTS],
      isActive: true,
    });
    logger.info('Webhook created', { businessId, webhookId: webhook._id });
    return webhook;
  }

  async listWebhooks(businessId: string): Promise<IWebhook[]> {
    return WebhookModel.find({ businessId }).sort({ createdAt: -1 });
  }

  async updateWebhook(
    businessId: string,
    webhookId: string,
    updates: { url?: string; events?: string[]; isActive?: boolean }
  ): Promise<IWebhook | null> {
    const patch: Record<string, any> = {};
    if (updates.url !== undefined) patch.url = updates.url;
    if (updates.isActive !== undefined) patch.isActive = updates.isActive;
    if (updates.events !== undefined) {
      const validEvents = updates.events.filter(e => (WEBHOOK_EVENTS as readonly string[]).includes(e));
      patch.events = validEvents;
    }

    return WebhookModel.findOneAndUpdate({ _id: webhookId, businessId }, patch, { new: true });
  }

  async deleteWebhook(businessId: string, webhookId: string): Promise<boolean> {
    const result = await WebhookModel.deleteOne({ _id: webhookId, businessId });
    return result.deletedCount > 0;
  }

  async listDeliveries(businessId: string, webhookId: string, limit = 50): Promise<IWebhookDelivery[]> {
    return WebhookDeliveryModel.find({ businessId, webhookId })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Fire an event to every active webhook subscribed to it for this business.
   * Best-effort per webhook: one failing webhook never blocks another.
   */
  async triggerEvent(businessId: string, event: string, payload: Record<string, any>): Promise<void> {
    try {
      const webhooks = await WebhookModel.find({ businessId, isActive: true, events: event });
      if (webhooks.length === 0) return;

      await Promise.all(
        webhooks.map(webhook =>
          this.deliver(webhook, event, payload).catch(err =>
            logger.error('Webhook delivery threw unexpectedly', { webhookId: webhook._id, error: err.message })
          )
        )
      );
    } catch (error: any) {
      logger.error('triggerEvent failed to look up webhooks', { businessId, event, error: error.message });
    }
  }

  /**
   * Attempt one delivery (attempt #1). Records the outcome and schedules a
   * retry via the delivery record if it fails - the retry cron drives attempts 2 and 3.
   */
  private async deliver(webhook: IWebhook, event: string, payload: Record<string, any>): Promise<void> {
    const delivery = await WebhookDeliveryModel.create({
      webhookId: webhook._id,
      businessId: webhook.businessId,
      event,
      payload,
      status: 'pending',
      attempt: 0,
      maxAttempts: RETRY_DELAYS_MS.length + 1,
    });

    await this.attemptDelivery(webhook, delivery);
  }

  /**
   * Send one HTTP attempt for an existing delivery record and update it in place.
   * Shared by the initial send and the retry cron.
   */
  async attemptDelivery(webhook: IWebhook, delivery: IWebhookDelivery): Promise<void> {
    const body = {
      event: delivery.event,
      businessId: String(webhook.businessId),
      data: delivery.payload,
      timestamp: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(body);
    const signature = WebhookService.signPayload(webhook.secret, rawBody);
    const attemptNumber = delivery.attempt + 1;

    try {
      const response = await axios.post(webhook.url, body, {
        timeout: DELIVERY_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-FormaChat-Signature': signature,
          'X-FormaChat-Event': delivery.event,
        },
        validateStatus: () => true,
      });

      const succeeded = response.status >= 200 && response.status < 300;

      delivery.attempt = attemptNumber;
      delivery.httpStatus = response.status;

      if (succeeded) {
        delivery.status = 'success';
        delivery.deliveredAt = new Date();
        delivery.nextRetryAt = undefined;
        delivery.error = undefined;
      } else {
        this.scheduleNextAttemptOrExhaust(delivery, `HTTP ${response.status}`);
      }

      await delivery.save();
    } catch (error: any) {
      delivery.attempt = attemptNumber;
      this.scheduleNextAttemptOrExhaust(delivery, error.message || 'Request failed');
      await delivery.save();
    }
  }

  private scheduleNextAttemptOrExhaust(delivery: IWebhookDelivery, errorMessage: string): void {
    delivery.error = errorMessage;

    const nextDelayIndex = delivery.attempt - 1; // attempt 1 failed -> use RETRY_DELAYS_MS[0], etc.
    if (nextDelayIndex < RETRY_DELAYS_MS.length) {
      delivery.status = 'failed';
      delivery.nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[nextDelayIndex]);
    } else {
      delivery.status = 'exhausted';
      delivery.nextRetryAt = undefined;
    }
  }

  /**
   * Retry every delivery whose scheduled retry time has passed. Called by the cron job.
   */
  async processDueRetries(): Promise<{ processed: number }> {
    const due = await WebhookDeliveryModel.find({
      status: 'failed',
      nextRetryAt: { $lte: new Date() },
    }).limit(100);

    let processed = 0;
    for (const delivery of due) {
      const webhook = await WebhookModel.findById(delivery.webhookId);
      if (!webhook || !webhook.isActive) {
        delivery.status = 'exhausted';
        delivery.error = 'Webhook was deleted or deactivated';
        delivery.nextRetryAt = undefined;
        await delivery.save();
        continue;
      }
      await this.attemptDelivery(webhook, delivery);
      processed++;
    }

    return { processed };
  }

  /**
   * Manually re-trigger a specific failed/exhausted delivery from the dashboard.
   */
  async retryDeliveryNow(businessId: string, deliveryId: string): Promise<boolean> {
    const delivery = await WebhookDeliveryModel.findOne({ _id: deliveryId, businessId });
    if (!delivery) return false;

    const webhook = await WebhookModel.findById(delivery.webhookId);
    if (!webhook) return false;

    // Manual retries don't count toward the automatic 3-attempt budget as harshly -
    // reset to 'pending' status conceptually but keep the attempt counter for visibility.
    await this.attemptDelivery(webhook, delivery);
    return true;
  }
}

export const webhookService = new WebhookService();
