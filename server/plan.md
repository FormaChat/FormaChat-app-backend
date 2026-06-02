# FormaChat — Product Plan & Engineering Roadmap

**Last updated:** May 2026  
**Status:** Architecture pivot + product expansion

---

## Vision

FormaChat is a fully-featured **AI customer support SaaS**. The end product has three layers:

1. **Dashboard (Frontend)** — non-technical business owners log in, upload their product data, configure their chatbot, see leads and analytics. Zero code required.
2. **Embeddable Widget** — a `<script>` tag they paste into their website. Done.
3. **Developer SDK + REST API** — `npm install @formachat/sdk`. Developers at companies can integrate FormaChat directly into their own applications, control sessions programmatically, receive webhooks, and pay for usage. This is the B2B SaaS layer.

FormaChat earns money through usage-based pricing tied to API keys, not just subscriptions. Every message sent through the platform is metered. This is the same model Twilio, Resend, and Stripe use.

---

## Architecture Decision: Microservices → Modular Monolith

### Why we're doing this

The current 6-microservice setup made sense as an architectural experiment, but right now it's pure overhead:

- 6 deployments to manage
- 6 sets of environment variables
- RabbitMQ infrastructure for what amounts to a function call
- Network hops between services for every request
- Debugging across 6 separate log streams
- 6x infrastructure cost (CPU, memory, connection pools)

We are one developer. The product has not shipped. We are paying the microservices tax with zero of the benefit.

### Why a modular monolith (not a messy one)

The risk with going monolith is ending up with spaghetti code that's impossible to split later. We avoid this with one rule: **modules never import from each other directly.**

```
auth.service.ts can call email.service.ts (same process)
but chat.module never does: import { BusinessModel } from '../business/business.model'
```

Each module exposes a clean interface. If we ever extract a module into its own service, we change one line — the internal function call becomes an HTTP call. That's the strangler fig pattern. It works.

### RabbitMQ

Gone. In the same process, "send a welcome email on registration" is:

```ts
await userRepo.create(user);
await emailService.sendWelcomeEmail(user); // direct call
```

No queue. No consumer. No retry infrastructure to maintain. If we need async job processing at scale later, we add BullMQ on top of Redis — which we already have — and it's a one-day job.

---

## Folder Structure

```
src/
├── modules/
│   ├── auth/                    # User identity, JWT, sessions, OTP
│   │   ├── auth.routes.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── auth.model.ts
│   │
│   ├── business/                # Business profiles, vector embedding, admin
│   │   ├── business.routes.ts
│   │   ├── business.controller.ts
│   │   ├── business.service.ts
│   │   ├── business.model.ts
│   │   ├── embedding.service.ts # OpenAI text + vision embeddings
│   │   └── vector.service.ts    # Pinecone upsert / query
│   │
│   ├── chat/                    # Chat sessions, messages, leads, streaming
│   │   ├── chat.routes.ts
│   │   ├── chat.controller.ts
│   │   ├── chat.service.ts
│   │   ├── chat.model.ts
│   │   └── chat.cron.ts         # Cleanup jobs
│   │
│   ├── email/                   # Transactional email (direct calls, no queue)
│   │   ├── email.service.ts
│   │   └── templates/
│   │
│   ├── payment/                 # Subscriptions, billing, Stripe webhooks
│   │   ├── payment.routes.ts
│   │   ├── payment.controller.ts
│   │   ├── payment.service.ts
│   │   └── payment.model.ts
│   │
│   ├── sdk/                     # API key management, usage tracking ← NEW
│   │   ├── sdk.routes.ts        # CRUD for API keys
│   │   ├── sdk.controller.ts
│   │   ├── sdk.service.ts
│   │   ├── sdk.model.ts         # ApiKey, UsageRecord models
│   │   └── sdk.middleware.ts    # API key auth + usage metering
│   │
│   ├── webhook/                 # Outbound webhooks to customer systems ← NEW
│   │   ├── webhook.routes.ts
│   │   ├── webhook.service.ts
│   │   └── webhook.model.ts
│   │
│   ├── analytics/               # Usage dashboards, chat analytics ← NEW
│   │   ├── analytics.routes.ts
│   │   ├── analytics.controller.ts
│   │   └── analytics.service.ts
│   │
│   └── platform/                # Channel integrations
│       ├── widget/              # Embeddable JS widget
│       ├── whatsapp/
│       ├── telegram/
│       └── web/
│
├── shared/
│   ├── middleware/
│   │   ├── jwt.middleware.ts
│   │   ├── apiKey.middleware.ts  # For SDK routes
│   │   ├── rateLimit.middleware.ts
│   │   └── error.middleware.ts
│   ├── config/
│   │   ├── db.ts                # Single MongoDB connection
│   │   ├── redis.ts             # Single Redis connection
│   │   └── pinecone.ts          # Single Pinecone client
│   └── utils/
│       ├── logger.ts
│       └── helpers.ts
│
├── app.ts                       # Express app, all routes mounted here
└── server.ts                    # HTTP server, startup
```

