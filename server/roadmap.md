# FormaChat — Roadmap (What's Left)

**Last pruned:** 2026-07-12 — all completed work removed; this file now tracks only what's still open. Per-feature build logs (`feature1.md`, `feature4.md`, `feature6-10-11.md`, `feature9-12-13-reorg.md`, `questionnaire-modernization.md`, `settings-and-sessions.md`) have been deleted now that their content is either shipped or (for anything still open) folded into this file.

**How to use:** everything below is `[ ]` — not built, or explicitly deferred/partial. Grouped by feature area, Backend/Frontend split where that distinction matters.

---

## Vision (unchanged, for context)

FormaChat is an AI customer support SaaS with three layers: (1) a dashboard for business owners, (2) an embeddable chat widget, (3) a future Developer SDK + REST API for usage-based B2B billing (Twilio/Stripe-style metering). See "Pricing Tiers" and "Tech Stack" at the bottom for reference material — none of the SDK/billing layer is built yet.

## Architecture status

Still organized as 4 domains (`auth`, `business`, `chat`, `email`) each with their own config/DB-connection pattern under `src/architectures/` — the originally-planned "modular monolith" folder restructure (single `shared/config`, no per-module RabbitMQ) has **not** happened. RabbitMQ is still in active use (auth→email pipeline, chat→analytics.exchange). Treat that refactor as not started; revisit only if this structure starts causing real friction.

---

## 1. Auth & Account

### Backend
- [ ] **Social sign-in (Google/GitHub)** — Paused, plan only, not started. Needs new `.env` values (`GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`, callback URLs registered in Google Cloud Console / GitHub OAuth Apps first) — check in before touching `.env`. Rough shape: OAuth authorization-code flow via direct HTTP calls to each provider's token endpoint (no `passport` needed); on callback, find-or-create user by email, set `source: 'google'|'github'`, issue normal session tokens (random unusable `passwordHash` for these users since the field is currently required). **When this ships, admin login (see §3) must stay on a fully separate credential system — never share the OAuth session with business-owner accounts.**

### Frontend
- [ ] **Social sign-in buttons** — "Continue with Google/GitHub" on login and register, redirecting to the backend's OAuth start route. Blocked on the backend work above.

### Settings — features under consideration (not started, flagged for discussion, not committed work)
- [ ] Email notification preferences (which emails you actually want — lead alerts, weekly digest, etc.)
- [ ] Login activity / audit log view (recent login attempts, not just the active-sessions list)
- [ ] API key management (once §6 SDK work exists)
- [ ] Data export (download your account + business data as JSON/CSV)
- [ ] Connected accounts (once social sign-in above exists)
- [ ] Timezone / language preference

---

## 2. Chat & AI Core

### Backend
- [ ] **LLM fallback provider** — Groq is the only live provider; `claude.provider.ts`/`gemini.provider.ts` are empty, `llm.factory.ts` throws for anything but Groq. No auto-failover on 503/429.
- [ ] **Intent classification (LLM-based)** — Only keyword matching via `detectHighIntent()` today. No structured categories (`product_inquiry`, `price_check`, etc.), no per-intent routing.
- [ ] **Human handoff** — `agentHandoff` field exists on the chat model but is never set or read anywhere. No notification path.
- [ ] **Multi-language support** — No language-detection instruction in the system prompt (`llm.prompts.ts`).
- [ ] **Conversation summary caching** — Partially built: rolling summary logic (`buildHistoryWithSummary`) exists but recomputes via an LLM call on every request past 10 messages. The Redis caching functions (`cacheSessionMessages`/`getCachedMessages`) already exist in `chat.redis.config.ts` but are never called — this is a wiring gap, not a design gap.
- [ ] **Knowledge base versioning** — Partially built: `vectorInfo` on the business model tracks `lastVectorUpdate`/`vectorCount`/`vectorStatus`, but there's no event-log collection and no rollback capability.

### Frontend
- [ ] **Streaming chat widget (SSE)** — Backend is fully ready (`sendMessageStreamController` + AsyncGenerator), but `chat-widget.ts`/`chat.service.ts` still do a plain async POST, no `EventSource`/stream reading. This is the one purely frontend-blocked item in this section.
- [ ] **Human handoff / Live Sessions UI** — Blocked on the backend handoff work above; nothing to build against yet.
- [ ] **Session details — token/model usage** — Full transcript with message bubbles is done; token usage and model-used per message are not shown.
- [ ] **Lead details — channel-of-origin** — Everything else on the lead detail view (sessions, messages, lead score, activity) is built; channel-of-origin is the one missing field.

---

## 3. Business Profile, Knowledge Base & Onboarding

### Backend
- [ ] **AI-generated product descriptions from photos** — `embedding.service.ts` only does Tesseract OCR text extraction, no vision model, no Cloudinary integration specific to auto-description. Deliberately deferred when Live Product Catalog shipped (owner-typed descriptions instead, to avoid adding a paid vision API dependency alongside Groq).

