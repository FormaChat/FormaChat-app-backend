import { Resend } from 'resend';
import { createLogger } from '../utils/email.logger.utils';
import { env } from '../config/email.env';

const logger = createLogger('email-provider');

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

// Validate configuration on startup
if (!env.RESEND_API_KEY) {
  logger.warn('RESEND_API_KEY environment variable is not set');
}

const resend = new Resend(env.RESEND_API_KEY as string);
const defaultFrom = env.RESEND_FROM_EMAIL || 'noreply@formachat.com';

function validateEmailOptions({ to, subject, html }: EmailOptions): void {
  if (!to?.trim() || !subject?.trim() || !html?.trim()) {
    throw new Error('Missing required email fields: to, subject, or html');
  }
}

export async function sendEmail({ to, subject, html, from }: EmailOptions): Promise<string> {
  try {
    validateEmailOptions({ to, subject, html });
    
    logger.info('📨 Attempting to send email via Resend', { to, subject });

    const response = await resend.emails.send({
      from: defaultFrom,
      to,
      subject,
      html,
    });

    if (response.error) {
      throw new Error(`Resend API error: ${response.error.message}`);
    }

    const emailId = response.data?.id;

    logger.info('✅ Email successfully sent via Resend', {
      to,
      subject,
      id: emailId,
    });

    return emailId;
  } catch (error: any) {
    logger.error('❌ Failed to send email via Resend', {
      to,
      subject,
      error: error.message,
    });
    throw error;
  }
}