import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed' | 'exhausted';

export interface IWebhookDeliveryDocument extends Document {
  _id: Types.ObjectId;
  webhookId: Types.ObjectId;
  businessId: Types.ObjectId;
  event: string;
  payload: Record<string, any>;
  status: WebhookDeliveryStatus;
  httpStatus?: number;
  attempt: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  error?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookDeliverySchema: Schema = new Schema(
  {
    webhookId: {
      type: Schema.Types.ObjectId,
      ref: 'Webhook',
      required: true,
      index: true,
    },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    event: {
      type: String,
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'exhausted'],
      default: 'pending',
      index: true,
    },
    httpStatus: Number,
    attempt: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    nextRetryAt: {
      type: Date,
      index: true,
    },
    error: String,
    deliveredAt: Date,
  },
  { timestamps: true }
);

// Retry cron scans for due, still-retriable deliveries
WebhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });

export type IWebhookDelivery = IWebhookDeliveryDocument;

export default mongoose.model<IWebhookDeliveryDocument, Model<IWebhookDeliveryDocument>>(
  'WebhookDelivery',
  WebhookDeliverySchema
);
