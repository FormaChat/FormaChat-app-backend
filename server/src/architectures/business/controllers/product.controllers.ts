import { Request, Response } from 'express';
import { productService } from '../services/product.service';
import { uploadImageBuffer } from '../config/cloudinary';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('product-controller');

export const listProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const products = await productService.listProducts(req.params.id, true);
    res.json({ success: true, data: products });
  } catch (error: any) {
    logger.error('List products error:', error.message);
    res.status(500).json({ success: false, error: { code: 'LIST_PRODUCTS_FAILED', message: 'Failed to list products' } });
  }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, price, stockQuantity, category, imageUrl } = req.body;

    if (!name || !description || price === undefined || price === null) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'name, description, and price are required' },
      });
      return;
    }

    const parsedPrice = Number(price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PRICE', message: 'price must be a non-negative number' } });
      return;
    }

    const product = await productService.createProduct(req.params.id, {
      name,
      description,
      price: parsedPrice,
      stockQuantity: stockQuantity !== undefined ? Number(stockQuantity) : undefined,
      category,
      imageUrl,
    });

    res.status(201).json({ success: true, data: product });
  } catch (error: any) {
    logger.error('Create product error:', error.message);
    res.status(500).json({ success: false, error: { code: 'CREATE_PRODUCT_FAILED', message: 'Failed to create product' } });
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, price, stockQuantity, category, imageUrl, isActive } = req.body;

    if (price !== undefined) {
      const parsedPrice = Number(price);
      if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PRICE', message: 'price must be a non-negative number' } });
        return;
      }
    }

    const product = await productService.updateProduct(req.params.id, req.params.productId, {
      name,
      description,
      price: price !== undefined ? Number(price) : undefined,
      stockQuantity: stockQuantity !== undefined ? Number(stockQuantity) : undefined,
      category,
      imageUrl,
      isActive,
    });

    if (!product) {
      res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } });
      return;
    }

    res.json({ success: true, data: product });
  } catch (error: any) {
    logger.error('Update product error:', error.message);
    res.status(500).json({ success: false, error: { code: 'UPDATE_PRODUCT_FAILED', message: 'Failed to update product' } });
  }
};

export const updateProductStock = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stockQuantity } = req.body;
    const parsed = Number(stockQuantity);

    if (Number.isNaN(parsed) || parsed < 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_STOCK', message: 'stockQuantity must be a non-negative number' } });
      return;
    }

    const product = await productService.updateStock(req.params.id, req.params.productId, parsed);

    if (!product) {
      res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } });
      return;
    }

    res.json({ success: true, data: { id: product._id, stockQuantity: product.stockQuantity } });
  } catch (error: any) {
    logger.error('Update stock error:', error.message);
    res.status(500).json({ success: false, error: { code: 'UPDATE_STOCK_FAILED', message: 'Failed to update stock' } });
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await productService.deleteProduct(req.params.id, req.params.productId);
    if (!deleted) {
      res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } });
      return;
    }
    res.json({ success: true, message: 'Product deleted' });
  } catch (error: any) {
    logger.error('Delete product error:', error.message);
    res.status(500).json({ success: false, error: { code: 'DELETE_PRODUCT_FAILED', message: 'Failed to delete product' } });
  }
};

export const uploadProductImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No image file provided' } });
      return;
    }

    if (!file.mimetype.startsWith('image/')) {
      res.status(400).json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: 'File must be an image' } });
      return;
    }

    const imageUrl = await uploadImageBuffer(file.buffer, `formachat/products/${req.params.id}`);
    res.json({ success: true, data: { imageUrl } });
  } catch (error: any) {
    logger.error('Upload product image error:', error.message);
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: 'Failed to upload image' } });
  }
};
