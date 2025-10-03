import mongoose, { Schema, Document, Model } from 'mongoose';

// -----------------------------
// Interfaces
// -----------------------------
export interface IUser extends Document {
  // Core Identity (for authentication only)
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  
  // Account Status & Security
  isVerified: boolean;
  isActive: boolean;
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockUntil?: Date;
  passwordChangedAt: Date;
  
  // Future-proofing
  source: 'email' | 'google' | 'github';
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IOTP extends Document {
  userId: mongoose.Types.ObjectId;
  type: 'email_verification' | 'password_reset' | '2fa';
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

export interface IAuthLog extends Document {
  userId?: mongoose.Types.ObjectId;
  eventType: 'login' | 'logout' | 'registration' | 'password_change' | 'failed_attempt' | 'account_locked';
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

// -----------------------------
// User Schema
// -----------------------------
const UserSchema: Schema<IUser> = new Schema({
  // Core Identity
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true,
    index: true 
  },
  passwordHash: { 
    type: String, 
    required: true 
  },
  firstName: { 
    type: String, 
    required: true, 
    trim: true, 
    maxlength: 50 
  },
  lastName: { 
    type: String, 
    required: true, 
    trim: true, 
    maxlength: 50 
  },
  
  // Account Status & Security
  isVerified: { 
    type: Boolean, 
    default: false 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  lastLoginAt: { 
    type: Date 
  },
  failedLoginAttempts: { 
    type: Number, 
    default: 0 
  },
  lockUntil: { 
    type: Date 
  },
  passwordChangedAt: { 
    type: Date, 
    default: Date.now 
  },
  
  // Future OAuth support
  source: { 
    type: String, 
    enum: ['email', 'google', 'github'], 
    default: 'email' 
  }
}, {
  timestamps: true
});

// -----------------------------
// User Schema Indexes
// -----------------------------
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ isActive: 1 });
UserSchema.index({ lockUntil: 1 });

// -----------------------------
// OTP Schema
// -----------------------------
const OTPSchema: Schema<IOTP> = new Schema({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  type: { 
    type: String, 
    enum: ['email_verification', 'password_reset', '2fa'], 
    required: true 
  },
  hashedOTP: { 
    type: String, 
    required: true 
  },
  expiresAt: { 
    type: Date, 
    required: true,
    index: true 
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

// Compound index for efficient OTP lookups
OTPSchema.index({ userId: 1, type: 1 });

// -----------------------------
// Auth Log Schema
// -----------------------------
const AuthLogSchema: Schema<IAuthLog> = new Schema({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: false,
    index: true 
  },
  eventType: { 
    type: String, 
    enum: ['login', 'logout', 'registration', 'password_change', 'failed_attempt', 'account_locked'],
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

// -----------------------------
// Models
// -----------------------------
export const UserModel: Model<IUser> = mongoose.model<IUser>('User', UserSchema);
export const OTPModel: Model<IOTP> = mongoose.model<IOTP>('OTP', OTPSchema);
export const AuthLogModel: Model<IAuthLog> = mongoose.model<IAuthLog>('AuthLog', AuthLogSchema);