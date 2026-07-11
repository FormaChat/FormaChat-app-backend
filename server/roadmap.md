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

## 4. Live Product Catalog (NEW, proposed 2026-07-11)

**Goal:** restructure the business profile into two distinct sections — a **Questionnaire** (the existing static business-info wizard) and a **Products** section where owners add per-product images and live stock counts. The chatbot reads current stock/price directly, not a stale snapshot from onboarding. This is the foundation for a future POS/e-commerce mode, and for sending product images through channel integrations like WhatsApp.

**Current state:** the business model has a `productsServices` field, but it's a free-text description, not a structured catalog — no per-product entity, no images, no stock/quantity field exists anywhere in the schema.

### Backend
- [ ] **Product model** — new collection (not embedded free text): `businessId`, `name`, `price`, `stockQuantity`, `imageUrl` (Cloudinary), `category`, `description`, `pineconeVectorId`. Kept separate from the vision/embedding pipeline so a stock update doesn't require re-running image description + re-embedding.
- [ ] **Image upload → vision description → Pinecone embedding** — GPT-4o vision description + Cloudinary storage + embed description into Pinecone with `imageUrl` in metadata, scoped per-product.
- [ ] **Live stock editing endpoint** — fast write path for just the quantity field, separate from the full business-save flow, since it's meant to be updated frequently.
- [ ] **Keep stock/price in sync with the vector store** — recommend MongoDB as source of truth (looked up at response time), Pinecone only for semantic search + returning the product ID, to avoid re-embedding on every stock change.
- [ ] **Chat response returns `products[]` with live data** — chat service looks up current stock/price from MongoDB by product ID after a Pinecone match, so the number shown is never stale even if the vector hasn't been re-synced.
- [ ] **Future POS/e-commerce hook** — Product model designed so stock-decrement events (from an order, a POS sync, etc.) can plug in later without a schema rewrite.

### Frontend
- [ ] **Products section in the dashboard** — new UI area (alongside, not replacing, the existing 4-step questionnaire wizard) for adding/editing products: image upload, name, price, stock count.
- [ ] **Live stock editing UI** — quick inline quantity edit, paired with the fast backend write path above.
- [ ] **Chat widget product cards** — render `products[]` (image + name + price + stock) inline in the chat widget once the backend returns them.
- [ ] **WhatsApp image delivery (future, blocked on WhatsApp integration)** — once WhatsApp ships, product images ride on the same Cloudinary URLs already stored per product — no extra work needed if the Product model above is in place first.

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

### Backend
- [x] **Basic webhook firing** — `webhookUrl` field exists on the business model and fires a best-effort `axios.post` on lead capture.
- [ ] **Dedicated Webhook model** — Not built (url/events[]/secret/delivery log).
- [ ] **HMAC-SHA256 signing** — Not built.
- [ ] **Retry with exponential backoff** — Not built.
- [ ] **More webhook events** (`session.started`, `handoff.requested`, `usage.limit.warning`) — Not built.

### Frontend
- [x] **webhookUrl field in business wizard** — Present in both `create.ts` and `edit.ts`, paired with the basic firing above.
- [ ] **Webhook dashboard** — register/edit/delete webhooks, view delivery history, re-trigger failed deliveries. Not built — blocked on the backend Webhook model above.

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

No major backend counterpart yet beyond the chat API itself.

- [ ] **Channels page live test panel** — Partially built. "Launch Simulator" opens a popup window (`window.open`), not an embedded inline panel as planned.
- [ ] **Widget customization** (colors, position, avatar, greeting via dashboard) and **CDN-hosted standalone widget JS** — carried over from the original `plan.md`; not independently re-verified in this sweep, but no evidence of either turned up while reviewing the frontend wizard or widget files. Treat as still not built until re-checked.

---

## 11. Frontend — Copy & Beta Cleanup

No backend counterpart — pure content/copy changes.

- [ ] **register.ts button text** — Still says **"Start Free Beta Access"** (`register.ts:299`). Not changed.
- [ ] **home.ts beta badge** — Badge markup/text removed, but the `.beta-badge` CSS class is still defined and unused — needs a cleanup pass, and worth double-checking no other beta copy remains on the page.
- [x] **index.html "no credit card" text** — Already updated, no "beta access" wording.
- [x] **dashboard/home.ts cards** — "Beta Perks" card is gone; "What's Live Now" and "Coming Soon" cards are accurate to current build state.
- [ ] **Page title** — `<title>` tag is updated, but there's still a hidden `<h1>Formachat - AI Customer Support</h1>` on the page using the old copy — should be updated to match.

---

## 12. Frontend — UX Infrastructure & Polish

No direct backend counterpart — pure frontend UX work.

- [ ] **Toast / notification system** — Partially built. `toast.ts` is used in business edit/delete and settings, but not in register's OTP resend or the logout flow — inconsistent coverage.
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
| Embeddings | OpenAI text-embedding-3-small |
| Email | Resend |
| Queue | RabbitMQ (auth→email, chat→analytics.exchange) |

---

## Key Metrics to Start Tracking (not features — decisions)

- Messages per session · Lead capture rate · Session-to-lead conversion · Time to first response · Handoff rate · Token cost per session · Weekly active businesses · Webhook delivery success rate
