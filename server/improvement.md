# FormaChat — Improvement Tracker & Feature Backlog

**Last reviewed:** June 2026  
**How to use this file:** Work through sections top-to-bottom. Completed items are marked. Pending items are ready to build. Items with no checkbox are background context.

---

## Progress Snapshot (vs plan.md)

### What is shipped and working right now
- Modular monolith architecture (4 domains: auth, business, chat, email) — running in production on Render
- JWT auth with access + refresh tokens, OTP email verification, session management
- Business profile CRUD with 4-step wizard
- RAG pipeline: Pinecone vector search + Groq LLM (llama-3.3-70b-versatile)
- Embeddable chat widget (iframe + script embed)
- QR code generation and share links
- Lead capture with contact extraction
- Session / message / lead storage in MongoDB
- Analytics dashboard (sessions, leads, KPIs, CSV export)
- Transactional email via Resend (5 templates, all redesigned)
- RabbitMQ event system (auth → email pipeline)
- Redis rate limiting, session limits, daily counters
- Cron jobs: session cleanup, permanent deletion, weekly digest

### Recently built (this sprint)
- [x] Lead notification email (end-to-end: RabbitMQ → email → template)
- [x] Email template redesigns — welcome, OTP, password-changed, account-deactivated
- [x] lead-captured.hbs template
- [x] weekly-summary.hbs template + Monday 8am cron
- [x] LLM-based contact extraction (replaces fragile regex)
- [x] Confidence scoring (low-relevance Pinecone results → honest LLM response)
- [x] Rolling conversation summary (prevents context loss after 10 messages)
- [x] Custom instructions field (chatbotCustomInstructions on business model)
- [x] Webhook URL field on business model + fires on lead capture
- [x] Analytics events published to analytics.exchange (session.started, session.ended, message.sent)
- [x] Business health score endpoint (GET /businesses/:id/health-score)
- [x] System prompt cleanup (removed emoji clutter, cleaner boundary enforcement)

### Not started yet (from plan.md)
- [ ] Monolith refactor (plan describes it, but current microservice-style monolith works — do this when friction is felt)
- [ ] Payment & billing (Stripe, tier enforcement, usage metering)
- [ ] SDK (@formachat/sdk npm package + API key management)
- [ ] Multimodal product images (vision model + Cloudinary + Pinecone)
- [ ] Human handoff flow (agentHandoff field exists in model, nothing wired)
- [ ] WhatsApp / Telegram integrations
- [ ] Widget customization API (colors, position, avatar, theme)
- [ ] CDN-hosted standalone widget JS

---

## Backend — Auth (Deferred, build last)

These are deferred intentionally. Core product first.

- [ ] **Password reset** — endpoint is stubbed, OTP + Redis flow ready, just needs wiring. Users who forget their password are stuck.
- [ ] **2FA** — OTP type '2fa' is defined everywhere but never triggered. Add user preference flag.
- [ ] **Social sign-in** (Google, GitHub) — removes #1 registration friction. OAuth flow, skip password/OTP on social login.
- [ ] **Magic link login** — "email me a login link" option. Resend already configured, short-lived JWT token.
- [ ] **Breach detection** — HIBP k-anonymity API, one call at register/password change. TODO comment already in auth service.

---

## Backend — Chat & RAG