---

## The SDK Product

### What it is

An npm package (`@formachat/sdk`) that developers install in their own backend or frontend to interact with FormaChat's API. Similar to how developers use Stripe's SDK to process payments — they never touch Stripe's internals, they just call `stripe.checkout.create(...)`.

### What the SDK does

```ts
import { FormaChat } from '@formachat/sdk';

const fc = new FormaChat({ apiKey: 'fc_live_abc123' });

// Create a session for a user
const session = await fc.chat.createSession({ businessId: 'biz_xyz' });

// Send a message
const response = await fc.chat.sendMessage({
  sessionId: session.id,
  message: 'Do you have red sneakers in size 10?',
});

console.log(response.text);       // AI reply
console.log(response.products);   // [{ name, price, imageUrl }] if products matched

// Stream a response
const stream = await fc.chat.streamMessage({ sessionId, message });
for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}

// Register webhooks
await fc.webhooks.register({
  url: 'https://yourapp.com/webhooks/formachat',
  events: ['lead.captured', 'session.ended', 'handoff.requested'],
});
```

### API Key Model

```ts
// ApiKey model
{
  key: 'fc_live_abc123',          // hashed in DB, shown once on creation
  keyPrefix: 'fc_live_abc',       // for identification without exposing key
  businessId: ObjectId,
  environment: 'live' | 'test',
  name: 'Production Key',
  permissions: ['chat:write', 'leads:read', 'analytics:read'],
  rateLimit: { requestsPerMinute: 60 },
  lastUsedAt: Date,
  createdAt: Date,
  revokedAt?: Date,
}
```

### Usage Tracking Model

```ts
// UsageRecord — written per-request, aggregated for billing
{
  businessId: ObjectId,
  apiKeyId: ObjectId,
  period: '2026-05',              // YYYY-MM for monthly rollup
  messages: number,               // total messages sent
  sessions: number,               // total sessions created
  tokensInput: number,            // LLM tokens in
  tokensOutput: number,           // LLM tokens out
  vectorQueries: number,          // Pinecone queries
  emailsSent: number,
}
```

Usage is incremented in Redis (fast, atomic) and flushed to MongoDB on a schedule. This is the same pattern Stripe uses for metered billing.

---

## Pricing Tiers

| Tier | Price | Sessions/mo | Messages/mo | Features |
|------|-------|-------------|-------------|----------|
| **Free** | $0 | 50 | 500 | 1 business, widget embed, 7-day message history |
| **Starter** | $29/mo | 500 | 5,000 | 3 businesses, leads CRM, email notifications |
| **Pro** | $99/mo | 2,000 | 20,000 | 10 businesses, file uploads, product images, webhooks, WhatsApp |
| **Business** | $299/mo | 10,000 | 100,000 | Unlimited businesses, SDK access, custom domain, priority support |
| **Enterprise** | Custom | Unlimited | Unlimited | SLA, SSO, dedicated support, on-prem option |

**Overage:** $0.02 per session, $0.001 per message above plan limits.

The payment service enforces tier limits. When a business exceeds their limit, the chat service returns a graceful error and the business gets an email prompt to upgrade.

---

## AI & Product Improvements

### 1. Multimodal Product Images (HIGH PRIORITY)

This is a genuine differentiator, especially for e-commerce customers.

**How it works:**

Business owner uploads a product image → Cloudinary stores it → Vision model (GPT-4o Vision or Claude) auto-generates a rich text description → Description + metadata is embedded into Pinecone alongside the Cloudinary URL.

