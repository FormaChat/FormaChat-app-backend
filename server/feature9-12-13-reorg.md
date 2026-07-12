# Feature 9, 12, 13 + Business Section Reorg

**Source:** `roadmap.md` §9 (Analytics), §12 (UX Polish), §13 (Bugs), plus a structural reorg requested directly (Products and Knowledge Base Health currently live under Channels — wrong section; should live under the Business a page belongs to, alongside a restructured Questionnaire).

**Constraints given directly:** no new colors — reuse the existing olive palette (`#636b2f` primary, `#bac095` secondary, `#f4f6ea`/`#dde2c8` light-olive toast tones, `#16a34a`/`#dc2626` for status) everywhere. Every UI piece must work on both desktop and mobile.

**How to use:** same convention as the other `feature*.md` files — `[x]` done, `[ ]` not yet.

---

## 0. Business Section Reorg (build first — everything else assumes this layout)

**Decision (confirmed):** tabs on one page-per-business. A "Health" status strip sits above the tabs (visible regardless of active tab). Tabs: **Questionnaire** / **Products** / **Documents**. Each tab keeps its own route (`/edit`, `/products`, `/documents`) rather than merging into one mega-component — lower risk to the existing 4-step wizard's internal logic, and a shared tab-bar component just renders on top of each page so navigating tabs is a normal route change.

Channels page is trimmed back down to actual channel/distribution concerns: Test Your Bot, QR code, Share & Embed, Widget Appearance, Webhooks. "Manage Products" card, "Knowledge Base Health" card, and "Quick Tips" card all removed from there.

### Backend — DONE
- [x] **Document upload endpoint** — `POST /businesses/:id/documents/upload` (multer memory storage, 15MB limit, PDF/DOCX mimetype-checked) → new `uploadRawBuffer()` in `cloudinary.ts` (Cloudinary `resource_type: 'raw'`) → new `document.service.ts` pushes `{fileName, fileUrl, uploadDate, fileSize}` into `business.files.documents` via `$push` → fires (non-blocking) `vectorService.triggerVectorUpdate()`. The parsing/embedding side of this (`embeddingService.embedDocument()`, PDF via `pdf-parse`, DOCX via `mammoth`) already existed and needed zero changes — it was just never reachable before.
- [x] **Document delete endpoint** — `DELETE /businesses/:id/documents/:fileName` — `$pull` from the array, re-triggers vector sync.
- [x] **List documents** — confirmed `GET /businesses/:id` already returns `files.documents`, no new endpoint needed.
- [x] `tsc --noEmit` clean.

### Frontend — DONE
- [x] **`components/business-tabs.ts`** — `renderBusinessSectionHeader(businessId, name, activeTab)`: business name, a compact health strip (score/tier/bar/top-4 failing checks, all best-effort — page still renders if the health call fails), and the tab bar. Mobile: tab bar is a horizontally-scrollable row (`overflow-x: auto`, scrollbar hidden) instead of wrapping.
- [x] **Wired into `edit.ts`** (Questionnaire tab, active) — prepended above the existing wizard, wizard internals untouched.
- [x] **Wired into `products.ts`** (Products tab, active) — prepended above the product grid; removed the page's own redundant `<h1>Products</h1>` since the tab bar + section header now carry that.
- [x] **New `documents.ts`** (Documents tab, active) — upload zone + button, PDF/DOC file-type icon badges, name/size/upload-date per row, delete with confirm. Empty state when no documents yet.
- [x] **`channels/detail.ts` cleanup** — removed the "Manage Products" card, the "Knowledge Base Health" card (all ~90 lines of it — logic now lives once in `business-tabs.ts` instead of duplicated), and the "Quick Tips" card, plus their now-dead CSS (`.tips-list`/`.tip-item`/`.tip-icon`) and the now-unused `getBusinessHealthScore` import. Channels page is back to just Test Your Bot / QR / Share & Embed / Widget Appearance / Webhooks — actual channel/distribution concerns only.
- [x] Mobile checked: tab bar scrolls horizontally instead of cramming, health strip wraps its chips, upload zone and document rows stack cleanly at narrow widths.

---

## 13. Frontend — Bugs & Code Quality — DONE