### Still to build
- [ ] **LLM fallback provider** — Groq is the only live provider. Claude/Gemini/OpenAI stubs exist but are empty. If Groq goes down the platform goes down. Implement Claude Haiku as a fallback. Auto-failover when Groq returns 503/429.
- [ ] **Streaming endpoint** — `/message/stream` route exists and the `sendMessageStream` AsyncGenerator is implemented in chat.service.ts. Needs the controller verified and the frontend chat widget updated to use SSE.
- [ ] **Intent classification** (from plan.md) — Move beyond keyword matching to LLM-classified intents: `product_inquiry`, `price_check`, `booking_request`, `complaint`, `human_request`, `out_of_scope`. Route differently per intent.
- [ ] **Human handoff** — `agentHandoff` field exists in ChatSession model. Wire it: AI or user triggers handoff → session flagged → business owner notified via email + webhook → owner joins conversation in dashboard.
- [ ] **Multi-language** — System prompt change only: "Detect the user's language and respond in that same language." Zero infrastructure cost, high global value.
- [ ] **Conversation summary cached in Redis** — Current rolling summary is re-computed per request. Cache the summary in Redis against sessionId, invalidate after new messages.
- [ ] **Business-to-business isolation audit** — Confirm a business can't query another business's Pinecone namespace by guessing the `business_{id}` format. Verify namespace is enforced server-side.
- [ ] **Knowledge base versioning** — Store each vector sync event (timestamp, vectorCount, who triggered it). Allow rollback to a previous sync. Currently if a bad upload corrupts the bot, there's no undo.

---

## Backend — Business Profile

- [ ] **Multimodal product images** — Business uploads product image → vision model (GPT-4o) auto-generates rich description → embed description + Cloudinary URL into Pinecone. Chat returns `products[]` array with imageUrl. Differentiator for e-commerce customers. Needs Cloudinary integration.
- [ ] **File preview / knowledge base viewer** — Business owners upload documents but can never see what's in their knowledge base. Add endpoint to list vector chunks by namespace, show source document, allow deleting individual chunks.
- [ ] **Business health score on dashboard** — The `GET /businesses/:id/health-score` endpoint is built. Frontend needs to fetch it and render the completion meter (see Frontend section).

---

## Backend — New Infrastructure

### Webhooks (enhanced)
The basic webhookUrl field and lead.captured firing is built. Still needed:
- [ ] **Webhook model** — Store url, events[], HMAC secret, delivery log, retry history per business
- [ ] **HMAC-SHA256 signing** — Sign every outbound payload so receivers can verify it came from FormaChat
- [ ] **Retry with exponential backoff** — 3 attempts (immediate, 5min, 30min). Mark delivery as failed after all retries.
- [ ] **Webhook dashboard** — Register/edit/delete webhooks in the dashboard UI. View delivery history, re-trigger failed deliveries.
- [ ] **More webhook events**: `session.started`, `session.ended`, `handoff.requested`, `usage.limit.warning`

### SDK & API Keys (from plan.md Phase 2)
- [ ] **ApiKey model** — `fc_live_<32bytes>`, hashed in DB, shown once on creation. Permissions array, rate limit config, lastUsedAt.
- [ ] **API key CRUD routes** — Create, list, revoke. Dashboard UI for key management.
- [ ] **SDK middleware** — Verify API key (Redis cache → DB fallback), increment usage counter (Redis INCR, flush to MongoDB every 5 minutes).
- [ ] **UsageRecord model** — Per-business, per-period aggregation of messages, sessions, tokens, vector queries.
- [ ] **@formachat/sdk npm package** — TypeScript-first thin wrapper over REST API. `fc.chat.createSession()`, `fc.chat.sendMessage()`, `fc.chat.streamMessage()`, `fc.webhooks.register()`.

### Payment & Billing (from plan.md Phase 5)
- [ ] **Stripe integration** — Products, Prices, Subscriptions, Customer Portal.
- [ ] **Tier enforcement** — Check plan limits before chat session creation, embedding, etc.
- [ ] **Usage-based overage** — Calculate overage at end of billing period, charge $0.02/session, $0.001/message.
- [ ] **Stripe webhooks** — `invoice.paid`, `subscription.canceled`, `payment_failed` → auto-freeze/unfreeze business.
- [ ] **trial-expiring.hbs** — Email template for "your trial ends in 3 days" with upgrade CTA. Needs accompanying cron.

### Analytics Consumer
- [ ] **Analytics consumer service** — The `analytics.exchange` is declared and events are flowing into it. Build a consumer that writes to an `AnalyticsEvent` collection. Enables per-business dashboards, MRR tracking, and usage reports without hitting the operational tables.

