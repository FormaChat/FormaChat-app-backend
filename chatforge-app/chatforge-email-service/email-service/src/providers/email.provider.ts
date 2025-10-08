
import { logger } from '../utils/email.logger.utils';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Simple email sender - replace with actual Nodemailer/SendGrid later
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  // TODO: Replace with actual email sending logic
  logger.info('📧 [EMAIL SENT]', {
    to: options.to,
    subject: options.subject,
    html: options.html.substring(0, 100) + '...' // Log first 100 chars
  });

  // For now, just log the email instead of actually sending
  console.log('=== EMAIL CONTENT ===');
  console.log('To:', options.to);
  console.log('Subject:', options.subject);
  console.log('HTML:', options.html);
  console.log('=====================');
}