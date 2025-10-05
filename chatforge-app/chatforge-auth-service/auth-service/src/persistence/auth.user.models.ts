import mongoose, { Schema, Document, Model } from 'mongoose';

// -----------------------------
// Interfaces
// -----------------------------
export interface IUser extends Document {

  _id: mongoose.Types.ObjectId;
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
  _id: mongoose.Types.ObjectId;
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

export interface IRefreshToken extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  isRevoked: boolean;
  deviceInfo: {
    userAgent: string;
    ipAddress: string;
  };
  createdAt: Date;
}

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
    | 'account_deactivated';
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
    // Locked after 5 failed attempts (enforced in auth.user.service)
  },
  lockUntil: { 
    type: Date 
    // Lock duration: 30 minutes (enforced in auth.user.service)
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
  // core
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

// Compound index for efficient OTP lookups (includes 'used' for faster queries)
OTPSchema.index({ userId: 1, type: 1, used: 1 });

// -----------------------------
// RefreshToken Schema
// -----------------------------
const RefreshTokenSchema: Schema<IRefreshToken> = new Schema({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  tokenHash: { 
    type: String, 
    required: true,
    unique: true // Each token is unique
  },
  expiresAt: { 
    type: Date, 
    required: true,
    index: true 
  },
  isRevoked: { 
    type: Boolean, 
    default: false,
    index: true 
  },
  deviceInfo: {
    userAgent: { type: String, required: true },
    ipAddress: { type: String, required: true }
  }
}, {
  timestamps: true
});

// Single session enforcement: Only one active (non-revoked) token per user
RefreshTokenSchema.index({ userId: 1, isRevoked: 1 }, { 
  unique: true,
  partialFilterExpression: { isRevoked: false }
});
// TTL index for automatic cleanup of expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for quick token verification lookups
RefreshTokenSchema.index({ tokenHash: 1, isRevoked: 1 });

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
      'account_deactivated'
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

// -----------------------------
// Models
// -----------------------------
export const UserModel: Model<IUser> = mongoose.model<IUser>('User', UserSchema);
export const OTPModel: Model<IOTP> = mongoose.model<IOTP>('OTP', OTPSchema);
export const RefreshTokenModel: Model<IRefreshToken> = mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
export const AuthLogModel: Model<IAuthLog> = mongoose.model<IAuthLog>('AuthLog', AuthLogSchema);