---

## Frontend — Remove Beta Stage

The product is past beta. These need changing before any marketing push.

### High priority — change these first
- [ ] **home.ts line 270** — Remove "FREE for Beta Users - Limited Spots!" badge. Replace with the actual value prop: "Now in Early Access" or just remove the badge entirely and let the hero speak.
- [ ] **register.ts line 254** — Change button text from "Start Free Beta Access" to "Create Free Account".
- [ ] **index.html line 58** — Change "No credit card required for beta access" to "No credit card required".
- [ ] **dashboard/home.ts** — Completely overhaul the three feature cards:
  - Remove "Beta Perks" card — the 40% discount offer and priority beta perks messaging.
  - Update "What's Live Now" card — some items listed aren't actually live (e.g., "Seamless conversation handoff to a human agent" is not built yet).
  - Update "Coming Soon" card — lead alerts, WhatsApp, API keys are either built (lead alerts via email) or on the roadmap. Keep this card but make it accurate.
- [ ] **Page title** — index.html title is "Formachat - AI Customer Support". Consider "FormaChat — AI-Powered Customer Support for Your Business" (capitalisation + more descriptive).

---

## Frontend — New Features to Build

### High value, build soon
- [ ] **Business create/edit wizard — add new backend fields**
  - `chatbotCustomInstructions` field in Step 3 (Customer Support) — "Additional instructions for your AI (e.g., 'Always respond in Spanish', 'Never quote prices'). Max 1000 chars."
  - `webhookUrl` field in Step 4 (Contact & Escalation) — "Webhook URL — we'll POST to this URL when a new lead is captured."
  - These fields exist on the backend model but the frontend wizard doesn't send or display them.

- [ ] **Business health score widget** — Fetch `GET /businesses/:id/health-score` and render a completion meter on the business detail or channels page. Show which checks are passing/failing. Nudges owners to fill out their profile properly (better data = better AI).

- [ ] **Streaming chat widget** — The backend `sendMessageStream` AsyncGenerator is built. Update the chat widget to use SSE: display the response word-by-word as it arrives. This is the single biggest chat UX improvement available. Transforms "waiting for an answer" into a real conversation.

- [ ] **Password reset flow** — Currently no way to reset a forgotten password in the frontend. Needs: "Forgot password?" link on login page → email input → OTP verify → new password form. Backend endpoint is stubbed and ready.

- [ ] **Profile / account settings page** — No settings page exists. Minimum needed: update first/last name, change password, view active sessions, delete account. Route: `#/dashboard/settings`.

- [ ] **Toast / notification system** — Currently every action result is shown inline in the form. A global toast system (bottom-right, auto-dismiss after 4s) would improve UX across the board. Affects business create, edit, delete, logout, OTP resend, etc.

- [ ] **Analytics — charts and graphs** — The analytics detail page shows tables of sessions and leads, but no visual trend charts. Add:
  - Sessions per day (7-day line chart) — use a lightweight chart library or pure SVG
  - Lead capture rate over time
  - Message volume bar chart
  - Response time distribution

- [ ] **Human handoff UI** — When the handoff feature is built on the backend, the dashboard needs a "Live Sessions" view where the business owner can join an active conversation and reply directly.

### Medium value
- [ ] **Pricing page** — No pricing page exists in the frontend. Route: `#/pricing`. Show the 5 tiers from plan.md (Free, Starter, Pro, Business, Enterprise) with feature comparison table and upgrade CTA.

- [ ] **Channels page — live test panel** — The "Launch Simulator" currently opens a popup. Embed the chat widget directly in the channels detail page as an inline panel. Much better test experience.

- [ ] **Lead details improvement** — The lead modal shows name/email/phone/capturedAt. Add: total sessions, first contact date, last activity date, which channel they came through.

- [ ] **Session details improvement** — Show full conversation transcript in the session modal with proper message bubbles (not just a list). Show token usage and model used per message.