### Questionnaire / onboarding wizard — deferred enhancements (not started)
- [ ] Autosave drafts to `localStorage`
- [ ] Industry-aware defaults/placeholders per business type
- [ ] Live tone preview
- [ ] Turn AI-extracted "popular items" (when the LLM spots them in an uploaded document) into actual pre-created Product entries via the Products API — currently that signal is just discarded since the free-text "Popular Items" field was removed from the wizard in favor of the dedicated Products tab.

---

## 4. Admin Dashboard & Platform Administration

**Goal:** a separately-hosted admin client with its own JWT auth, full cross-tenant read/write access, and an emergency override path for editing any business's data directly — for support and incident response, not normal operation.

**Current state:** more scaffolding exists than expected, but it was built for service-to-service calls (an "admin microservice" that was never built), not a human admin login:
- `adminMiddleware` (`business/middleware/admin.middleware.ts`) already requires a JWT with `role: 'admin'` **plus** an `x-service-token` **plus** an `x-admin-api-key` header — a service-to-service auth pattern, not a login flow.
- `business/routes/admin.routes.ts` already exposes `GET /admin/businesses`, `GET /admin/businesses/:id`, `PATCH /admin/businesses/:id/status` (freeze/unfreeze), `GET /admin/analytics`, `GET /admin/frozen-businesses` — all gated by the above middleware.
- `auth/controllers/auth.admin.controller.ts` has stub endpoints intended for an admin service: `getUsersInternal` (unimplemented), `getAuditLogsInternal` (implemented), `lockUserInternal` (implemented — deactivates user + revokes tokens), `getUserDetailsInternal` (implemented), `getSystemStatsInternal` (partial).
- **The gap:** no `role` field exists on the user model at all, so nothing can ever satisfy `role === 'admin'` today — this whole path is currently unreachable dead code, not a working feature.

### Backend
- [ ] **Admin identity** — either a `role: 'admin'` field on the existing user model or (recommended) a fully separate `AdminUser` collection, so admin accounts are never mixed with business-owner accounts and can't be created via the public register endpoint.
- [ ] **Admin login endpoint** — dedicated login issuing admin-scoped JWTs signed with a **separate secret** and shorter expiry than business-owner tokens, so a leaked business-owner token can never pass `adminMiddleware`.
- [ ] **Real admin auth flow to replace the service-token pattern** — either retire the `x-service-token`/`x-admin-api-key` requirement in favor of the admin JWT alone, or keep it as defense-in-depth but issue those secrets to the admin client itself (not hand-typed by a human).
- [ ] **Emergency write access** — admin can directly edit any business's profile/products/settings data, not just freeze/unfreeze status (the only write path today).
- [ ] **Admin action audit log** — every admin write (edit, freeze, impersonate, delete) logged with adminId + timestamp + before/after diff. Non-negotiable given this role bypasses normal per-business ownership checks.
- [ ] **Keep admin auth isolated from social sign-in** — once Google/GitHub OAuth ships for business owners (§1), the admin login must not reuse that OAuth client/session.

### Frontend
- [ ] **Admin frontend client** — new, separate repo/deployment from `FormaChat-app-frontend`, pointing at the same backend. Admin login must only ever ship inside this client, never bundled into the public business-owner dashboard.
- [ ] **Cross-tenant read access UI** — list/search all businesses, users, sessions/leads/analytics across tenants, built on the (currently unreachable) `/admin/businesses` and internal auth endpoints once the backend auth gap above is closed.
- [ ] **Emergency edit UI** — forms to directly edit any business's data, paired with the backend write access above.
- [ ] **User account moderation UI** — surface the already-built `lockUserInternal`/`getUserDetailsInternal`/`getAuditLogsInternal` endpoints (lock/unlock users, view audit trail, view active sessions).

---

## 5. Webhooks

- [ ] **Additional webhook events** (`handoff.requested`, `usage.limit.warning`) — blocked on Human Handoff (§2) and Payment & Billing (§7) being built first; everything else (signing, retries, delivery dashboard, `session.started`/`session.ended`/`lead.captured`) is already live.

---

## 6. SDK & API Keys (B2B Developer Layer)

### Backend
- [ ] **`ApiKey` model, CRUD routes, SDK middleware, `UsageRecord` model** — None of this exists. No `sdk/` module directory at all. The only key-based auth in the codebase is an unrelated internal admin API key.
- [ ] **`@formachat/sdk` npm package** — Not started.

### Frontend
- [ ] **API key management dashboard** — create/list/revoke keys, view usage. Nothing to build against until the backend model exists.

---

## 7. Payment & Billing

### Backend
- [ ] **Stripe integration** (Products, Prices, Subscriptions, Customer Portal) — No Stripe code anywhere in the repo.
- [ ] **Tier enforcement middleware** — `business/types/tier.types.ts` is a one-line stub comment.
- [ ] **Usage-based overage calculation, Stripe webhooks** — Not built.

