# FormaChat Backend

Backend for [www.formachat.com](https://www.formachat.com) — a platform that lets businesses deploy AI-powered chatbots trained on their own data.

The system is structured as **four domain modules** (auth, business, chat, email) running together inside a **single monolith process**. The code retains the microservice separation internally so the modules can be split back out at any time.

---

## Project Structure

```
server/
├── src/
│   ├── app.ts              ← Express app (middleware + gateway)
│   ├── server.ts           ← Single entry point (boots all dependencies)
│   ├── gateway/            ← Route aggregation layer
│   │   ├── auth.gateway.ts
│   │   ├── business.gateway.ts
│   │   ├── chat.gateway.ts
│   │   ├── email.gateway.ts
│   │   └── index.ts
│   └── architectures/
│       ├── auth/           ← User identity & sessions
│       ├── business/       ← Business profiles & vector embeddings
│       ├── chat/           ← AI chatbot engine
│       └── email/          ← Transactional email (RabbitMQ consumer)
├── .env                    ← Your secrets (never committed)
├── .env.example            ← Template — copy to .env
├── package.json
└── tsconfig.json
```

---

## Architecture

All four modules share one Express app and one port. Every route passes through the gateway before reaching its module.

```
                      HTTP :3000
                          │
                     [ app.ts ]
                    (middleware)
                          │
                    [ gateway/ ]
          ┌───────────────┼───────────────┐
          │               │               │
   auth.gateway    business.gateway   chat.gateway   email.gateway
          │               │               │               │
    /api/v1/auth    /api/v1/*       /api/chat/*    /api/v1/email
          │               │               │               │
   architectures/  architectures/  architectures/  architectures/
      auth/           business/       chat/           email/

Shared: MongoDB · Redis · RabbitMQ · Pinecone · Groq
```

Service-to-service calls (e.g. chat → business for chat config) are plain HTTP to `localhost:PORT` since everything is on the same port.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20.19.0
- pnpm
- MongoDB (Atlas or local)
- Redis (Upstash or local — use `rediss://` for TLS)
- RabbitMQ (CloudAMQP or local)
- Pinecone account
- Groq API key
- Resend API key

### Setup

```bash
cd server

# Install dependencies
pnpm install

# Copy and fill in environment variables
cp .env.example .env
```

Edit `.env` with your credentials. The two most important values for the monolith:

```env
PORT=3000
BUSINESS_SERVICE_URL=http://localhost:3000   # same port — not a separate service
AUTH_SERVICE_URL=http://localhost:3000        # same port
```

### Running

```bash
# Development (nodemon + tsx, hot reload)
pnpm run dev

# Production build
pnpm run build
pnpm start

# Type-check only (no emit)
pnpm run lint
```

---

## API Reference

All routes are prefixed as shown. Full base URL in development: `http://localhost:3000`

### Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Health check |
| POST | `/register` | — | Register new user |
| POST | `/verify-email` | — | Verify email with OTP |
| POST | `/login` | — | Login → access + refresh token |
| POST | `/logout` | JWT | Logout |
| GET | `/me` | JWT | Current auth status |
| POST | `/otp/generate` | — | Generate OTP |
| POST | `/otp/verify` | — | Verify OTP |
| POST | `/otp/resend` | — | Resend OTP |
| POST | `/password/change` | JWT | Change password |
| POST | `/password/reset` | — | Request reset (sends OTP) |
| POST | `/password/reset/confirm` | — | Confirm reset with OTP |
| POST | `/token/refresh` | — | Refresh access token |
| POST | `/token/validate` | Service Secret | Validate token (internal) |
| POST | `/token/revoke-others` | JWT | Revoke all other sessions |
| GET | `/profile` | JWT | Get profile |
| PUT | `/profile` | JWT | Update profile |
| DELETE | `/profile` | JWT | Deactivate account |
| GET | `/sessions` | JWT | Active sessions |
| POST | `/feedback` | JWT | Submit feedback |
| GET | `/internal/users/:userId` | Service Secret | Get user (internal) |
| POST | `/internal/users/:userId/lock` | Service Secret | Lock account (internal) |

**Rate limits (Redis-backed):** registration 5/hr · login 5/15 min · OTP 3/hr · password reset 3/hr

---

### Business — `/api/v1`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/businesses/public/:id` | — | Public business info |
| POST | `/businesses` | JWT | Create business |
| GET | `/businesses` | JWT | List user's businesses |
| GET | `/businesses/:id` | JWT + Ownership | Business details |
| PUT | `/businesses/:id` | JWT + Ownership | Update business |
| DELETE | `/businesses/:id` | JWT + Ownership | Delete business |
| GET | `/internal/businesses/:id/chat-config` | Service Secret | Chat config (internal) |

---

### Chat — `/api/chat`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/session/create` | — | Start chat session |
| GET | `/session/:sessionId` | — | Get session |
| POST | `/session/:sessionId/message` | — | Send message |
| POST | `/session/:sessionId/message/stream` | — | Send message (streaming) |
| GET | `/session/:sessionId/messages` | — | Message history |
| POST | `/session/:sessionId/end` | — | End session |
| GET | `/business/:businessId/sessions` | JWT + Ownership | All sessions |
| GET | `/business/:businessId/leads` | JWT + Ownership | Contact leads |
| GET | `/business/:businessId/session/:sessionId` | JWT + Ownership | Session detail |
| DELETE | `/business/:businessId/session/:sessionId` | JWT + Ownership | Delete session |
| GET | `/business/:businessId/dashboard-summary` | JWT + Ownership | Analytics summary |
| POST | `/internal/cleanup/messages` | Service Secret | Cron: purge old messages |
| POST | `/internal/cleanup/sessions` | Service Secret | Cron: mark abandoned |
| GET | `/health` | — | Health check |

---

### Email — `/api/v1/email`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | RabbitMQ + service health |
| GET | `/ready` | Readiness probe |
| GET | `/live` | Liveness probe |

The email module is primarily a **RabbitMQ consumer** — it has no public write endpoints. It listens for events published by the auth module and sends transactional emails via Resend.

| Event queue | Trigger | Email sent |
|-------------|---------|------------|
| `auth.user.created` | New registration | Welcome |
| `auth.otp.generated` | OTP created | OTP code |
| `auth.password.changed` | Password changed | Confirmation |
| `auth.user.deactivated` | Account deactivated | Deactivation notice |
| `auth.feedback.submitted` | Feedback submitted | Support forwarding |

---

## Environment Variables

See [`.env.example`](server/.env.example) for the full list with descriptions.

Required secrets to get started:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_URL` | Redis URL (`rediss://` for TLS e.g. Upstash) |
| `RABBITMQ_URL` | RabbitMQ URL (`amqps://` for TLS e.g. CloudAMQP) |
| `JWT_ACCESS_SECRET` | Min 32 characters |
| `JWT_REFRESH_SECRET` | Min 32 characters |
| `INTERNAL_SERVICE_SECRET` | Min 32 characters |
| `PINECONE_API_KEY` | Pinecone vector DB |
| `GROQ_API_KEY` | LLM inference |
| `RESEND_API_KEY` | Transactional email |
| `ADMIN_API_KEY` | Admin endpoint access |

---

## Status

| Module | Status |
|--------|--------|
| Auth | Production-ready |
| Business | Production-ready |
| Chat | Production-ready |
| Email | Production-ready |
| Payment | In progress |
| Platform Integration | Scaffolded |