- [ ] **Empty state improvements** — Analytics detail page shows "No chat activity yet". Add a checklist of next steps: "Share your bot link → Embed on your website → Test in the simulator".

- [ ] **Mobile navigation** — Sidebar is a dropdown from hamburger. On mobile, the sidebar links are small tap targets. Consider a bottom navigation bar on mobile for: Home, Businesses, Channels, Analytics.

- [ ] **404 page** — Currently unknown routes redirect to `/`. Add a proper 404 with navigation back to dashboard.

- [ ] **Dark mode** — Not implemented. Could be a quick win with CSS variables. Most business tools offer this now.

### Lower priority / nice to have
- [ ] **Favicon + PWA manifest** — favicon.ico at root, `manifest.json`, `apple-touch-icon.png`. Makes the app installable and look professional when bookmarked.
- [ ] **Keyboard shortcuts** — Cmd/Ctrl+K to open a command palette, Escape to close modals.
- [ ] **Breadcrumb improvements** — Breadcrumbs exist but are plain text. Make them clickable links (some already are, some are not).
- [ ] **Business card — more info** — The business list cards show name, status, created date. Add: number of sessions, number of leads captured, chatbot tone, vector status badge.
- [ ] **Copy to clipboard with feedback** — Channels page has "Copied!" feedback. Other places (session IDs, lead emails) could use the same pattern.
- [ ] **Skeleton loading states** — Replace the spinner with skeleton screens (grey placeholder boxes) for business cards and analytics tables. Much better perceived performance.
- [ ] **Pagination on tables** — Sessions and leads tables show up to 100 records via modal. The dashboard tables show "recent" records. Add visible pagination controls.

---

## Frontend — Bugs & Code Quality

- [ ] **register.ts max-height issue** — Registration container has `max-height: 600px`. On smaller screens or when the OTP section shows, content may overflow. Remove the max-height constraint.
- [ ] **Hardcoded production URL** — `channels/detail.ts` uses `https://formachat.com` hardcoded for the chat simulator and share links. This is fine for production but breaks local testing. Read from an env variable or config file.
- [ ] **sessionStorage for verify-email** — The pending email is stored in sessionStorage, which doesn't persist across browser tabs. A user who opens the verification link in a new tab will see the error state. Switch to localStorage with an expiry.
- [ ] **Analytics columns mismatch** — Sessions modal shows checkboxes (4 columns: checkbox, session ID, status, contact) but dashboard table shows 3 columns. Align these.
- [ ] **Placeholder images** — `home.ts` references `/assets/shot1.png`, `/assets/shot2.png`, etc. Verify these exist in production. If not, replace with actual screenshots or CSS-rendered mockups.
- [ ] **TypeScript errors** — The frontend is vanilla TypeScript without strict mode. Consider enabling `"strict": true` in tsconfig and fixing the resulting errors before the codebase grows further.
- [ ] **Error messages are too generic** — "Failed to load businesses." doesn't tell the user if it's a network error, auth error, or server error. Inspect the error code and show a specific message.

---

## Platform Integrations (Roadmap, not current sprint)

- [ ] WhatsApp Business API — biggest market in Africa, Latin America, Europe
- [ ] Telegram bot integration
- [ ] Instagram DMs (Meta Graph API)
- [ ] Email (inbound) — forward support@ to FormaChat, AI replies
- [ ] Slack — B2B internal support use case
- [ ] Voice (Twilio + Whisper)

---

## Key Metrics to Start Tracking

These aren't features but decisions — set up tracking before users arrive.

- Messages per session (AI quality proxy)
- Lead capture rate (sessions that captured at least one contact)
- Session-to-lead conversion rate (the number business owners care about most)
- Time to first response (LLM latency)
- Handoff rate (how often AI can't handle it)
- Token cost per session (unit economics)
- Weekly active businesses (product engagement)
- Webhook delivery success rate (once webhooks are fully built)
