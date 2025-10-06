export enum OTPType {
  EMAIL_VERIFICATION = 'email_verification',
  PASSWORD_RESET = 'password_reset',
  TWO_FACTOR_AUTH = '2fa'
}

export enum AuditEventType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  REGISTER = 'register',
  PASSWORD_CHANGE = 'password_change',
  PASSWORD_RESET = 'password_reset',
  EMAIL_VERIFIED = 'email_verified',
  OTP_GENERATED = 'otp_generated',
  OTP_VERIFIED = 'otp_verified',
  ACCOUNT_DEACTIVATED = 'account_deactivated',
  TOKEN_REFRESHED = 'token_refreshed'
}