```ts
// In embedding.service.ts
async embedProductImage(image: {
  cloudinaryUrl: string,
  productName: string,
  price: number,
  category: string,
}) {
  // 1. Call vision model to describe the image
  const description = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image.cloudinaryUrl } },
        { type: 'text', text: 'Describe this product in detail for a customer support chatbot. Include color, style, material, use case.' }
      ]
    }]
  });

  // 2. Embed the description text
  const vector = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: `${image.productName}. ${description}. Price: $${image.price}`
  });

  // 3. Upsert to Pinecone WITH imageUrl in metadata
  await pinecone.upsert([{
    id: `product_${uuid()}`,
    values: vector.data[0].embedding,
    metadata: {
      type: 'product',
      businessId,
      productName: image.productName,
      price: image.price,
      imageUrl: image.cloudinaryUrl,  // ← This is what the chat returns
      category: image.category,
    }
  }]);
}
```

**Chat response includes product cards:**

```ts
// Chat service returns structured data
{
  text: "Yes! We have the Air Force 1 Low in size 10. It's a white leather sneaker with a red swoosh, priced at $120.",
  products: [
    {
      name: "Air Force 1 Low",
      price: 120,
      imageUrl: "https://res.cloudinary.com/formachat/...",
      description: "White leather with red swoosh"
    }
  ]
}
```

Frontend renders image cards inline in the chat. This is table stakes for any e-commerce customer.

### 2. Conversation Memory & Context Management

Right now, rebuilding context from scratch on every message is both expensive and dumb. The right approach:

- Keep the last **10 messages** in the context window (short-term memory)
- After 20 messages, summarize the conversation so far into 2-3 sentences and use that as context going forward (prevents token bloat)
- Store the summary in Redis against the sessionId

```ts
async buildContext(sessionId: string, newMessage: string) {
  const recentMessages = await getLastNMessages(sessionId, 10);
  const summary = await getSessionSummary(sessionId); // from Redis

  return [
    { role: 'system', content: systemPrompt },
    summary ? { role: 'system', content: `Conversation so far: ${summary}` } : null,
    ...recentMessages,
    { role: 'user', content: newMessage },
  ].filter(Boolean);
}
```

### 3. Human Handoff

The `agentHandoff` field already exists in the chat model. Wire it up:

- AI detects it can't help, or user explicitly asks for a human
- Session is flagged as `handoffRequested`
- Business owner gets notified via email + webhook
- Owner can join the conversation in their dashboard
- Outbound webhook fires: `{ event: 'handoff.requested', sessionId, businessId, lastMessage }`

This is the number one feature B2B customers ask for. Without it, they won't trust the bot.

### 4. Intent Detection (Structured)

Instead of guessing what the user wants, classify it explicitly and use it to shape the response:

```ts
type Intent = 
  | 'product_inquiry'     // "do you have X?"
  | 'price_check'         // "how much is X?"
  | 'booking_request'     // "I want to book..."
  | 'complaint'           // "this is broken / I'm unhappy"
  | 'order_status'        // "where is my order?"
  | 'human_request'       // "let me speak to someone"
  | 'out_of_scope'        // "what's the weather?" → politely decline
```

When intent is `human_request` or `complaint`, escalate immediately. When it's `product_inquiry`, trigger the product image search. When it's `out_of_scope`, the AI politely redirects: "I'm only able to help with questions about [BusinessName]. Is there something specific I can help you with?"

### 5. Multi-language Support

Groq and OpenAI handle this natively. The only change needed is in the system prompt:

```ts
const systemPrompt = `
  You are a customer support assistant for ${business.name}.
  Detect the language the user is writing in and respond in that same language.
  Do not switch languages mid-conversation.
  ...
`;
```

Zero additional infrastructure. High value for global businesses.

### 6. Lead Capture Intelligence

The current model captures leads if the AI explicitly asks for them. Make it smarter:

- If a user asks about pricing or booking → AI naturally asks for name + email ("I can have someone follow up with a quote — what's the best email to reach you?")
- If a user seems to be leaving → "Before you go, can I grab your contact details so we can follow up?"
- Extracted contact info triggers a webhook: `lead.captured`
- Lead is upserted into the ContactLead collection (deduplicated by email or phone)

### 7. Webhooks (Outbound)

Businesses register a URL. When events happen, we POST to their URL:

```ts
// Events
type WebhookEvent =
  | 'session.started'
  | 'session.ended'
  | 'lead.captured'         // contact info extracted
  | 'handoff.requested'     // user wants a human
  | 'message.received'      // new user message (for live monitoring)
  | 'usage.limit.warning'   // approaching plan limit
```

Webhook delivery includes: signature verification (HMAC-SHA256 with their webhook secret), automatic retry with exponential backoff (3 attempts), and a delivery log in the dashboard.

