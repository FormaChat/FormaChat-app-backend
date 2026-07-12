import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAnalyticsEvent extends Document {
  eventId: string;
  eventType: string;
  businessId: string;
  sessionId?: string;
  data: Record<string, any>;
  occurredAt: Date;
  createdAt: Date;
}

const AnalyticsEventSchema: Schema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true, index: true },
    businessId: { type: String, required: true, index: true },
    sessionId: { type: String },
    data: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Common query shape: "this business's events of this type in a date range"
AnalyticsEventSchema.index({ businessId: 1, eventType: 1, occurredAt: 1 });

export const AnalyticsEvent: Model<IAnalyticsEvent> = mongoose.model<IAnalyticsEvent>(
  'AnalyticsEvent',
  AnalyticsEventSchema
);
