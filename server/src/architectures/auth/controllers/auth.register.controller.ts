import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { otpService } from '../services/auth.otp.service';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('register-controller');

export class RegisterController {
  /**
   * Register new user.
   */
  async register(req: Request, res: Response) {
    try {
      const { email, password, firstName, lastName } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Basic validation
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({
          success: false,
          error: 'All fields are required: email, password, firstName, lastName'
        });
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }

      // Register user
      const user = await userService.registerUser(
        { email, password, firstName, lastName },
        { ipAddress, userAgent }
      );

      // Generate email verification OTP
      const { otpId } = await otpService.generateOTP({
        userId: user.id,
        type: 'email_verification',
        metadata: { ipAddress, userAgent }
      });

      // TODO: Publish user.created event for user service
      // TODO: Publish email.verification event with otpId

      // Return user data (excluding sensitive information)
      const userData = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
        createdAt: user.createdAt
      };

      res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email for verification.',
        data: {
          user: userData,
          requiresVerification: true
        }
      });

    } catch (error: any) {
      logger.error('Registration error:', error);
      
      if (error.message === 'USER_ALREADY_EXISTS') {
        return res.status(409).json({
          success: false,
          error: {
            code: 'USER_ALREADY_EXISTS',
            message: 'User with this email already exists'
          }
        });
      }

      if (error.message.startsWith('WEAK_PASSWORD')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WEAK_PASSWORD',
            message: error.message.replace('WEAK_PASSWORD: ', '')
          }
        });
      }

      res.status(500).json({
        success: false,
        error: 'Registration failed'
      });
    }
  }

  /**
   * Verify email after registration
   */
  async verifyEmail(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;
      const ipAddress = req.ip;
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!email || !otp) {
        return res.status(400).json({
          success: false,
          error: 'Email and OTP are required'
        });
      }

      const user = await userService.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Verify OTP
      const otpResult = await otpService.verifyOTP(user.id, otp, 'email_verification');
      
      if (!otpResult.valid) {
        return res.status(400).json({
          success: false,
          error: otpResult.error || 'Invalid verification code'
        });
      }

      // Mark email as verified
      await userService.verifyUserEmail(user.id);

      // Return updated user data
      const userData = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: true,
        createdAt: user.createdAt
      };

      res.json({
        success: true,
        message: 'Email verified successfully',
        data: {
          user: userData
        }
      });

    } catch (error: any) {
      logger.error('Email verification error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Email verification failed'
      });
    }
  }

  /**
   * Check if email is available
   */
  // async checkEmailAvailability(req: Request, res: Response) {
  //   try {
  //     const { email } = req.query;

  //     if (!email || typeof email !== 'string') {
  //       return res.status(400).json({
  //         success: false,
  //         error: 'Email query parameter is required'
  //       });
  //     }

  //     const user = await userService.getUserByEmail(email);
      
  //     res.json({
  //       success: true,
  //       data: {
  //         email,
  //         available: !user
  //       }
  //     });

  //   } catch (error: any) {
  //     logger.error('Email availability check error:', error);
      
  //     res.status(500).json({
  //       success: false,
  //       error: 'Failed to check email availability'
  //     });
  //   }
  // }
}

export const registerController = new RegisterController();