This is what lets FormaChat plug into any CRM (HubSpot, Salesforce) or workflow tool (Zapier, Make) without us building the integrations ourselves.

### 8. Widget Customization

The embeddable widget should be fully customizable via the dashboard:

```js
// What we give the customer to paste on their site
<script>
  window.FormaChatConfig = {
    businessId: 'biz_xyz',
    apiKey: 'fc_pub_abc',  // public key, read-only
    theme: {
      primaryColor: '#6B48FF',
      position: 'bottom-right',
      avatarUrl: 'https://...',
      greeting: 'Hi! How can we help?',
    }
  };
</script>
<script src="https://cdn.formachat.com/widget.js"></script>
```

No code changes on their site. The widget is a React component compiled to a standalone JS file and served from a CDN.

---

## Platform Integrations (Roadmap)

| Channel | Priority | Notes |
|---------|----------|-------|
| Web widget | **P0** | Core product. Must ship first. |
| REST API / SDK | **P0** | Required for developer tier. |
| WhatsApp Business | **P1** | Biggest market in Africa, Latin America, Europe. Requires Meta Business verification. |
| Telegram | **P2** | Strong developer audience, easy to implement. |
| Instagram DMs | **P2** | High demand for e-commerce. Meta API. |
| Email (inbound) | **P3** | Forward support@ to FormaChat, AI replies. |
| Slack | **P3** | B2B internal support use case. |
| Voice (phone) | **Future** | Twilio + Whisper for speech-to-text. |

---

## Data Architecture (Key Decisions)

### Multi-tenancy

Everything is scoped by `businessId`. Every query includes `businessId` as a filter. This is enforced at the service layer, not just the route layer.

### Vector Namespace Strategy

Pinecone namespace per business: `business_<businessId>`. This means:
- Complete isolation between businesses (no cross-contamination of context)
- Easy deletion: when a business deletes their data, we delete the namespace
- Clear pricing: we can charge per namespace or per vector count

### API Key Security

- Keys are generated as `fc_live_<32 random bytes as hex>`
- Only the prefix (`fc_live_abc`) is stored in plaintext for identification
- The full key is hashed (SHA-256) before storage — we can verify but not retrieve
- Shown to the user exactly once on creation
- Test keys (`fc_test_`) hit a sandboxed environment, don't count toward billing

### Usage Metering Architecture

```
Request hits API → sdk.middleware.ts
  → Verify API key (Redis cache, fallback to DB)
  → Check rate limit (Redis sliding window)
  → Increment usage counter (Redis INCR - atomic, fast)
  → Pass to controller

Every 5 minutes: cron job
  → Read all Redis usage counters
  → Flush to MongoDB UsageRecord (upsert with $inc)
  → Reset Redis counters
```

This is the same pattern Stripe uses. Redis is the fast write path, MongoDB is the source of truth for billing.

---

## Migration Roadmap

### Phase 0 — Scaffold the monolith (1–2 days)
- [ ] Create new repo / new folder structure
- [ ] Set up Express app with modular route mounting
- [ ] Single MongoDB, Redis, Pinecone config in `shared/config`
- [ ] Base middleware (error handler, logger, JWT, rate limit)
- [ ] Dockerfile + single `.env.example`

### Phase 1 — Port core services (1–2 weeks)
- [ ] Port Auth module (routes, controller, service, model) — remove RabbitMQ producers, replace with direct email calls
- [ ] Port Business Profile module — keep embedding and vector services
- [ ] Port Chat module — keep streaming, cron cleanup
- [ ] Port Email module — convert from consumer to direct service functions

### Phase 2 — SDK infrastructure (1 week)
- [ ] ApiKey model + CRUD routes (create, list, revoke)
- [ ] SDK middleware (key verification + usage increment)
- [ ] UsageRecord model + Redis flush cron
- [ ] API key dashboard UI (backend routes for frontend)
- [ ] Write `@formachat/sdk` npm package (TypeScript, thin wrapper over REST API)
- [ ] SDK docs

### Phase 3 — AI upgrades (1–2 weeks)
- [ ] Product image upload → vision model description → Pinecone upsert
- [ ] Structured chat response (`text` + `products[]` + `intent`)
- [ ] Conversation summarization (Redis-cached summary, rebuilt after N messages)
- [ ] Intent classification (built into system prompt or separate classifier call)
- [ ] Human handoff flow (flag session, notify business owner, webhook)
- [ ] Multi-language support (system prompt change only)
- [ ] Smarter lead capture prompts