### Frontend
- [ ] **Pricing page** — No `#/pricing` route exists.
- [ ] **Billing / upgrade UI in dashboard** — Blocked on backend Stripe integration above.

---

## 8. Analytics & Reporting

- [ ] **Response time distribution chart** — Not built (lower priority, would need its own scoping pass). Everything else (event publishing, chart-data endpoint, sessions/messages/leads-per-day charts, CSV export) is already live.

---

## 9. Widget, Channels & Embed UX

- [x] **Widget redesign (2026-07-12, refined after live testing on an embedded site the same day)** — `public/widget.js` (launcher) and `chat-widget.ts` (in-iframe chat UI) both substantially reworked: mobile viewports now get a full-screen takeover instead of a cramped floating box (the external launcher button stays visible on top as the single close affordance at every screen size - an in-widget close button was tried and removed as redundant), a proactive greeting bubble appears after a delay (dismissible, session-scoped, position-aware), an unread badge shows on the launcher when a bot reply arrives while closed, bot messages render safe markdown-lite (bold/italic/links/bullet lists — HTML-escaped before any tags are added, so LLM output can never inject live markup), messages now show timestamps, and a "Powered by FormaChat" footer was added. A `postMessage` bridge between the iframe and the launcher (needed because CORS only allows FormaChat's own origins to call the API directly, not arbitrary embedding sites) syncs the owner's configured `primaryColor` and `position` from the dashboard to the launcher button in real time — **`widgetConfig.position` actually works now**, it was previously saved but silently ignored by the launcher script. Also fixed two real bugs caught via live testing, not just review: `--text-muted` was referenced in several CSS rules but never defined in `:root`, and `getIframeStyles()` hardcoded `right: 0` regardless of configured position - with `position: 'bottom-left'`, the popup expanded leftward from a ~60px-wide left-anchored container straight off the edge of the screen. Now anchors to whichever side the container itself is on.
- [ ] **CDN packaging (versioning, dedicated hosting) — still not done.** `widget.js` is served today straight from the main Vercel deployment's `public/` folder, which works but has no version pinning (`widget.js` always serves whatever's currently deployed — a breaking change to the script ships instantly to every embedded site with no rollback path) and no dedicated CDN. Worth revisiting once there are enough live embeds that a bad deploy would actually hurt: a separate build target, a versioned filename or path (`widget.v2.js`), and a CDN hosting decision (Cloudflare/jsDelivr/self-hosted) are the pieces, matching the `<script src="https://cdn.formachat.com/widget.js">` model from the original plan. Needs your input on the hosting decision before it's buildable — not urgent yet.

---

## 10. Frontend — UX Infrastructure & Polish

- [ ] **Dark mode** — Deliberately deferred; a full theme-variable pass across every page deserves its own session.
- [ ] **Keyboard shortcuts** — Deliberately deferred — lowest value relative to effort of everything else in this list.
- [ ] **Skeleton loading states** — Deliberately deferred — cosmetic upgrade over the existing spinner, lower priority than functional items.

---

## Platform Integrations (roadmap, not current sprint)

Backend-and-frontend-both-needed, not scoped yet beyond the channel itself:

- [ ] WhatsApp Business API — pairs with §3 Live Product Catalog; product images should ride on this once both are built
- [ ] Telegram bot integration
- [ ] Instagram DMs (Meta Graph API)
- [ ] Email (inbound)
- [ ] Slack
- [ ] Voice (Twilio + Whisper)

---

## Pricing Tiers (reference — not implemented, no billing exists yet)

| Tier | Price | Sessions/mo | Messages/mo | Features |
|------|-------|-------------|-------------|----------|
| Free | $0 | 50 | 500 | 1 business, widget embed, 7-day message history |
| Starter | $29/mo | 500 | 5,000 | 3 businesses, leads CRM, email notifications |
| Pro | $99/mo | 2,000 | 20,000 | 10 businesses, file uploads, product images, webhooks, WhatsApp |
| Business | $299/mo | 10,000 | 100,000 | Unlimited businesses, SDK access, custom domain, priority support |
| Enterprise | Custom | Unlimited | Unlimited | SLA, SSO, dedicated support, on-prem option |

**Overage:** $0.02/session, $0.001/message above plan limits.

## Tech Stack (reference)

| Layer | Choice |
|-------|--------|
| Runtime | Node.js + TypeScript |
| Framework | Express |
| Database | MongoDB (Mongoose) |
| Cache | Redis (ioredis) |
| Vector DB | Pinecone |
| LLM (Chat) | Groq (Llama 3.3 70B) — only live provider |
| Embeddings | Pinecone's hosted embedding model (via `createEmbeddings` in `pinecone.ts`) — not OpenAI, no OpenAI key exists anywhere in this project |
| Email | Resend |
| Queue | RabbitMQ (auth→email, chat→analytics.exchange) |

---

## Key Metrics to Start Tracking (not features — decisions)

- Messages per session · Lead capture rate · Session-to-lead conversion · Time to first response · Handoff rate · Token cost per session · Weekly active businesses · Webhook delivery success rate
