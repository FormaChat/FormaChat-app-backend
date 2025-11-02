# Controllers

1. `auth.register.controller.ts` - User registration & email verification

2. `auth.login.controller.ts` - User authentication & session management

3. `auth.otp.controller.ts` - OTP generation, verification & resend

4. `auth.password.controller.ts` - Password management & reset flows

5. `auth.token.controller.ts` - Token operations & refresh

6. `auth.user.controller.ts` - Profile management & account operations

7. `auth.health.controller.ts` - Health checks & monitoring

8. `auth.admin.controller.ts` - Internal APIs for admin service

# Routes

Health:
GET /api/v1/auth/health
GET /api/v1/auth/ready
GET /api/v1/auth/live

Auth:
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout

OTP:
POST /api/v1/auth/otp/generate
POST /api/v1/auth/otp/verify
POST /api/v1/auth/otp/resend

Password:
POST /api/v1/auth/password/change
POST /api/v1/auth/password/reset
POST /api/v1/auth/password/reset/confirm
POST /api/v1/auth/password/validate

Token:
POST /api/v1/auth/token/refresh
POST /api/v1/auth/token/validate

User:
GET /api/v1/auth/profile
PUT /api/v1/auth/profile
DELETE /api/v1/auth/profile
GET /api/v1/auth/sessions
POST /api/v1/auth/verify-email

Internal:
GET /internal/auth/otp/:otpId
GET /internal/auth/users/:userId

# Middlewares

`auth.errorHandler.middleware.ts `(foundation)

`auth.rateLimiter.middleware.ts`(security-critical)

`auth.validation.middleware.ts` (with Zod)

`auth.jwt.middleware.ts` (authentication)

`auth.internalAuth.middleware.ts` (service communication)

`auth.idempotency.middleware.ts` (duplicate prevention)

`auth.logger.middleware.ts` (observability)
