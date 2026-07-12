import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBlacklistedEmail extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  blacklistedAt: Date;
  reason: string;
}

const BlacklistedEmailSchema: Schema<IBlacklistedEmail> = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  blacklistedAt: {
    type: Date,
    default: Date.now
  },
  reason: {
    type: String,
    default: 'Account deleted after deactivation grace period expired'
  }
});

export const BlacklistedEmailModel: Model<IBlacklistedEmail> =
  mongoose.model<IBlacklistedEmail>('BlacklistedEmail', BlacklistedEmailSchema);
