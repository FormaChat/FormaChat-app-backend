import Business from '../models/business.model';
import { uploadRawBuffer } from '../config/cloudinary';
import { vectorService } from './vector.service';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('document-service');

export interface BusinessDocument {
  fileName: string;
  fileUrl: string;
  uploadDate: Date;
  fileSize: number;
}

export class DocumentService {
  async uploadDocument(
    businessId: string,
    file: { buffer: Buffer; originalname: string; size: number }
  ): Promise<BusinessDocument> {
    const safeName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const fileUrl = await uploadRawBuffer(file.buffer, `formachat/documents/${businessId}`, safeName);

    const doc: BusinessDocument = {
      fileName: file.originalname,
      fileUrl,
      uploadDate: new Date(),
      fileSize: file.size,
    };

    await Business.updateOne({ _id: businessId }, { $push: { 'files.documents': doc } });

    // Best-effort - the document is saved either way, re-sync just makes it searchable
    vectorService.triggerVectorUpdate(businessId).catch((error: any) => {
      logger.error('Vector sync after document upload failed', { businessId, error: error.message });
    });

    logger.info('Document uploaded', { businessId, fileName: file.originalname });
    return doc;
  }

  async deleteDocument(businessId: string, fileName: string): Promise<boolean> {
    const business = await Business.findById(businessId);
    if (!business?.files?.documents?.some(d => d.fileName === fileName)) return false;

    await Business.updateOne({ _id: businessId }, { $pull: { 'files.documents': { fileName } } });

    vectorService.triggerVectorUpdate(businessId).catch((error: any) => {
      logger.error('Vector sync after document delete failed', { businessId, error: error.message });
    });

    logger.info('Document deleted', { businessId, fileName });
    return true;
  }
}

export const documentService = new DocumentService();
