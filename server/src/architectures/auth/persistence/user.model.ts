import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {

  _id: mongoose.Types.ObjectId;
  id: string;
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
  twoFactorEnabled: boolean;

  // Future-proofing
  source: 'email' | 'google' | 'github';
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}


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
  twoFactorEnabled: {
    type: Boolean,
    default: false
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


UserSchema.index({ isActive: 1 });
UserSchema.index({ lockUntil: 1 });


export const UserModel: Model<IUser> = mongoose.model<IUser>('User', UserSchema);