- [x] **Hardcoded production URL** — added `PRODUCTION_APP_URL` + `getPublicAppUrl()` to `api.config.ts` (single source of truth), replaced both duplicated inline occurrences in `channels/detail.ts` (the chat-simulator link and the widget embed snippet).
- [x] **sessionStorage/localStorage inconsistency** — reconciled by elimination rather than patching: `register.ts`'s entire standalone `createOTPSection()` (successMsg, form, verify handler, resend handler — ~110 lines) is deleted. Registration now sets `localStorage.setItem('pendingVerificationEmail', email)` and redirects to `#/verify-email`, the exact same handoff `login.ts` already uses for `EMAIL_NOT_VERIFIED`. One verification implementation instead of two that could drift apart; also removed the now-dead `.success-message`/`.otp-input` CSS and unused `verifyEmail`/`resendOTP`/`OTPType` imports.
- [x] **"Analytics columns mismatch" — investigated, turned out not to be a real bug.** The modal "All Sessions" table's 4th column is a checkbox that powers actual bulk-delete functionality (confirmed live in the code, not dead markup) — the 3-column summary preview on the main page correctly omits it since it doesn't need bulk actions. The leads tables were already consistent (3 columns in both places). `analytics/index.ts` isn't a table page at all — it's a business-picker grid linking into `analytics/:id`; there was never anything for it to "mirror." Original roadmap note overstated this one; correcting rather than force-changing something that isn't broken.
- [x] **Generic error messages** — audited every `catch` block across the dashboard (24 instances found via `grep`). Root cause: `business.service.ts` (and friends) already throw with the specific backend message (`throw new Error(response.error.message || 'generic')`), but most UI-layer `catch` blocks were discarding that `.message` and showing an unrelated hardcoded string instead. Fixed in `businesses/list.ts`, `edit.ts`, `products.ts`, `documents.ts`, `channels/detail.ts`, `channels/index.ts`, `analytics/detail.ts`, `analytics/index.ts`, `settings.ts` (8 spots), `verify-email.ts` — every one now does `error?.message || '<original generic fallback>'`, so the specific reason surfaces when the backend provides one and the friendly fallback still applies when it doesn't.
- [x] `tsc --noEmit` clean.

---

## 9. Analytics & Reporting

