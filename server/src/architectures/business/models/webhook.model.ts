import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IWebhookDocument extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const WEBHOOK_EVENTS = ['lead.captured', 'session.started', 'session.ended'] as const;

const WebhookSchema: Schema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    secret: {
      type: String,
      required: true,
    },
    events: {
      type: [String],
      enum: WEBHOOK_EVENTS,
      default: WEBHOOK_EVENTS,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export type IWebhook = IWebhookDocument;

export default mongoose.model<IWebhookDocument, Model<IWebhookDocument>>('Webhook', WebhookSchema);
