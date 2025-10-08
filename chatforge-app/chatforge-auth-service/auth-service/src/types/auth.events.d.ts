// events/event.types.ts

/**
 * Base event structure for all RabbitMQ messages
 */
export interface BaseEvent {
  eventId: string;
  eventType: string;
  timestamp: number;
  data: any;
}

/**
 * Publishing options for RabbitMQ messages
 */
export interface PublishOptions {
  eventId: string;
  eventType: string;
  persistent?: boolean;
  priority?: number;
}

// ==================== PRODUCER EVENTS (Auth → Email) ====================

/**
 * Event published when a new user is created/registered
 * Triggers: Welcome email to new user
 */
export interface UserCreatedEventData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Event published when an OTP is generated
 * Triggers: OTP email (verification, login, etc.)
 * Note: Does NOT include actual OTP for security - email service fetches from Auth API
 */
export interface OTPGeneratedEventData {
  userId: string;
  email: string;
  otpId: string;
  type: 'email_verification' | 'password_reset' | '2fa';
}

/**
 * Event published when a user requests password reset
 * Triggers: Password reset email with OTP
 * Note: This is semantically different from OTPGeneratedEventData
 */
export interface PasswordResetRequestedEventData {
  userId: string;
  email: string;
  otpId: string;
  type: 'password_reset';
}

/**
 * Event published when a user changes their password
 * Triggers: Password changed confirmation email
 */
export interface PasswordChangedEventData {
  userId: string;
  email: string;
  changedAt: Date;
}

/**
 * Event published when a user account is deactivated
 * Triggers: Account deactivation confirmation email
 */
export interface UserDeactivatedEventData {
  userId: string;
  email: string;
  deactivatedAt: Date;
  reason?: string;
}

/**
 * Event published when user email is changed (needs re-verification)
 * Triggers: Email verification to new email address
 */
export interface EmailChangedEventData {
  userId: string;
  oldEmail: string;
  newEmail: string;
  otpId?: string; // If OTP is generated for verification
}

// ==================== CONSUMER EVENTS (Email → Auth) ====================

/**
 * Event consumed from email service indicating email send status
 * Auth service listens to know if emails were sent successfully
 */
export interface EmailResponseEventData {
  eventId: string; // References original event that triggered the email
  userId: string;
  email: string;
  emailType: 'welcome' | 'otp' | 'password_reset' | 'password_changed' | 'account_deactivated';
  status: 'sent' | 'failed' | 'bounced';
  sentAt?: Date;
  error?: string;
  provider?: string; // e.g., 'sendgrid', 'smtp'
}

// ==================== HELPER TYPES ====================

/**
 * OTP types enum for type safety
 */
export enum OTPType {
  EMAIL_VERIFICATION = 'email_verification',
  PASSWORD_RESET = 'password_reset',
  TWO_FACTOR_AUTH = '2fa'
}

/**
 * Email types for categorizing emails
 */
export enum EmailType {
  WELCOME = 'welcome',
  OTP = 'otp',
  PASSWORD_RESET = 'password_reset',
  PASSWORD_CHANGED = 'password_changed',
  ACCOUNT_DEACTIVATED = 'account_deactivated',
  EMAIL_VERIFICATION = 'email_verification'
}

/**
 * Email send status
 */
export enum EmailStatus {
  SENT = 'sent',
  FAILED = 'failed',
  BOUNCED = 'bounced',
  PENDING = 'pending'
}