# Settings Overhaul: Multi-Device Sessions, Account Deactivation, Tabbed Settings

**Source:** requested directly after reviewing the Settings page.

---

## 1. Multi-device sessions (bug fix)

**Root cause found:** this was a deliberate design decision, not an accident. `refreshToken.model.ts` has a comment: *"Single session enforcement: Only one active (non-revoked) token per user"* — a unique partial index on `{userId, isRevoked:false}`, plus `generateTokenPair()` defaults `revokeExisting` to `true`, plus `completeLogin()` explicitly calls `revokeAllUserSessions()` before creating a new one. Every new login was designed to kill every other session. That's why logging into a second device only ever shows one session — the first one was silently revoked the moment the second login happened.

### Backend
- [x] Remove the unique partial index on `RefreshTokenModel` (`{userId, isRevoked}` unique) — this is what makes multiple simultaneous non-revoked tokens per user physically impossible at the DB level. Kept the other indexes (plain `userId`, `isRevoked`, TTL, `tokenHash`+`isRevoked`).
- [x] Flip `generateTokenPair()`'s default `revokeExisting` from `true` to `false`.
- [x] Remove the `sessionService.revokeAllUserSessions()` call from `completeLogin()` in `auth.login.controller.ts` — login no longer nukes other sessions.
- [x] **"Sign out of all other sessions"** — the endpoint (`POST /token/revoke-others`) already existed but was broken: `revokeAllSessionsExceptCurrent(userId, currentRefreshToken)` accepted the current token and never used it, so it revoked *everything* including the caller's own session. Added `tokenService.revokeAllUserTokensExcept()` (excludes by tokenHash) and wired it in; also added a 400 guard in the controller for a missing `refreshToken` (previously would've hashed `undefined` and revoked every session).
- [x] **Security trade-off, addressed rather than ignored:** password change *and* password reset (forgot-password confirm) both now revoke every other session after success, via `sessionService.revokeAllUserSessions()`. This closed two separate TODOs (`auth.password.controller.ts` had one in `changePassword` conceptually missing and a literal `// TODO` in `confirmReset`).
- [x] **Bonus fix, found while touching this code:** `deactivateAccount` also had a `// TODO: Revoke all active sessions/tokens` — now closed, deactivating signs out every device immediately.
- [x] **Production DB caveat handled:** removing an index from the Mongoose schema does NOT drop it from a live database (autoIndex only creates missing indexes, never drops orphaned ones). Added a one-time `RefreshTokenModel.syncIndexes()` call at server startup (`server.ts`, right after Mongo connects) — safe to leave running on every boot, becomes a no-op once the old index is actually gone.

### Frontend
- [x] Settings → Sessions: added a "Sign out of all other devices" button in the card header, wired to a new `revokeOtherSessions()` in `auth.service.ts` → `POST /token/revoke-others`.
- [ ] Confirm the sessions list actually shows multiple entries once deployed (this was the original bug report) — needs a live check after deploy, can't verify from here.

---

## 2. Account deactivation with grace period + email blacklist

**Current state (confirmed):** "Delete Account" already only sets `isActive: false` — never a real delete. But `loginUser()` filters `{ email, isActive: true }`, so a deactivated account is invisible to login forever. No reactivation path exists today. This is a dead end, not a grace period.

### Backend
- [x] Added `deactivatedAt?: Date` to the User model.
- [x] New `BlacklistedEmail` model: `{ email, blacklistedAt, reason }`.
- [x] Reworked `loginUser()`: finds user by email only (dropped the `isActive: true` filter), verifies password first (never reveals deactivation state to a wrong password), *then* branches:
  - Active → normal login, unchanged.
  - Inactive + within 30 days of `deactivatedAt` → auto-reactivates (`isActive = true`, clears `deactivatedAt`), audit-logs `account_reactivated`, returns `reactivated: true`.
  - Inactive + past 30 days (or no `deactivatedAt` on record) → treated as invalid credentials defensively; the cron job should already have deleted it by then.
- [x] New daily cron job `auth.cron.ts` (`setupAuthCronJobs()`, wired into `server.ts`, runs 4am daily): finds `isActive:false` users past the 30-day grace period, upserts their email into `BlacklistedEmail`, then hard-deletes the user record.
- [x] `registerUser()` checks the blacklist and rejects with `EMAIL_BLACKLISTED` (mapped to a 403 in the register controller) if blacklisted.
- [x] Closed the deactivation endpoint's TODO — see multi-device section above, same fix.
- [x] `AuditEvent`/`AuthLog` event-type unions extended with `'account_reactivated'` so the new audit-log calls typecheck.

### Frontend
- [x] Settings copy: "Delete Account" → "Deactivate Account", with copy explaining the 30-day grace period and permanent deletion + email blacklist after.
- [x] Login flow (`login.ts`): `completeSuccessfulLogin` now checks `data.reactivated` and shows "Welcome back — your account has been reactivated." before redirecting (all three login paths — password, 2FA, magic link — funnel through this one function, so all three get it for free).

---

## 3. Settings page restructure — tabbed, matching the business page pattern

Reuse the same approach as `components/business-tabs.ts`: one settings page, a tab bar, sub-sections instead of one long scroll.

- [x] Built directly into `settings.ts` (not a separate component file — business-tabs.ts is route-based because each business tab is a genuinely separate page/feature; settings' cards are small enough that client-side show/hide tab panels made more sense than adding three new routes). Visual style matches `business-tab-bar`/`business-tab-link`.
- [x] Tabs: **Account** (Profile, Deactivate Account), **Sessions** (Active Sessions + sign-out-others), **Security** (Change Password, Two-Factor). Existing card logic untouched — only which panel each card gets appended to changed.

---

## 4. Other settings features worth considering (not built yet — flagged for discussion)

- Email notification preferences (which emails you actually want - lead alerts, weekly digest, etc.)
- Login activity / audit log view (recent login attempts, not just active sessions)
- API key management (once §7 SDK work exists)
- Data export (download your account + business data as JSON/CSV - good practice, low effort)
- Connected accounts (once social sign-in exists)
- Timezone / language preference

---

## Notes as we build

- `tsc --noEmit` clean on both backend and frontend after all changes above.
- Not committed — same as always, your call on when to push.
- The `syncIndexes()` call in `server.ts` touches the live production database schema (drops the old unique index) the next time the server boots after deploy. It's additive-safe (only removes an index that's no longer in the schema, doesn't touch data), but flagging it explicitly since it's a production DB operation rather than pure app code.
- Deliberately not built (§4 stays a discussion list, not a queue): email notification preferences, login activity log, API key management, data export, connected accounts, timezone/language.
