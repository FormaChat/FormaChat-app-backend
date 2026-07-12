import mongoose, { Schema, Document, Model } from 'mongoose';

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

// Multi-device support: multiple simultaneous non-revoked tokens per user are
// allowed (previously enforced single-session via a unique partial index here -
// removed so logging in on a second device no longer silently kills the first).
// TTL index for automatic cleanup of expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for quick token verification lookups
RefreshTokenSchema.index({ tokenHash: 1, isRevoked: 1 });



export const RefreshTokenModel: Model<IRefreshToken> = mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
