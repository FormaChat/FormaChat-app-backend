import fs from 'fs';
import path from 'path';
import handlebars from 'handlebars';
import { logger } from '../utils/email.logger.utils';

export interface WelcomeTemplateData {
  firstName?: string;
  lastName?: string;
}

export interface OTPTemplateData {
  otp: string;
  type: 'email_verification' | 'password_reset' | '2fa';
}

export interface PasswordChangedTemplateData {
  changedAt: Date;
}

export interface AccountDeactivatedTemplateData {
  deactivatedAt: Date;
  reason?: string;
}

export class TemplateService {
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(private templatesDir: string = path.join(__dirname, '../templates')) {}

  /**
   * Render welcome email template
   */
  renderWelcomeEmail(data: WelcomeTemplateData): string {
    return this.renderTemplate('welcome', {
      firstName: data.firstName || 'there',
      lastName: data.lastName || '',
      currentYear: new Date().getFullYear()
    });
  }

  /**
   * Render OTP email template based on type
   */
  renderOTPEmail(data: OTPTemplateData): string {
    const subjectMap = {
      email_verification: 'Verify Your Email',
      password_reset: 'Reset Your Password',
      '2fa': 'Two-Factor Authentication'
    };

    const messageMap = {
      email_verification: 'verify your email address',
      password_reset: 'reset your password',
      '2fa': 'complete two-factor authentication'
    };

    return this.renderTemplate('otp', {
      otp: data.otp,
      subject: subjectMap[data.type],
      message: messageMap[data.type],
      currentYear: new Date().getFullYear()
    });
  }

  /**
   * Render password changed confirmation template
   */
  renderPasswordChangedEmail(data: PasswordChangedTemplateData): string {
    return this.renderTemplate('password-changed', {
      changedAt: data.changedAt.toLocaleDateString(),
      currentYear: new Date().getFullYear()
    });
  }

  /**
   * Render account deactivation template
   */
  renderAccountDeactivatedEmail(data: AccountDeactivatedTemplateData): string {
    return this.renderTemplate('account-deactivated', {
      deactivatedAt: data.deactivatedAt.toLocaleDateString(),
      reason: data.reason || 'Account deactivation',
      currentYear: new Date().getFullYear()
    });
  }

  /**
   * Generic template renderer with caching
   */
  private renderTemplate(templateName: string, data: any): string {
    try {
      let template = this.templateCache.get(templateName);
      
      if (!template) {
        const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);
        const templateSource = fs.readFileSync(templatePath, 'utf8');
        template = handlebars.compile(templateSource);
        this.templateCache.set(templateName, template);
      }

      return template(data);
    } catch (error: any) {
      logger.error('Failed to render template', {
        templateName,
        error: error.message
      });
      throw new Error(`Template rendering failed: ${templateName}`);
    }
  }
}

// Singleton instance
export const templateService = new TemplateService();