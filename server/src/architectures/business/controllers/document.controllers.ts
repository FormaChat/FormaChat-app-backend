import { Request, Response } from 'express';
import { documentService } from '../services/document.service';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('document-controller');

const ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No document file provided' } });
      return;
    }

    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: 'Only PDF and DOCX files are supported' } });
      return;
    }

    const doc = await documentService.uploadDocument(req.params.id, {
      buffer: file.buffer,
      originalname: file.originalname,
      size: file.size,
    });

    res.status(201).json({ success: true, data: doc });
  } catch (error: any) {
    logger.error('Upload document error:', error.message);
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: 'Failed to upload document' } });
  }
};

export const deleteDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await documentService.deleteDocument(req.params.id, decodeURIComponent(req.params.fileName));
    if (!deleted) {
      res.status(404).json({ success: false, error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' } });
      return;
    }
    res.json({ success: true, message: 'Document deleted' });
  } catch (error: any) {
    logger.error('Delete document error:', error.message);
    res.status(500).json({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete document' } });
  }
};
