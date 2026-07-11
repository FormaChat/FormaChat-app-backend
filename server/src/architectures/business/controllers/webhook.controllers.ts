import { Request, Response } from 'express';
import { webhookService } from '../services/webhook.service';
import { WEBHOOK_EVENTS } from '../models/webhook.model';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('webhook-controller');

export const listWebhooks = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhooks = await webhookService.listWebhooks(req.params.id);
    res.json({
      success: true,
      data: webhooks.map(w => ({
        id: w._id,
        url: w.url,
        events: w.events,
        isActive: w.isActive,
        // secret is never returned after creation
        createdAt: w.createdAt,
      })),
    });
  } catch (error: any) {
    logger.error('List webhooks error:', error.message);
    res.status(500).json({ success: false, error: { code: 'LIST_WEBHOOKS_FAILED', message: 'Failed to list webhooks' } });
  }
};

export const createWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, events } = req.body;

    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_URL', message: 'A valid http(s) URL is required' } });
      return;
    }

    const webhook = await webhookService.createWebhook(req.params.id, url, Array.isArray(events) ? events : []);

    res.status(201).json({
      success: true,
      data: {
        id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        isActive: webhook.isActive,
        secret: webhook.secret, // shown once, on creation only
        createdAt: webhook.createdAt,
      },
      message: 'Webhook created. Save the secret now - it will not be shown again.',
    });
  } catch (error: any) {
    logger.error('Create webhook error:', error.message);
    res.status(500).json({ success: false, error: { code: 'CREATE_WEBHOOK_FAILED', message: 'Failed to create webhook' } });
  }
};

export const updateWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, events, isActive } = req.body;

    if (url !== undefined && (typeof url !== 'string' || !/^https?:\/\//.test(url))) {
      res.status(400).json({ success: false, error: { code: 'INVALID_URL', message: 'A valid http(s) URL is required' } });
      return;
    }

    const webhook = await webhookService.updateWebhook(req.params.id, req.params.webhookId, { url, events, isActive });

    if (!webhook) {
      res.status(404).json({ success: false, error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' } });
      return;
    }

    res.json({
      success: true,
      data: {
        id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
      },
    });
  } catch (error: any) {
    logger.error('Update webhook error:', error.message);
    res.status(500).json({ success: false, error: { code: 'UPDATE_WEBHOOK_FAILED', message: 'Failed to update webhook' } });
  }
};

export const deleteWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await webhookService.deleteWebhook(req.params.id, req.params.webhookId);
    if (!deleted) {
      res.status(404).json({ success: false, error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' } });
      return;
    }
    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error: any) {
    logger.error('Delete webhook error:', error.message);
    res.status(500).json({ success: false, error: { code: 'DELETE_WEBHOOK_FAILED', message: 'Failed to delete webhook' } });
  }
};

export const listDeliveries = async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveries = await webhookService.listDeliveries(req.params.id, req.params.webhookId);
    res.json({
      success: true,
      data: deliveries.map(d => ({
        id: d._id,
        event: d.event,
        status: d.status,
        httpStatus: d.httpStatus,
        attempt: d.attempt,
        maxAttempts: d.maxAttempts,
        nextRetryAt: d.nextRetryAt,
        error: d.error,
        deliveredAt: d.deliveredAt,
        createdAt: d.createdAt,
      })),
    });
  } catch (error: any) {
    logger.error('List deliveries error:', error.message);
    res.status(500).json({ success: false, error: { code: 'LIST_DELIVERIES_FAILED', message: 'Failed to list deliveries' } });
  }
};

export const retryDelivery = async (req: Request, res: Response): Promise<void> => {
  try {
    const retried = await webhookService.retryDeliveryNow(req.params.id, req.params.deliveryId);
    if (!retried) {
      res.status(404).json({ success: false, error: { code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' } });
      return;
    }
    res.json({ success: true, message: 'Retry attempted' });
  } catch (error: any) {
    logger.error('Retry delivery error:', error.message);
    res.status(500).json({ success: false, error: { code: 'RETRY_DELIVERY_FAILED', message: 'Failed to retry delivery' } });
  }
};

export const listWebhookEvents = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: WEBHOOK_EVENTS });
};
