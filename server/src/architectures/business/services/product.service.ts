import { v4 as uuidv4 } from 'uuid';
import ProductModel, { IProduct } from '../models/product.model';
import { embeddingService } from './embedding.service';
import { upsertVectors, deleteVectors } from '../config/pinecone';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('product-service');

export interface ProductInput {
  name: string;
  description: string;
  price: number;
  stockQuantity?: number;
  category?: string;
  imageUrl?: string;
}

function namespaceFor(businessId: string): string {
  return `business_${businessId}`;
}

function embeddingTextFor(product: { name: string; description: string; category?: string; price: number }): string {
  return `${product.name}. ${product.description}${product.category ? ` Category: ${product.category}.` : ''} Price: $${product.price}.`;
}

export class ProductService {
  async listProducts(businessId: string, includeInactive = false): Promise<IProduct[]> {
    const filter: Record<string, any> = { businessId };
    if (!includeInactive) filter.isActive = true;
    return ProductModel.find(filter).sort({ createdAt: -1 });
  }

  async getProduct(businessId: string, productId: string): Promise<IProduct | null> {
    return ProductModel.findOne({ _id: productId, businessId });
  }

  async createProduct(businessId: string, input: ProductInput): Promise<IProduct> {
    const product = await ProductModel.create({
      businessId,
      name: input.name,
      description: input.description,
      price: input.price,
      stockQuantity: input.stockQuantity ?? 0,
      category: input.category,
      imageUrl: input.imageUrl,
      isActive: true,
    });

    await this.syncVector(businessId, product);

    logger.info('Product created', { businessId, productId: product._id });
    return product;
  }

  async updateProduct(
    businessId: string,
    productId: string,
    updates: Partial<ProductInput> & { isActive?: boolean }
  ): Promise<IProduct | null> {
    const product = await ProductModel.findOne({ _id: productId, businessId });
    if (!product) return null;

    const searchableFieldsChanged =
      (updates.name !== undefined && updates.name !== product.name) ||
      (updates.description !== undefined && updates.description !== product.description) ||
      (updates.category !== undefined && updates.category !== product.category) ||
      (updates.price !== undefined && updates.price !== product.price);

    if (updates.name !== undefined) product.name = updates.name;
    if (updates.description !== undefined) product.description = updates.description;
    if (updates.price !== undefined) product.price = updates.price;
    if (updates.stockQuantity !== undefined) product.stockQuantity = updates.stockQuantity;
    if (updates.category !== undefined) product.category = updates.category;
    if (updates.imageUrl !== undefined) product.imageUrl = updates.imageUrl;
    if (updates.isActive !== undefined) product.isActive = updates.isActive;

    await product.save();

    // Only re-embed when the AI-searchable text actually changed - stock-only
    // edits go through updateStock() and never reach here anyway.
    if (searchableFieldsChanged) {
      await this.syncVector(businessId, product);
    }

    logger.info('Product updated', { businessId, productId });
    return product;
  }

  /**
   * Fast path for stock edits - single-field write, no re-embedding, no Pinecone call.
   */
  async updateStock(businessId: string, productId: string, stockQuantity: number): Promise<IProduct | null> {
    const product = await ProductModel.findOneAndUpdate(
      { _id: productId, businessId },
      { stockQuantity },
      { new: true }
    );
    if (product) {
      logger.info('Product stock updated', { businessId, productId, stockQuantity });
    }
    return product;
  }

  async deleteProduct(businessId: string, productId: string): Promise<boolean> {
    const product = await ProductModel.findOne({ _id: productId, businessId });
    if (!product) return false;

    if (product.pineconeVectorId) {
      try {
        await deleteVectors(namespaceFor(businessId), [product.pineconeVectorId]);
      } catch (error: any) {
        logger.warn('Failed to delete product vector (continuing with Mongo delete)', {
          businessId,
          productId,
          error: error.message,
        });
      }
    }

    await ProductModel.deleteOne({ _id: productId, businessId });
    logger.info('Product deleted', { businessId, productId });
    return true;
  }

  /**
   * Look up live stock/price for a set of product IDs - used by chat.service.ts
   * after a Pinecone match, so responses never show stale numbers.
   */
  async getProductsByIds(businessId: string, productIds: string[]): Promise<IProduct[]> {
    if (productIds.length === 0) return [];
    return ProductModel.find({ businessId, _id: { $in: productIds }, isActive: true });
  }

  private async syncVector(businessId: string, product: IProduct): Promise<void> {
    try {
      const text = embeddingTextFor(product);
      const [embedded] = await embeddingService.embedTexts([text]);
      if (!embedded) return;

      const vectorId = product.pineconeVectorId || `product_${uuidv4()}`;

      await upsertVectors(namespaceFor(businessId), [
        {
          id: vectorId,
          values: embedded.embedding,
          metadata: {
            type: 'product',
            productId: String(product._id),
            businessId: String(businessId),
            name: product.name,
            price: product.price,
            imageUrl: product.imageUrl || '',
            text,
          },
        },
      ]);

      if (product.pineconeVectorId !== vectorId) {
        product.pineconeVectorId = vectorId;
        await product.save();
      }
    } catch (error: any) {
      // Product still exists in Mongo even if embedding fails - it just won't
      // be searchable by the chatbot until the next successful sync.
      logger.error('Product vector sync failed', {
        businessId,
        productId: product._id,
        error: error.message,
      });
    }
  }
}

export const productService = new ProductService();
