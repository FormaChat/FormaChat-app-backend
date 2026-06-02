import helmet from 'helmet';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('helmet');

class SecurityHeadersManager {
  private static instance: SecurityHeadersManager;

  private constructor() {}

  public static getInstance(): SecurityHeadersManager {
    if (!SecurityHeadersManager.instance) {
      SecurityHeadersManager.instance = new SecurityHeadersManager();
    }
    return SecurityHeadersManager.instance;
  }

  /**
   * Production-ready Helmet security configuration
   */
  public getSecurityConfig() {
    const isProduction = process.env.NODE_ENV === 'production';

    return helmet({
      contentSecurityPolicy: {
        directives: this.getCSPDirectives(isProduction),
      },
      crossOriginEmbedderPolicy: isProduction,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: this.getHSTSConfig(isProduction),
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    });
  }

  /**
   * Content Security Policy
   */
  private getCSPDirectives(isProduction: boolean) {
    const directives: any = {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    };

    // Remove null values
    Object.keys(directives).forEach(key => {
      if (directives[key] === null) delete directives[key];
    });

    return directives;
  }

  /**
   * HSTS configuration
   */
  private getHSTSConfig(isProduction: boolean) {
    return {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: isProduction,
    };
  }

  /**
   * Additional custom headers (set service name here)
   */
  public getCustomSecurityHeaders(serviceName: string = 'formachat-chat-service') {
    return (req: any, res: any, next: any) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
      res.setHeader('X-Download-Options', 'noopen');

      // Custom service header
      res.setHeader(`X-${serviceName}`, serviceName);
      res.setHeader('X-API-Version', '1.0.0');

      // Remove server identification
      res.removeHeader('X-Powered-By');
      res.removeHeader('Server');

      next();
    };
  }

  /**
   * Development config (less strict for debugging)
   */
  public getDevelopmentSecurityConfig() {
    return helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts: false,
    });
  }

  /**
   * Log security events
   */
  public logSecurityEvent(event: string, details: any) {
    logger.warn('🛡️ Security event', {
      event,
      ...details,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Validate security headers in responses
   */
  public validateSecurityHeaders(headers: any): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const requiredHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
    ];

    requiredHeaders.forEach(header => {
      if (!headers[header]) {
        issues.push(`Missing security header: ${header}`);
      }
    });

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

// Singleton instance export
export const securityHeadersManager = SecurityHeadersManager.getInstance();
