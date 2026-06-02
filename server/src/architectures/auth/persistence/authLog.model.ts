import mongoose, { Schema, Document, Model } from 'mongoose';


export interface IAuthLog extends Document {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  eventType: 
    | 'login' 
    | 'logout' 
    | 'registration' 
    | 'password_change' 
    | 'failed_attempt' 
    | 'account_locked'
    | 'otp_requested'
    | 'otp_verified'
    | 'otp_failed'
    | 'password_reset'
    | 'token_refreshed'
    | 'account_deactivated'
    | 'feedback_submitted';
  success: boolean;
  metadata: {
    ipAddress: string;
    userAgent: string;
    location?: string;
    deviceId?: string;
    reason?: string;
    suspectedAnomaly?: boolean;
  };
  timestamp: Date;
}



const AuthLogSchema: Schema<IAuthLog> = new Schema({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: false,
    index: true 
  },
  eventType: { 
    type: String, 
    enum: [
      'login',
      'logout',
      'registration',
      'password_change',
      'failed_attempt',
      'account_locked',
      'otp_requested',
      'otp_verified',
      'otp_failed',
      'password_reset',
      'token_refreshed',
      'account_deactivated',
      'feedback_submitted'
    ],
    required: true 
  },
  success: { 
    type: Boolean, 
    required: true 
  },
  metadata: {
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
    location: String,
    deviceId: String,
    reason: String,
    suspectedAnomaly: { type: Boolean, default: false }
  },
  timestamp: { 
    type: Date, 
    default: Date.now,
    index: true 
  }
});

// Indexes for efficient querying and analytics
AuthLogSchema.index({ timestamp: -1 });
AuthLogSchema.index({ 'metadata.ipAddress': 1 });
AuthLogSchema.index({ eventType: 1, success: 1 });
AuthLogSchema.index({ userId: 1, timestamp: -1 });


export const AuthLogModel: Model<IAuthLog> = mongoose.model<IAuthLog>('AuthLog', AuthLogSchema);