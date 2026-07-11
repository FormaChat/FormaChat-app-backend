import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IOTP extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: 'email_verification' | 'password_reset' | '2fa' | 'magic_link';
  hashedOTP: string;
  expiresAt: Date;
  used: boolean;
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
  };
  createdAt: Date;
}


const OTPSchema: Schema<IOTP> = new Schema({
  // core
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  type: { 
    type: String, 
    enum: ['email_verification', 'password_reset', '2fa', 'magic_link'],
    required: true 
  },
  hashedOTP: { 
    type: String, 
    required: true 
  },
  expiresAt: { 
    type: Date, 
    required: true,
   
  },
  used: { 
    type: Boolean, 
    default: false 
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceFingerprint: String
  }
}, {
  timestamps: true
});

// TTL index for automatic expiration cleanup
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for efficient OTP lookups (includes 'used' for faster queries)
OTPSchema.index({ userId: 1, type: 1, used: 1 });

export const OTPModel: Model<IOTP> = mongoose.model<IOTP>('OTP', OTPSchema);