### Phase 4 — Webhooks + Integrations (1 week)
- [ ] Webhook model (url, events[], secret, deliveryLog)
- [ ] Webhook delivery service (HMAC-SHA256 signing, retry logic)
- [ ] Outbound events: `lead.captured`, `session.ended`, `handoff.requested`
- [ ] Webhook dashboard (register, test, view delivery history)

### Phase 5 — Payment & Billing (1–2 weeks)
- [ ] Stripe integration (Products, Prices, Subscriptions, Customer Portal)
- [ ] Tier enforcement middleware (check plan limits before chat, embedding, etc.)
- [ ] Usage-based overage calculation (end of billing period)
- [ ] Stripe webhook handler (`invoice.paid`, `subscription.canceled`, `payment_failed`)
- [ ] Auto-freeze business on payment failure, auto-unfreeze on payment success

### Phase 6 — Platform Integrations (ongoing)
- [ ] Embeddable web widget (React → compiled standalone JS → CDN)
- [ ] Widget customization API (colors, position, greeting, avatar)
- [ ] WhatsApp Business API integration
- [ ] Telegram bot integration
- [ ] Instagram DMs (Meta Graph API)

### Phase 7 — Analytics & Dashboard (1 week)
- [ ] Analytics routes: sessions over time, top questions, lead conversion rate, response time
- [ ] Per-business usage dashboard (messages used, sessions, cost estimate)
- [ ] Admin analytics: MRR, active businesses, churn, top plans
- [ ] Exportable data (CSV for leads, sessions)

---

## Future: Back to Microservices (When It Makes Sense)

If FormaChat reaches a point where:
- The chat service alone is handling 100k+ sessions/day and needs independent scaling
- A separate team owns the payment service and needs independent deploys
- Regulatory requirements demand data isolation between tenants

...then we extract. The modular monolith structure makes this straightforward:

| Module | Extract When |
|--------|-------------|
| Chat | Traffic requires independent horizontal scaling |
| Payment | Financial compliance or separate team |
| Analytics | Heavy aggregation queries are impacting API latency |
| Platform (WhatsApp/Telegram) | Channel-specific scaling needs |

The extraction process per module:
1. Add `server.ts` to the module
2. Spin up its own DB connection
3. Replace direct service calls with HTTP calls (or gRPC)
4. Deploy independently

Because we enforced the "no cross-module imports" rule from day one, this is a scalpel operation, not surgery.

---

## Technology Stack (Final)

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js + TypeScript | Existing investment, strong ecosystem |
| Framework | Express 5 | Familiar, lightweight |
| Database | MongoDB (Mongoose) | Flexible schema for business profiles |
| Cache | Redis (ioredis) | Rate limiting, session cache, usage counters |
| Vector DB | Pinecone | Best-in-class managed vector DB |
| LLM (Chat) | Groq (Llama 3) | Fast inference, low cost |
| LLM (Vision) | GPT-4o | Best multimodal model for product image analysis |
| Embeddings | OpenAI text-embedding-3-small | Cost-effective, high quality |
| File Storage | Cloudinary | Image optimization, CDN, transformations |
| Email | Resend | Modern, reliable, good DX |
| Payments | Stripe | Industry standard, excellent SDK |
| Deployment | Single container (Docker) | Simple, cheap, one server to start |
| SDK Package | `@formachat/sdk` on npm | TypeScript-first, tree-shakeable |

---

## Key Metrics to Track from Day One

| Metric | Why It Matters |
|--------|---------------|
| Messages per session | AI quality indicator |
| Lead capture rate | Core product value |
| Session-to-lead conversion | Business owner ROI proof |
| Time to first response | AI performance |
| Handoff rate | How often AI can't handle it |
| Token cost per session | Unit economics |
| MRR, churn | Business health |
| API key active rate | SDK adoption |
| Webhook delivery success rate | Integration reliability |

---

## Notes

- The `formachat-platform-integration` and `formachat-payment-system` services are empty scaffolds — do not port them, build them fresh inside the monolith.
- Keep the existing microservice repo as a reference for porting logic, especially the Auth, Business, and Chat services which are well-implemented.
- The business model schema is solid — port it directly. The chat model (ChatSession, ChatMessage, ContactLead) is also well-designed and should be kept as-is.
- Do not start the widget or WhatsApp integration until the core API + SDK is shipping. Channel integrations are useless without a stable API underneath them.
