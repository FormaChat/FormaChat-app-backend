import { Request, Response } from 'express';
import { prefillService } from '../services/prefill.service';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('prefill-controller');

const ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const generatePrefill = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    const rawText = (req.body?.rawText as string) || '';

    if (file && !ALLOWED_MIMES.includes(file.mimetype)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'Only PDF and DOCX files are supported' },
      });
      return;
    }

    if (!rawText.trim() && !file) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_INPUT', message: 'Paste some text or upload a document' },
      });
      return;
    }

    const result = await prefillService.generatePrefill({
      rawText,
      file: file ? { buffer: file.buffer, mimetype: file.mimetype } : undefined,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Generate prefill error:', error.message);
    res.status(500).json({
      success: false,
      error: { code: 'PREFILL_FAILED', message: error.message || 'Failed to generate suggestions' },
    });
  }
};