### Backend — DONE
- [x] **`AnalyticsEvent` model** (`chat/model/analyticsEvent.model.ts`) — `eventId` (unique, used for idempotent upsert), `eventType`, `businessId`, `sessionId`, `data` (mixed), `occurredAt`.
- [x] **Analytics consumer** (`chat/config/analytics.consumer.ts`) — separate RabbitMQ connection (not sharing the publisher's), binds a durable queue to `analytics.exchange` with pattern `chat.*` (matches all three routing keys `chat.rabbitmq.ts` already publishes), upserts into `AnalyticsEvent` on `eventId` so redelivery can't create duplicates, acks even on a parse failure (best-effort reporting data — a malformed message will never succeed on retry, no reason to requeue it). Wired into `server.ts` startup (after the other consumers) and graceful shutdown.
- [x] **Correction to scope:** the roadmap's framing implied charts would read from this new collection. In practice `AnalyticsEvent` only has data from the moment this consumer went live — it has zero history for any existing business. The chart-data endpoint below reads the existing operational collections (`ChatSession`/`ChatMessage`/`ContactLead`) instead, so charts show real historical data immediately. `AnalyticsEvent` is still valuable — built and running — as the foundation for future heavier aggregation/reporting that shouldn't hit operational tables directly (per `roadmap.md`'s own note about when to extract Analytics into its own service), it's just not what's powering charts on day one.
- [x] **`GET /business/:businessId/analytics/chart-data?days=N`** — new `chatService.getChartData()` aggregates sessions/messages/leads per day (MongoDB `$group` by `$dateToString`), zero-fills any day with no data so the chart always shows a continuous N-day range (1–30, default 7).
- [x] `tsc --noEmit` clean.

### Frontend — DONE
- [x] **`components/charts.ts`** — pure SVG line chart and bar chart, no new dependency. Olive-only: `#636b2f` (primary/line/dots), `#bac095` (bars), a translucent olive area fill under the line, `#888`/`#e8e8e0` for labels/gridlines (neutral tones, not new brand colors). Responsive via `viewBox` + `width:100%`, per-point `<title>` tooltips, x-axis labels thin out automatically past 7 points so they don't collide.
- [x] **Wired into `analytics/detail.ts`** — new charts grid (responsive `auto-fit minmax(280px,1fr)`) between the stat cards and the sessions/leads tables: Sessions per day (line), Messages per day (bar), Leads captured per day (line). Best-effort — page still renders fully if the chart-data call fails.
- [x] `tsc --noEmit` clean.

---

## 12. Frontend — UX Infrastructure & Polish — DONE (prioritized subset)

- [x] **Empty state improvements** — `components/empty-state.ts` gained an optional `checklist?: string[]` field (backward compatible, every existing caller unaffected). Wired into the analytics "no chat activity yet" state specifically (the one the roadmap called out): "Share your bot link → Embed on your website → Test in the simulator", plus a "Go to Channels" button. That empty state was previously raw inline HTML, not even using the shared component — now it does.
- [x] **Mobile navigation** — new `components/mobile-bottom-nav.ts`: fixed bottom tab bar (Home/Businesses/Channels/Analytics/Settings, same 5 items and icons as the existing hamburger menu), `display:none` above 768px so it's mobile-only. The hamburger toggle in `navbar.ts` is hidden below 768px via CSS so there's no redundant double-navigation — the dropdown menu itself never opens since its trigger button is gone at that width. Added bottom padding to `.dashboard-content` at mobile widths so page content never sits under the fixed bar.
- [x] **404 page** — new `pages/public/not-found.ts`, wired into `router.ts`'s previously-silent `this.navigate('/')` fallback. Adapts its "back" link based on auth state (dashboard if logged in, home if not). Embed-mode 404 handling (chat widget invalid-link case) untouched.
- [x] **Favicon + PWA manifest** — `index.html`'s favicon/apple-touch-icon switched from a remote `https://www.formachat.com/...` URL to the local `/assets/logo.png` that already existed in `public/assets/`, added `theme-color` meta (`#636b2f`) and a new `public/manifest.json` (name/short_name/icons/theme_color/background_color). **Honest caveat:** this reuses `logo.png` at its native resolution for all icon sizes rather than proper resized exports (192×192, 512×512, 180×180 apple-touch) — I don't have image-editing tools available to generate correctly-sized assets. Browsers generally scale gracefully, but a follow-up with real exported sizes would be the fully-correct version.
- [x] **Business card — more info** — added `chatbotTone` and `vectorStatus` badges to `components/business-card.ts` (color-coded: green "Knowledge base ready", amber "Syncing...", red "Sync failed", gray "Frozen"), wired into all three call sites (`businesses/list.ts`, `channels/index.ts`, `analytics/index.ts`) — all of which already fetch the full `Business` object, so this was free (no extra requests). **Scoped down:** session count and lead count were *not* added — those live in the chat service, not the business object, and adding them would mean one extra network call per card on every list page (N+1), which isn't worth it for a nice-to-have list-view detail.
- [x] **Copy to clipboard with feedback** — `session-details-modal.ts` had no copy button on its Session ID field. Added the exact same `.copy-btn-icon` pattern already used in `lead-details-modal.ts` (same SVG icon, same checkmark-swap-back behavior) rather than reinventing it.
- [x] **Pagination on tables** — new reusable `components/pagination.ts` (prev/next + numbered pages with smart ellipsis collapsing for page counts beyond 7). Wired into two places:
  - `businesses/list.ts` — this was a **real, previously-silent bug**: `getBusinesses()` always requested `limit=10` with zero UI to reach page 2, meaning any account with more than 10 businesses could never see the rest. Added `getBusinessesPaginated()` to `business.service.ts` (returns the pagination metadata the backend already provides but the old function discarded) and wired real page controls.
  - `analytics/detail.ts`'s "All Sessions" and "All Leads" modals — client-side pagination (15/page) over the already-fetched up-to-100 records, no new network calls. The sessions modal's bulk-select `Set` of checked IDs persists correctly across page navigation (checkboxes re-check themselves against the shared `Set` when a page re-renders).
- [x] `tsc --noEmit` clean after every change.

**Deferred, not attempted this pass** (flagging why rather than silently skipping):
- **Dark mode** — a full theme-variable pass across every page; large enough to deserve its own pass rather than being squeezed in here.
- **Keyboard shortcuts** — lowest value of the list relative to effort; revisit if requested.
- **Skeleton loading states** — cosmetic upgrade over the existing spinner; lower priority than the structural/functional items above.

---

## Notes as we build
