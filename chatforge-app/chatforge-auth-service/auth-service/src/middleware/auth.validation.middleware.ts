import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { createLogger, getRequestId } from '../utils/auth.logger.utils';
import { OTPType } from '../types/auth.types';

const passwordRequirements = 'Password must be at least 8 characters and contain uppercase, lowercase, and a number';

export const registerSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      passwordRequirements
    ),
  
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name is too long')
    .trim()
    .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes')
});

export const loginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  password: z.string()
    .min(1, 'Password is required')
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string()
    .min(1, 'Refresh token is required')
});

export const resetPasswordSchema = z.object({
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      passwordRequirements
    ),
  
  confirmPassword: z.string()
    .min(1, 'Please confirm your password')
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

export const requestPasswordResetSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim()
});

export const generateOTPSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  type: z.nativeEnum(OTPType, {
    message: `OTP type must be one of: ${Object.values(OTPType).join(', ')}`
  })
});

export const verifyOtpSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must contain only numbers'),

  type: z.nativeEnum(OTPType)
});

export const resendOTPSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  
  type: z.nativeEnum(OTPType, {
    message: `OTP type must be one of: ${Object.values(OTPType).join(', ')}`
  })
});

export const updateProfileSchema = z.object({
  firstName: z.string()
    .min(2, 'First name must be at least 2 characters')
    .max(100, 'First name is too long')
    .trim()
    .regex(/^[a-zA-Z\s'-]+$/, 'First name can only contain letters, spaces, hyphens, and apostrophes')
    .optional(),
  
  lastName: z.string()
    .min(2, 'Last name must be at least 2 characters')
    .max(100, 'Last name is too long')
    .trim()
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name can only contain letters, spaces, hyphens, and apostrophes')
    .optional()
}).refine((data) => data.firstName || data.lastName, {
  message: 'At least one field must be provided for update'
});

// deleteAccountSchema already created earlier:
export const deleteAccountSchema = z.object({
  password: z.string()
    .min(1, 'Password is required for account deletion')
});

export const changePasswordSchema = z.object({
  currentPassword: z.string()
    .min(1, 'Current password is required'),
  
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      passwordRequirements
    ),
  
  confirmPassword: z.string()
    .min(1, 'Please confirm your password')
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'New password must be different from current password',
  path: ['newPassword']
});

export const validatePasswordSchema = z.object({
  password: z.string()
    .min(1, 'Password is required')
});

export const validateRequest = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req);
    const logger = createLogger(requestId);

    try {
      const validatedData = schema.parse(req.body);
      req.body = validatedData;
      
      logger.debug('Request validation successful', {
        path: req.path,
        method: req.method
      });
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        logger.warn('Request validation failed', {
          path: req.path,
          method: req.method,
          errors: formattedErrors,
          ip: req.ip
        });

        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: formattedErrors,
            timestamp: new Date().toISOString(),
            requestId
          }
        });
      }
      
      next(error);
    }
  };
};