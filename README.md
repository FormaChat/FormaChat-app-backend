# FormaChat Backend

Backend for [www.formachat.com](https://www.formachat.com) — a platform that lets businesses deploy AI-powered chatbots trained on their own data.

The system is built as a **microservices architecture** using Node.js + TypeScript. There are currently **6 services**, 4 of which are production-ready and 2 that are in early development.

---

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────────┐
│   Auth Service      │────▶│   Email Service          │
│   (Port: configurable)    │  (RabbitMQ consumer only) │
└─────────┬───────────┘     └──────────────────────────┘
          │ JWT / Internal Secret
          ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  Business Profile   │────▶│   Chat Service           │
│  Service            │     │   (AI chatbot engine)    │
└─────────────────────┘     └──────────────────────────┘

┌─────────────────────┐     ┌──────────────────────────┐
│  Payment System     │     │  Platform Integration    │
│  [IN PROGRESS]      │     │  [SCAFFOLDED]            │
└─────────────────────┘     └──────────────────────────┘

Shared Infrastructure: MongoDB · Redis · RabbitMQ · Pinecone · OpenAI · Groq
```

---

## Services

### 1. Auth Service (`formachat-auth-service`)
**Status: Complete**

Handles all user identity: registration, login, OTP verification, password management, session tracking, and internal token validation for other services.

**Tech:** Express 5 · MongoDB · Redis · RabbitMQ · bcrypt · JWT · Winston

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register new user |
| POST | `/verify-email` | Verify email with OTP |
| POST | `/login` | Login (returns access + refresh token) |
| POST | `/logout` | Logout and invalidate token |
| GET | `/me` | Check current auth status |
| POST | `/otp/generate` | Generate OTP |
| POST | `/otp/verify` | Verify OTP |
| POST | `/otp/resend` | Resend OTP |
| POST | `/password/change` | Change password (authenticated) |
| POST | `/password/reset` | Request password reset (sends OTP) |
| POST | `/password/reset/confirm` | Confirm reset with OTP |
| POST | `/password/validate` | Validate password strength |
| POST | `/token/refresh` | Refresh access token |
| POST | `/token/validate` | Validate token (internal service use) |
| POST | `/token/revoke-others` | Revoke all other sessions |
| GET | `/profile` | Get user profile |
| PUT | `/profile` | Update user profile |
| DELETE | `/profile` | Deactivate account (soft delete) |
| GET | `/sessions` | Get active sessions |
| POST | `/feedback` | Submit user feedback |
| GET | `/internal/otp/:otpId` | Fetch OTP (internal — email service) |
| GET | `/internal/users/:userId` | Get user details (internal) |
| GET | `/internal/audit-logs` | Get audit logs (internal) |
| POST | `/internal/users/:userId/lock` | Lock user account (internal) |

**Rate Limiting (Redis-backed):**
- Registration: 5 attempts/hour
- Login: 5 attempts/15 min
- OTP generate: 3/hour · OTP verify: 10/15 min · OTP resend: 2/hour
- Password reset: 3/hour · Token refresh: 10/15 min

**Events Published (RabbitMQ):**
- `authUserCreated` — on new registration
- `authOtpGenerated` — on OTP creation
- `authPasswordChanged` — on password change
- `authUserDeactivated` — on account deactivation
- `authFeedbackSubmitted` — on feedback submission

**Environment Variables:**
```
MONGODB_URI, NODE_ENV, PORT
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
INTERNAL_SERVICE_SECRET
AUTH_SERVICE_URL, BUSINESS_PROFILE_SERVICE, CHAT_SERVICE_URL, EMAIL_SERVICE_URL
RABBITMQ_URL, REDIS_URL
```

---

### 2. Business Profile Service (`formachat-business-profile-service`)
**Status: Complete**

Handles all business data: onboarding questionnaire, vector embedding (RAG setup), admin controls, and internal config delivery to the chat service.

**Tech:** Express 5 · MongoDB · Pinecone · OpenAI · Cloudinary · Redis · JWT · Winston

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/businesses/public/:id` | None | Public business info |
| POST | `/businesses` | User JWT | Create business profile |
| GET | `/businesses` | User JWT | List user's businesses |
| GET | `/businesses/:id` | User JWT + Ownership | Get business details |
| PUT | `/businesses/:id` | User JWT + Ownership + Active | Update business |
| DELETE | `/businesses/:id` | User JWT + Ownership | Delete business |
| GET | `/admin/businesses` | Admin | List all businesses (paginated) |
| GET | `/admin/businesses/:id` | Admin | Get single business |
| PATCH | `/admin/businesses/:id/status` | Admin | Freeze / unfreeze business |
| GET | `/admin/analytics` | Admin | Platform statistics |
| GET | `/admin/frozen-businesses` | Admin | List frozen businesses |
| GET | `/internal/businesses/:id/chat-config` | Service Secret | Chat config for chat service |

**Business Data Model (key fields):**
- `basicInfo` — name, description, type, operating hours, location, timezone
- `productsServices` — offerings, popular items (name/description/price), service delivery modes, pricing display settings
- `customerSupport` — FAQs, refund/cancellation policies, chatbot tone (Friendly/Professional/Casual/Formal/Playful), greeting, restrictions
- `contactEscalation` — contact methods, escalation contact, chatbot capabilities
- `files` — documents and images (PRO+ tiers, stored in Cloudinary)
- `vectorInfo` — Pinecone namespace (`business_<id>`), vector status (`pending/completed/failed/frozen`), sync tracking
- `freezeInfo` — frozen state, reason, frozen by (system/admin), auto-unfreeze date

**Services:**
- `business.service.ts` — CRUD and ownership logic
- `embedding.service.ts` — OpenAI text embedding
- `vector.service.ts` — Pinecone upsert/query

**Environment Variables:**
```
NODE_ENV, PORT
INTERNAL_SERVICE_SECRET, ADMIN_API_KEY
MONGODB_URI
PINECONE_API_KEY
OPENAI_API_KEY
JWT_ACCESS_SECRET
CORS_ORIGIN
API_SECRET_CLOUDINARY, API_KEY_CLOUDINARY, CLOUDINARY_URL
REDIS_URL
```

---

### 3. Chat Service (`formachat-chat-service`)
**Status: Complete**

The core AI chatbot engine. Manages sessions, handles user messages, queries Pinecone for business context, and generates responses via Groq LLM. Also tracks leads and provides the business owner dashboard.

**Tech:** Express 5 · MongoDB · Pinecone · Groq · Redis · JWT · Winston

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/session/create` | None | Start a new chat session |
| GET | `/session/:sessionId` | None | Get session info |
| POST | `/session/:sessionId/message` | None | Send a message |
| POST | `/session/:sessionId/message/stream` | None | Send a message (streaming response) |
| GET | `/session/:sessionId/messages` | None | Get message history |
| POST | `/session/:sessionId/end` | None | End session |
| GET | `/business/:businessId/sessions` | User JWT + Ownership | Business owner: list all sessions |
| GET | `/business/:businessId/leads` | User JWT + Ownership | Business owner: view leads/contacts |
| GET | `/business/:businessId/session/:sessionId` | User JWT + Ownership | Business owner: session detail |
| DELETE | `/business/:businessId/session/:sessionId` | User JWT + Ownership | Delete session |
| GET | `/business/:businessId/dashboard-summary` | User JWT + Ownership | Dashboard analytics |
| POST | `/internal/cleanup/messages` | Service Secret | Cron: soft-delete old messages |
| POST | `/internal/cleanup/sessions` | Service Secret | Cron: mark abandoned sessions |
| GET | `/health` | None | Health check |

**Data Models:**
- `ChatSession` — session metadata, contact capture, status (active/ended/abandoned), message counts, intent detection, agent handoff fields, analytics flags
- `ChatMessage` — role (user/assistant/system), content, extracted contact info, LLM metadata (model, tokens, latency), vector context used
- `ContactLead` — deduplicated CRM record per business; never deleted; tracks total sessions, messages, lead status (new/contacted/qualified/converted/spam), lead score, notes

**Data Retention:**
- Messages: soft-deleted after 7 days (FREE tier) via cron job
- Sessions: kept permanently for analytics
- Leads: kept permanently (business's most valuable data)

**Environment Variables:**
```
NODE_ENV, PORT
INTERNAL_SERVICE_SECRET, ADMIN_API_KEY
MONGODB_URI
PINECONE_API_KEY
BUSINESS_SERVICE_URL
JWT_ACCESS_SECRET
GROQ_API_KEY
REDIS_URL
```

---

### 4. Email Service (`formachat-email-service`)
**Status: Complete**

A pure RabbitMQ consumer — no public HTTP endpoints. Listens for events from the Auth service and sends transactional emails via Resend.

**Tech:** RabbitMQ (amqplib) · Resend API · Handlebars templates · Redis · Winston

**Consumed Queues:**

| Queue | Trigger | Email Sent |
|-------|---------|-----------|
| `authUserCreated` | New user registered | Welcome email |
| `authOtpGenerated` | OTP created (verify/reset/2FA) | OTP email |
| `authPasswordChanged` | Password changed | Confirmation email |
| `authUserDeactivated` | Account deactivated | Deactivation confirmation |
| `authFeedbackSubmitted` | Feedback submitted | Feedback forwarded to support |

**Retry Strategy:**
- Up to 3 retries for retriable errors (network timeouts, SMTP 4xx, rate limits)
- NACK with requeue on retriable errors under retry limit
- Dead Letter Queue (DLQ) on permanent errors or after max retries
- Publishes email success/failure status back to Auth service

**Environment Variables:**
```
NODE_ENV, PORT
AUTH_SERVICE_URL, BUSINESS_PROFILE_SERVICE, CHAT_SERVICE_URL, EMAIL_SERVICE_URL
INTERNAL_SERVICE_SECRET
RESEND_API_KEY, RESEND_FROM_EMAIL
RABBITMQ_URL, REDIS_URL
```

---

### 5. Payment System (`formachat-payment-system`)
**Status: In Progress — files scaffolded, implementation not started**

Planned service for handling subscriptions and billing. Files (`payment.route.ts`, `payment.controller.ts`, `payment.model.ts`) exist but are empty. No `.env.example` yet.

**Planned integrations:** Stripe (likely based on project direction)

---

### 6. Platform Integration Service (`formachat-platform-integration`)
**Status: Scaffolded — routes defined, implementation empty**

Planned service to connect the FormaChat chatbot to external messaging platforms and embed it via a web widget.

**Route files exist for:**
- WhatsApp (`/whatsapp/*`)
- Telegram (`/telegram/*`)
- Web widget (`/widget/*`)
- Web embed (`/web/*`)
- QR code (`/qr/*`)

All controller files are empty. No substantial logic implemented yet.

---

## Shared Infrastructure

| Service | Purpose |
|---------|---------|
| **MongoDB** | Primary database for all services |
| **Redis** | Rate limiting, session caching, token blacklisting |
| **RabbitMQ** | Async event bus between Auth and Email services |
| **Pinecone** | Vector database for business knowledge (RAG) |
| **OpenAI** | Text embeddings (Business Profile Service) |
| **Groq** | LLM inference for chat responses (Chat Service) |
| **Cloudinary** | File and image storage (Business Profile — PRO+ tiers) |
| **Resend** | Transactional email delivery (Email Service) |

---

## Service-to-Service Communication

- **JWT validation:** Other services call `POST /token/validate` on the Auth service using an `INTERNAL_SERVICE_SECRET` header.
- **Business config:** Chat service calls `GET /internal/businesses/:id/chat-config` on the Business Profile service before each chat to get the Pinecone namespace, chatbot tone, restrictions, and access status.
- **Email events:** Auth service publishes to RabbitMQ; Email service consumes and delivers.
- **Admin actions (freeze/unfreeze):** Admin API on Business Profile service; future integration with Payment service for automatic freeze on payment failure.

---

## Current State Summary

| Service | Core Logic | Routes | Tests | Status |
|---------|-----------|--------|-------|--------|
| Auth | Complete | Complete | Partial | Production-ready |
| Business Profile | Complete | Complete | — | Production-ready |
| Chat | Complete | Complete | — | Production-ready |
| Email | Complete | N/A (consumer) | — | Production-ready |
| Payment System | Not started | Scaffolded | — | In progress |
| Platform Integration | Not started | Scaffolded | — | Scaffolded |

---

## What's Next

- **Payment System:** Design the subscription model, integrate Stripe, hook freeze/unfreeze logic into the Business Profile service.
- **Platform Integration:** Implement WhatsApp Business API, Telegram bot, and the embeddable web widget.
- **Tests:** The Auth service has a test setup (Jest + Supertest); expand coverage across services.
- **Admin Panel:** Admin routes exist on Auth and Business Profile; a dashboard frontend or admin service may be needed.
