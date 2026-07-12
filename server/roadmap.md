# FormaChat — Roadmap & Progress Tracker

**Replaces:** `plan.md` + `improvement.md` (merged and reconciled against actual code, 2026-07-11)
**How to use:** `[x]` = verified built and wired end-to-end. `[ ]` = not built, or only partially built (see note). Grouped by **feature area**, and within each area split into **Backend** / **Frontend** so you can see at a glance what's done on each side of a given feature and what's blocking what (e.g. "backend ready, frontend not consuming it yet" vs "both sides untouched"). Sections without a meaningful split (pure UI polish, pure bugs) are left as a single list.

---

## Vision (unchanged, for context)

FormaChat is an AI customer support SaaS with three layers: (1) a dashboard for business owners, (2) an embeddable chat widget, (3) a future Developer SDK + REST API for usage-based B2B billing (Twilio/Stripe-style metering). See "Pricing Tiers" and "Tech Stack" at the bottom for reference material carried over from the old `plan.md` — none of the SDK/billing layer is built yet.

## Architecture status

Still organized as 4 domains (`auth`, `business`, `chat`, `email`) each with their own config/DB-connection pattern under `src/architectures/` — the originally-planned "modular monolith" folder restructure (single `shared/config`, no per-module RabbitMQ) has **not** happened. RabbitMQ is still in active use (auth→email pipeline, chat→analytics.exchange). Treat the Phase 0 monolith refactor as not started; revisit only if this structure starts causing real friction.

---

## 1. Auth & Account

**Full build log:** `feature1.md` (this section was built out in one pass — see that file for the detailed design decisions, e.g. why 2FA enable/disable is password-confirmed rather than OTP-confirmed, why magic-link tokens are 40 chars instead of 6 digits, and two live bugs found and fixed along the way that predate this work).

