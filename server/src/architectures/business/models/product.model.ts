import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IProductDocument extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  name: string;
  description: string;
  price: number;
  stockQuantity: number;
  category?: string;
  imageUrl?: string;
  isActive: boolean;
  pineconeVectorId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema: Schema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    stockQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    imageUrl: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    pineconeVectorId: {
      type: String,
    },
  },
  { timestamps: true }
);

ProductSchema.index({ businessId: 1, isActive: 1 });

export type IProduct = IProductDocument;

export default mongoose.model<IProductDocument, Model<IProductDocument>>('Product', ProductSchema);