### Backend
- [x] **Password reset** — Full flow works: `POST /password/reset` → OTP generated (Mongo + Redis) → `POST /password/reset/confirm` verifies OTP and sets new password (`auth.password.controller.ts`, `auth.otp.service.ts`). Fixed during this pass: `resetPasswordSchema` was silently stripping `email`/`otp` from every request (Zod's default strip behavior), so this endpoint was actually broken at runtime despite reading correctly in a static review — now fixed.
- [x] **2FA** — Built. `twoFactorEnabled` field on the user model; password-confirmed `POST /auth/2fa/enable` / `/disable`; login checks the flag and, if set, issues a `2fa` OTP (reusing the pre-existing email pipeline) instead of a session; new `POST /auth/login/2fa/verify` completes login.
- [ ] **Social sign-in (Google/GitHub)** — Still not built, still paused. Needs `.env` additions (OAuth client IDs/secrets) — not started per instruction to check in before touching `.env`. Plan is documented in `feature1.md` §5. **When this ships, admin login (see §5 of this file) must stay on a fully separate credential system — do not share the OAuth session with business-owner accounts.**
- [x] **Magic link login** — Built. New `OTPType.MAGIC_LINK`, 40-char token reusing the existing OTP storage/producer/consumer pipeline, new `magic-link.hbs` template, `POST /auth/magic-link/request` + `/verify`.
- [x] **Breach detection (HIBP)** — Built. Real k-anonymity check against the Have I Been Pwned API (no API key needed, fails open on error), wired into register, change-password, and reset-confirm.

### Frontend
- [x] **Password reset flow** — Fully built and paired with the backend above: `forgot-password.ts` has the complete email → OTP → new password flow, linked from the login page and registered in the router. Fixed during this pass: the confirm call wasn't sending `confirmPassword`, which the (now-fixed) backend schema requires — same root cause as the backend bug above.
- [x] **Profile / account settings page** — Now complete. `settings.ts` has Profile, Change Password, Two-Factor Authentication, Active Sessions (list + per-session "sign out"), and a password-confirmed Delete Account card.
- [x] **2FA toggle/UI** — Built. Settings card with status badge + password-confirmed enable/disable; login page swaps to an inline OTP step when the server responds with `requiresTwoFactor`.
- [ ] **Social sign-in buttons** — Still not built. Blocked on backend OAuth work above.
- [x] **Magic link "email me a link" UI** — Built. Login page has an "Email me a login link instead" toggle; new `#/magic-login` page consumes the emailed link and completes sign-in.

---

## 2. Chat & AI Core

### Backend
- [ ] **LLM fallback provider** — Not built. Groq is the only live provider; `claude.provider.ts` and `gemini.provider.ts` are empty files, and `llm.factory.ts` throws `"not yet implemented"` for anything but Groq. No auto-failover on 503/429.
- [x] **Streaming endpoint** — Fully wired: `chat.route.ts` → `sendMessageStreamController` (SSE) → `chatService.sendMessageStream` AsyncGenerator. Backend is ready and waiting on the frontend (see below).
- [ ] **Intent classification (LLM-based)** — Not built. Only keyword matching via `detectHighIntent()`. No structured categories (`product_inquiry`, `price_check`, etc.) and no per-intent routing.
- [ ] **Human handoff** — Not built. The `agentHandoff` field exists on the chat model but is never set or read anywhere in `chat.service.ts` or `chat.controller.ts`. No notification path.
- [ ] **Multi-language support** — Not built. No language-detection instruction in the system prompt (`llm.prompts.ts`).
- [ ] **Conversation summary cached in Redis** — Partially built. Rolling summary logic exists (`buildHistoryWithSummary`) but is recomputed via an LLM call on every request past 10 messages — the Redis caching functions (`cacheSessionMessages`/`getCachedMessages`) exist in `chat.redis.config.ts` but are never called.
- [x] **Business-to-business isolation audit** — Verified safe. Pinecone namespace is derived server-side from `business._id` (`business_${this._id}`), never from client input, and enforced consistently in `vector.service.ts` and the Pinecone search config.
- [ ] **Knowledge base versioning** — Partially built. `vectorInfo` on the business model tracks `lastVectorUpdate`, `vectorCount`, `vectorStatus`, but there's no event-log collection and no rollback capability.

### Frontend
- [ ] **Streaming chat widget (SSE)** — Not built. This is the one purely blocked-on-frontend item in this section: backend is fully ready, but `chat-widget.ts` / `chat.service.ts` still do a plain async POST, no `EventSource` or stream reading.
- [ ] **Human handoff / Live Sessions UI** — Not built. Blocked on backend — nothing to build against until handoff is actually wired server-side.
- [ ] **Session details improvement** — Partially built. Full transcript with proper message bubbles is done; token usage and model-used per message are not shown.
- [x] **Lead details improvement** — Mostly built: total sessions, total messages, lead score, first contact, last activity, and full session history are all shown. Channel-of-origin is still missing.
- *(Multi-language, intent classification, summary caching, KB versioning, and LLM fallback are backend-only — no distinct frontend surface is needed for any of them.)*

---

## 3. Business Profile & Knowledge Base

### Backend
- [x] **Business health score** — Built and mounted: `GET /businesses/:id/health-score` (`business.controllers.ts`).
- [ ] **File preview / knowledge base viewer** — Not built. `deleteVectors`/`deleteNamespace` exist as internal config functions but aren't exposed through any route or controller.
- [ ] **Multimodal product images (legacy plan item)** — Superseded by **§4 Live Product Catalog** below (same underlying need, now scoped per-product instead of per-document). Not built yet either way: `embedding.service.ts` only does Tesseract OCR text extraction, no GPT-4o vision, no Cloudinary integration.

### Frontend
- [x] **Business health score widget** — Fetched and rendered as a "Knowledge Base Health" meter, though it lives on the Channels detail page rather than the business detail page.
- [ ] **File preview / KB viewer UI** — Not built. Blocked on backend endpoints above.

---

## 4. Live Product Catalog

**Full build log:** `feature4.md`.

**Goal:** restructure the business profile into two distinct sections — a **Questionnaire** (the existing static business-info wizard) and a **Products** section where owners add per-product images and live stock counts. The chatbot reads current stock/price directly, not a stale snapshot from onboarding. This is the foundation for a future POS/e-commerce mode, and for sending product images through channel integrations like WhatsApp.

**Decision made before building:** product descriptions are owner-typed, not AI-generated from photos — this project has no OpenAI key and everything else runs on Groq, so rather than add a new paid dependency, the searchable text is just typed in like every other wizard field. No vision API involved anywhere.

### Backend
- [x] **Product model** (`business/models/product.model.ts`) — own collection: `businessId`, `name`, `description`, `price`, `stockQuantity`, `category`, `imageUrl`, `isActive`, `pineconeVectorId`.
- [x] **Image upload** — server-mediated (not direct-to-Cloudinary): new `POST /businesses/:id/products/upload-image` using `multer` (memory storage) + the `cloudinary` SDK, both newly installed. Cloudinary credentials already existed in `.env` but were unused/commented out in `business.env.ts` — now wired in.
- [x] **Text → Pinecone embedding** — reuses `embeddingService.embedTexts()` completely unchanged. Create/update builds `"{name}. {description} Category: {category}. Price: ${price}."` and upserts into the business's existing namespace with `type: 'product'` in metadata; only re-embeds when a searchable field actually changed.
- [x] **Live stock editing endpoint** — `PATCH /businesses/:id/products/:productId/stock`, single-field write, no re-embedding, no Pinecone call.
- [x] **Stock/price sync** — MongoDB is the source of truth, looked up live by `productId` after every Pinecone match; vector metadata is never trusted for numbers that change often.
- [x] **Chat response returns `products[]` with live data** — `chat.service.ts` filters vector matches for `metadata.type === 'product'`, looks up current data from MongoDB, returns it alongside `text`. `chat.pinecone.config.ts`'s `searchBusiness()` needed one additive change (now returns `metadata` per result, previously stripped to just `sourceType`).
- [x] **POS/e-commerce hook** — confirmed the model shape doesn't block a future `$inc` on `stockQuantity` from an order/POS integration.

### Frontend
- [x] **Products page** (`#/dashboard/businesses/:id/products`) — linked from a new card on the Channels detail page. Grid of product cards, "+ Add Product" modal (image upload with live preview, name, category, price, stock, description).
- [x] **Live stock editing UI** — inline number input + Save button on each product card.
- [x] **Chat widget product cards** — `chat-widget.ts` renders image/name/price/stock cards under the bot's response whenever `products[]` comes back non-empty.
- [ ] **WhatsApp image delivery (future, blocked on WhatsApp integration)** — no extra work needed when that ships; product images already ride on stored Cloudinary URLs.

---

## 5. Admin Dashboard & Platform Administration (NEW, proposed 2026-07-11)

**Goal:** a separately-hosted admin client with its own JWT auth, full cross-tenant read/write access, and an emergency override path for editing any business's data directly — for support and incident response, not for normal operation.

**Current state found in the repo:** more scaffolding exists than expected, but it was built for service-to-service calls (an "admin microservice" that was never built), not for a human admin logging in:
- `adminMiddleware` (`business/middleware/admin.middleware.ts`) already requires a JWT with `role: 'admin'` **plus** an `x-service-token` **plus** an `x-admin-api-key` header — a service-to-service auth pattern, not a login flow.
- `business/routes/admin.routes.ts` already exposes `GET /admin/businesses`, `GET /admin/businesses/:id`, `PATCH /admin/businesses/:id/status` (freeze/unfreeze), `GET /admin/analytics`, `GET /admin/frozen-businesses` — all gated by the above middleware.
- `auth/controllers/auth.admin.controller.ts` has stub endpoints intended for an admin service: `getUsersInternal` (unimplemented, returns empty array), `getAuditLogsInternal` (implemented), `lockUserInternal` (implemented — deactivates user + revokes tokens), `getUserDetailsInternal` (implemented), `getSystemStatsInternal` (partially implemented).
- **The gap:** no `role` field exists on the user model at all, so nothing can ever actually satisfy `role === 'admin'` today — this whole path is currently unreachable dead code, not a working feature.

### Backend
- [ ] **Admin identity** — either a `role: 'admin'` field on the existing user model or (recommended) a fully separate `AdminUser` collection, so admin accounts are never mixed with business-owner accounts and can't be created via the public register endpoint.
- [ ] **Admin login endpoint** — dedicated login issuing admin-scoped JWTs signed with a **separate secret** and shorter expiry than business-owner tokens, so a leaked business-owner token can never pass `adminMiddleware`.
- [ ] **Real admin auth flow to replace the service-token pattern** — either retire the `x-service-token`/`x-admin-api-key` requirement in favor of the admin JWT alone, or keep it as defense-in-depth but issue those secrets to the admin client itself (not hand-typed by a human).
- [ ] **Emergency write access** — admin can directly edit any business's profile/products/settings data, not just freeze/unfreeze status (the only write path that exists today).
- [ ] **Admin action audit log** — every admin write (edit, freeze, impersonate, delete) logged with adminId + timestamp + before/after diff. Non-negotiable given this role bypasses normal per-business ownership checks — without it, an emergency edit that goes wrong leaves no trail.
- [ ] **Future: keep admin auth isolated from social sign-in** — once Google/GitHub OAuth ships for business owners (see §1), the admin login must not reuse that OAuth client/session — two fully separate credential systems by design, not just by convention.

### Frontend
- [ ] **Admin frontend client** — new, separate repo/deployment from `FormaChat-app-frontend`, hosted independently, pointing at the same backend. Admin login form/JS must only ever ship inside this client, never bundled into the public business-owner dashboard.
- [ ] **Cross-tenant read access UI** — list/search all businesses, all users, all sessions/leads/analytics across tenants, built on top of the (currently unreachable) `/admin/businesses` and internal auth endpoints once the backend auth gap above is closed.
- [ ] **Emergency edit UI** — forms to directly edit any business's data, paired with the backend write access above.
- [ ] **User account moderation UI** — surface the already-built `lockUserInternal`/`getUserDetailsInternal`/`getAuditLogsInternal` endpoints (lock/unlock users, view their audit trail, view active sessions).

---

## 6. Webhooks

**Full build log:** `feature6-10-11.md`.

### Backend
- [x] **Basic webhook firing** — `webhookUrl` field exists on the business model and fires a best-effort, unsigned `axios.post` on lead capture. Kept as-is for backward compatibility — not removed.
- [x] **Dedicated Webhook model** — Built (`business/models/webhook.model.ts` + `webhookDelivery.model.ts`): url/events[]/secret/delivery log with status/attempt tracking.
- [x] **HMAC-SHA256 signing** — Built. Every delivery to a registered `Webhook` is signed (`X-FormaChat-Signature`) with a per-webhook secret shown once on creation.
- [x] **Retry with exponential backoff** — Built. 3 total attempts (immediate, +5min, +30min), driven by a 5-minute cron job in `chat.cron.ts`.
- [x] **More webhook events** — `session.started` and `session.ended` now fire alongside `lead.captured`. (`handoff.requested`/`usage.limit.warning` still deferred — depend on the unbuilt handoff/billing features.)

### Frontend
- [x] **webhookUrl field in business wizard** — Present in both `create.ts` and `edit.ts`, paired with the basic firing above.
- [x] **Webhook dashboard** — Built on the Channels detail page: list/add/delete webhooks, per-webhook delivery history modal with manual retry, one-time secret reveal on creation.

---

## 7. SDK & API Keys (B2B Developer Layer)

### Backend
- [ ] **ApiKey model, CRUD routes, SDK middleware, UsageRecord model** — None of this exists. No `sdk/` module directory at all. The only key-based auth in the codebase is an unrelated internal admin API key.
- [ ] **`@formachat/sdk` npm package** — Not started.

### Frontend
- [ ] **API key management dashboard** — create/list/revoke keys, view usage. Not built — nothing to build against until the backend model exists.

---

## 8. Payment & Billing

### Backend
- [ ] **Stripe integration** (Products, Prices, Subscriptions, Customer Portal) — Not built. No Stripe code anywhere in the repo.
- [ ] **Tier enforcement middleware** — Not built. `business/types/tier.types.ts` is a one-line stub comment.
- [ ] **Usage-based overage calculation, Stripe webhooks** — Not built.

### Frontend
- [ ] **Pricing page** — Not built. No `#/pricing` route exists.
- [ ] **Billing / upgrade UI in dashboard** — Not built. Blocked on backend Stripe integration above.

---

## 9. Analytics & Reporting

### Backend
- [x] **Analytics event publishing** — `chat.rabbitmq.ts` publishes `chat.session.started/ended` and `chat.message.sent` to `analytics.exchange`.
- [ ] **Analytics consumer + `AnalyticsEvent` collection** — Not built. Nothing consumes `analytics.exchange`; events are published into the void right now.

### Frontend
- [x] **Baseline analytics dashboard** — Sessions/leads tables and CSV export already exist and function (`analytics/detail.ts`, `analytics/index.ts`).
- [ ] **Charts and graphs** — Not built. Analytics pages are tables/numbers only, no chart library or SVG trend visualizations (sessions/day, lead capture rate, message volume, response time distribution).

---

## 10. Widget, Channels & Embed UX

**Full build log:** `feature6-10-11.md`.

- [x] **Channels page live test panel** — Built. "Launch Simulator" now toggles an inline, lazy-loaded `<iframe>` panel in the "Test Your Bot" card instead of opening a popup window.
- [x] **Widget customization** — Built, with a caveat: `widgetConfig` (`primaryColor`, `position`, `avatarUrl`) added to the business model and exposed on the public chat endpoint; new "Widget Appearance" card on the Channels detail page; `chat-widget.ts` applies `primaryColor` (with an auto-darkened hover shade) and renders `avatarUrl` in the chat header. `position` is saved but has **no visible effect yet** — the current embed is an edge-to-edge iframe with no floating launcher bubble to position; that only becomes meaningful once the CDN-hosted widget below exists.
- [ ] **CDN-hosted standalone widget JS** — Still not attempted. This is a packaging/deployment decision (separate build target, CDN hosting choice, versioning strategy), not a code gap — needs your input before it's buildable. See `feature6-10-11.md` §10 for the specifics needed.

---

## 11. Frontend — Copy & Beta Cleanup

No backend counterpart — pure content/copy changes. **Full build log:** `feature6-10-11.md`.

- [x] **register.ts button text** — Fixed. Was `"Start Free Beta Access"` in the post-error button-reset text (inconsistent with the initial `"Create Free Account"` text) — now consistent everywhere.
- [x] **home.ts beta badge** — Removed the dead `.beta-badge` CSS rule (confirmed it was never applied to any element).
- [x] **index.html "no credit card" text** — Already updated, no "beta access" wording.
- [x] **dashboard/home.ts cards** — "Beta Perks" card is gone; "What's Live Now" and "Coming Soon" cards are accurate to current build state.
- [x] **Page title** — Hidden `<h1>` updated to match the `<title>` tag copy.

---

## 12. Frontend — UX Infrastructure & Polish

No direct backend counterpart — pure frontend UX work.

- [x] **Toast / notification system** — Redesigned (light-olive card, colored bottom border — green success / red error / olive info) and rolled out to login, register, forgot-password, and verify-email, replacing their inline red/green `<div>`s. `magic-login.ts` deliberately kept inline (its whole page content is the status message, no form to pop a toast over). Business edit/delete and settings already used the old version; now all consistent with the new design. See `feature1.md`/`feature6-10-11.md` for detail.
- [ ] **Empty state improvements** — Not built. Still a single message + CTA, no step-by-step checklist.
- [ ] **Mobile navigation** — Not built. Sidebar is still a hamburger dropdown at all widths, no bottom nav bar on mobile.
- [ ] **404 page** — Not built. Unknown routes just redirect to `/`.
- [ ] **Dark mode** — Not built. No theme toggle or dark CSS variables anywhere.
- [ ] **Favicon + PWA manifest** — Not built. `index.html` links a remote icon URL; no local favicon or `manifest.json`.
- [ ] **Keyboard shortcuts** — Not built. No Cmd/Ctrl+K palette, no Escape-to-close on modals.
- [x] **Breadcrumb improvements** — Built. Breadcrumb items are real clickable `<a>` links (only the current page is plain text, which is correct behavior).
- [ ] **Business card — more info** — Not built. Cards still only show name/status/created date.
- [ ] **Copy to clipboard with feedback** — Partially built. Pattern exists on the Channels page and is reused in the lead details modal, but not in the session details modal.
- [ ] **Skeleton loading states** — Not built. Still a spinner overlay everywhere.
- [ ] **Pagination on tables** — Not built. No pagination controls on analytics or business list tables.

---

## 13. Frontend — Bugs & Code Quality

Defects, not missing features — kept separate from the feature groups above.

- [x] **register.ts max-height issue** — Fixed, no `max-height: 600px` constraint present anymore.
- [ ] **Hardcoded production URL** — Still present. `channels/detail.ts` hardcodes `https://formachat.com` as the fallback when not on localhost, instead of reading from env/config.
- [ ] **sessionStorage for verify-email** — Storage mechanism was switched to `localStorage` (good), but a new inconsistency was introduced: `register.ts` now bypasses `verify-email.ts` entirely with its own inline OTP step, so the two verification flows have diverged. Worth reconciling.
- [ ] **Analytics columns mismatch** — Still present and actually a bit worse than described: the dashboard sessions table, the leads table, and the "All Sessions" modal table all have different column counts/sets, and `analytics/index.ts` doesn't mirror the detail page's tables at all.
- [x] **Placeholder images** — Fixed. `shot1.png`–`shot5.png` all exist in `public/assets/` and are correctly referenced.
- [x] **TypeScript strict mode** — Already enabled (`"strict": true` plus `noUnusedLocals`/`noUnusedParameters` in `tsconfig.json`).
- [ ] **Error messages are too generic** — Partially fixed. `api.utils.ts` now returns structured `{code, message}` errors (`AUTHENTICATION_FAILED`, `NETWORK_ERROR`, etc.), but the service layer (`business.service.ts` etc.) still falls back to generic strings like "Failed to load businesses" instead of surfacing the specific code/message to the UI.

---

## Platform Integrations (Roadmap, not current sprint)

Backend-and-frontend-both-needed, but not scoped yet beyond the channel itself:

- [ ] WhatsApp Business API — pairs with §4 Live Product Catalog; product images should ride on this once both are built
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
| Embeddings | Pinecone's hosted embedding model (via `createEmbeddings` in `pinecone.ts`) — corrected 2026-07-12, this table previously said OpenAI text-embedding-3-small, which was never actually true; there is no OpenAI key anywhere in this project |
| Email | Resend |
| Queue | RabbitMQ (auth→email, chat→analytics.exchange) |

---

## Key Metrics to Start Tracking (not features — decisions)

- Messages per session · Lead capture rate · Session-to-lead conversion · Time to first response · Handoff rate · Token cost per session · Weekly active businesses · Webhook delivery success rate
