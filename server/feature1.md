# Feature 1 — Auth & Account

## Post-deploy incident: server crash on missing idempotency key (fixed 2026-07-11)

After deploying, login attempts intermittently failed with a misleading "Invalid email or password" even for verified-correct passwords. Root cause, confirmed via Render logs: `auth.idempotency.middleware.ts` was declared `async` and `throw`n a raw `AuthError` (instead of calling `next(err)`) when a request to `/register`, `/password/change`, `/password/reset/confirm`, or `PUT /profile` arrived without an `X-Idempotency-Key` header. In Express 4, a throw from unwrapped async middleware becomes an unhandled promise rejection, which crashes the whole Node process (confirmed in logs: an unheadered curl to `/register` triggered `Unhandled Promise Rejection` immediately followed by a full server restart). Any other request in flight at that moment — including unrelated, correctly-passworded logins — failed as collateral damage. This bug pre-dates this session's work (the file was never touched in the Feature 1 commit). Fix: the missing-key branch now calls `next(new AuthError(...))` instead of throwing directly. Audited every other async middleware in the backend (`business/`, `chat/` modules included) for the same pattern — all others either throw synchronously (safely caught by Express) or catch their own throws locally; this was the only live instance.

**Status: 4/5 done, paused here.** Breach detection, Settings completion, 2FA, and Magic link are all built and typechecked clean on both backend and frontend. Social sign-in (Google/GitHub) is intentionally not started — it's the only piece needing new `.env` values, and per instruction that requires a check-in first. Decision made 2026-07-11: stop here rather than build ahead of the `.env` values. Resume by re-reading §5 below when ready — the plan doesn't go stale, it's just waiting on OAuth app registration outside this codebase.

**Source:** copied from `roadmap.md` §1 "Auth & Account". `roadmap.md` §1 has already been updated to reflect everything below — this file is now the detailed build log/reference for that section, not a pending task list. Keep it around as documentation rather than deleting it, since it explains *why* certain things were built the way they were (e.g. password-confirmed 2FA toggle instead of OTP-confirmed, the two live bugs found and fixed along the way).

**Env policy for this feature:** Social sign-in (Google/GitHub OAuth) is the only sub-feature that requires new `.env` values (OAuth client ID/secret per provider, callback URLs). Per instruction, that part will **not** be started, and no `.env` file will be touched, until explicitly confirmed. Everything else below (2FA, magic link, breach detection, settings completion) is buildable with zero new environment variables — confirmed by reading `auth.env.ts` and `email.env.ts` and checking what's already configured (JWT secrets, Resend, Redis, RabbitMQ are all already there).

---

## Copied from roadmap.md (starting state → now)

### Backend
- [x] Password reset (was already done; found + fixed a live bug in the confirm-reset validation schema along the way)
- [x] 2FA — DONE
- [ ] Social sign-in (Google/GitHub) — PAUSED, needs `.env`, see §5
- [x] Magic link login — DONE
- [x] Breach detection (HIBP) — DONE

### Frontend
- [x] Password reset flow (was already done)
- [x] Profile / account settings page — DONE (Active Sessions + Delete Account added; name/password editing already existed)
- [x] 2FA toggle/UI — DONE
- [ ] Social sign-in buttons — PAUSED, see §5
- [x] Magic link UI — DONE

---

## Build order

Sequenced from lowest-risk/no-new-surface to highest. Each item is independently shippable.

1. **Breach detection (HIBP)** — backend only, smallest change, no new routes.
2. **Settings completion** — Active Sessions view + Delete Account UI. Mostly frontend; one small backend fix (session revoke-by-id) because the existing `getActiveSessions` code has a latent bug (see below).
3. **2FA** — backend gating + 2 new authenticated endpoints + login flow change + frontend toggle + login OTP step.
4. **Magic link login** — new email template + 2 new public endpoints + frontend request/consume flow.
5. **Social sign-in (Google/GitHub)** — **paused**. Plan documented below; will not start until `.env` additions are confirmed with you.

---

## 1. Breach detection (HIBP)

**Current state:** `PasswordService.checkPasswordBreach()` in `auth.password.service.ts` checks a hardcoded array of 5 passwords. It's never called from any flow.

**Plan:**
- Replace the stub with a real call to the [Have I Been Pwned Pwned Passwords API](https://haveibeenpwned.com/API/v3#PwnedPasswords) k-anonymity endpoint: `GET https://api.pwnedpasswords.com/range/{first 5 chars of SHA-1(password)}`. This endpoint is free and requires **no API key** — so no `.env` change.
- Hash the candidate password with SHA-1 (Node `crypto`), send only the first 5 hex chars, compare the returned suffix list locally — the full password/hash is never transmitted.
- Soft-fail: if the HIBP API times out or errors, log a warning and treat as "not breached" — never block registration/password-change because a third-party API is down.
- Wire the check into three places:
  - `userService.registerUser()` — after strength validation, before hashing.
  - `userService.changePassword()` — after strength validation on the new password.
  - `passwordController.confirmReset()` — before hashing the new password.
- New error code `PASSWORD_BREACHED` (distinct from `WEAK_PASSWORD`) with message "This password has appeared in a known data breach. Please choose a different one."

**Frontend:** no changes required — register/settings/reset forms already render `error.message` from the API response generically.

### Status — DONE
- [x] Real HIBP k-anonymity check implemented in `auth.password.service.ts` (SHA-1 prefix only sent, 3s timeout, fails open)
- [x] Wired into `registerUser` (new `PASSWORD_BREACHED` error, handled in `auth.register.controller.ts`)
- [x] Wired into `changePassword` (handled in `auth.password.controller.ts`)
- [x] Wired into `confirmReset` (this path had **no** strength/breach check at all before — now has breach check; note: it still doesn't run `validatePasswordStrength`, only `resetPasswordSchema`'s regex via Zod, which is equivalent in practice)
- [x] Soft-fail behavior confirmed (API failure never blocks the user)
- [x] `tsc --noEmit` clean

---

## 2. Settings completion (Active Sessions + Delete Account)

**Current state:**
- Backend already has `GET /auth/sessions` (`userController.getSessions` → `sessionService.getActiveSessionInfo`) and `DELETE /auth/profile` (password-confirmed deactivation) — both fully implemented and just not called from the frontend.
- **Bug found while reading the code:** `SessionInfo.refreshToken: session.refreshToken` in `auth.session.service.ts` references a field that was never selected by the Mongo query (`.select('deviceInfo createdAt expiresAt')`) and doesn't exist under that name on the schema anyway (the stored field is `tokenHash`, a one-way hash — the raw token is never persisted). This field has always been `undefined`. Since we're building the UI that would need a session identifier to let a user revoke one specific session, this needs a real fix, not just a UI wrapper.

**Plan:**
- Backend fix: change `SessionInfo` to expose `id: string` (the Mongo `_id` of the `RefreshToken` document) instead of the broken `refreshToken` field. `_id` is returned by default even without being named in `.select()`.
- Add `tokenService.revokeSessionById(userId, sessionId)` — finds the `RefreshToken` doc by `_id` **and** `userId` (ownership check, so a user can never revoke someone else's session by guessing an ID), marks it revoked.
- Add `sessionService.revokeSessionById()` wrapper + audit log entry.
- New route: `DELETE /auth/sessions/:sessionId` (authenticated).
- Frontend: new "Active Sessions" card on `settings.ts` — lists device/IP/created/expires per session with a "Revoke" button per row; new "Danger Zone" card with password-confirmed "Delete Account" that calls the existing `DELETE /auth/profile`, then clears local auth and redirects to the login page.

### Status — DONE
- [x] Fixed `SessionInfo` to expose a real session `id` (was silently returning `undefined` for every session before)
- [x] `revokeSessionById` added to token + session services (ownership-checked — can't revoke another user's session by guessing an id)
- [x] `DELETE /auth/sessions/:sessionId` route + controller
- [x] Frontend: Active Sessions card in `settings.ts` (device/IP/date + per-session "Sign out")
- [x] Frontend: Delete Account card in `settings.ts` (password-confirmed, calls existing `DELETE /auth/profile`)
- [x] `tsc --noEmit` clean on both backend and frontend

**Note on single-session enforcement:** `RefreshTokenModel` has a unique partial index (`{userId, isRevoked:false}` unique where `isRevoked:false`), meaning the system currently allows only **one** active session per user at a time (logging in on a new device revokes the old one). So the Active Sessions list will realistically only ever show one entry today — the UI is still correct and useful (remote "sign out this device"), and will scale automatically if single-session enforcement is ever relaxed.

**Bugs discovered and fixed along the way (not part of the original 5 items, but found while working in this file and directly blocking already-"shipped" functionality):**
- `resetPasswordSchema` (Zod, used by `POST /auth/password/reset/confirm`) only declared `newPassword`/`confirmPassword`. Zod's default `z.object()` behavior strips any key not in the schema before the controller runs — so `email` and `otp` were being silently dropped from every request, and `confirmReset` always saw `email: undefined`, failing with "Invalid reset request" on every real attempt. This meant password reset was actually **broken at runtime** despite reading correctly in a static code review (this is exactly the kind of bug a code-reading sweep can't catch — it's a request-transformation bug, not a logic bug). Fixed by adding `email`/`otp` to the schema.
- `changePassword` (settings page) and `confirmPasswordReset` (forgot-password page) frontend calls never sent `confirmPassword`, which `changePasswordSchema`/`resetPasswordSchema` both require via a `.refine()` check. Same failure mode. Fixed by sending `confirmPassword: newPassword` from both call sites (no new UI field added, since the existing single-password-input UX doesn't need a second entry to satisfy the schema — the schema is just a change-detection guard against typos, not exposed as a second field the user fills in).

---

## 3. Two-Factor Authentication (2FA)

**Current state:** `OTPType.TWO_FACTOR_AUTH = '2fa'` already exists end-to-end in the OTP/email pipeline — `getOTPSubject`/`renderOTPEmail` in the email service already have `'2fa'` subject/message text defined and unused. Only the **login gate** and the **enable/disable toggle** are missing. This makes 2FA cheaper to build than it looks: the "send a code to the user's email" mechanism is 100% already there.

**Design decisions (kept deliberately simple, consistent with existing patterns in this codebase):**
- Enabling/disabling 2FA requires the user's **current password** in the same request (same pattern already used for account deletion) — proves account ownership without adding a second OTP round-trip just to flip a setting.
- The actual second factor at login time is a real emailed OTP (reusing the existing pipeline), not the enable/disable step.

**Backend:**
- Add `twoFactorEnabled: boolean` (default `false`) to `user.model.ts`.
- `POST /auth/2fa/enable` (authenticated) `{ password }` → verify password → set `twoFactorEnabled = true` → audit log.
- `POST /auth/2fa/disable` (authenticated) `{ password }` → verify password → set `twoFactorEnabled = false` → audit log.
- `loginController.login()` / `userService.loginUser()`: after password is verified valid, if `user.twoFactorEnabled`, do **not** create a session. Instead generate a `2fa` OTP (existing `otpService.generateOTP`, which already emails it) and return `{ success: true, data: { requiresTwoFactor: true, userId } }`.
- New route `POST /auth/login/2fa/verify` `{ userId, otp }` → verify OTP type `2fa` → run the same session-creation tail that normal login uses (revoke existing sessions, generate token pair, return user + tokens). Requires extracting that tail out of `loginController.login()` into a small reusable private method so both entry points share it.
- Rate-limited the same way the login route already is.

**Frontend:**
- `settings.ts`: new "Two-Factor Authentication" card with current status + password-confirmed Enable/Disable action.
- `login.ts`: if the login response has `data.requiresTwoFactor`, swap the password form for an OTP-entry step; on submit, call the new verify endpoint and complete login exactly like a normal login on success.
- New `AUTH_ENDPOINTS` entries + `auth.service.ts` functions (`enableTwoFactor`, `disableTwoFactor`, `verifyTwoFactorLogin`).

### Status — DONE
- [x] `twoFactorEnabled` field on user model
- [x] `POST /auth/2fa/enable` (password-confirmed)
- [x] `POST /auth/2fa/disable` (password-confirmed)
- [x] Login gating: password-valid + 2FA-enabled → OTP issued (reuses existing email pipeline), no session yet
- [x] `POST /auth/login/2fa/verify` completes login (rate-limited: 10 attempts / 15 min)
- [x] Refactored `loginController` session-creation tail into a shared `completeLogin()` helper used by both normal login and 2FA-verified login
- [x] Frontend: `LoginResponse` type widened to a union (`LoginSuccessResponse | LoginRequiresTwoFactorResponse`) with a type guard
- [x] Frontend: Settings "Two-Factor Authentication" card (status badge + password-confirmed enable/disable)
- [x] Frontend: Login page swaps to an inline OTP step when `requiresTwoFactor` comes back, reuses the same success/redirect path as normal login
- [x] `tsc --noEmit` clean on both backend and frontend

---

## 4. Magic link login

**Current state:** nothing exists. Building this from scratch, but reusing the existing OTP storage/producer/consumer pipeline rather than inventing a parallel one.

**Plan:**
- Extend `OTPType` with `MAGIC_LINK = 'magic_link'`.
- `otpService.generateOTP()`: for `type === 'magic_link'`, generate a longer random token (40 chars via the existing `CryptoUtils.generateSecureRandom`) instead of the normal 6-digit code — same storage path (hashed in Mongo, plaintext in Redis keyed by `otpId`), same `publishOTPGenerated` event, no new producer needed.
- Email side: add `magic_link` to the `OTPEmailParams`/consumer type unions. In `emailCoreService.sendOTPEmail`, branch: if `type === 'magic_link'`, render a **new** `magic-link.hbs` template (styled consistently with `otp.hbs`/`welcome.hbs`) with a CTA button linking to `https://formachat.com/#/magic-login?email=<email>&token=<token>` instead of the OTP code box. This follows the same hardcoded-production-URL pattern already used in every other template in this codebase (`welcome.hbs`, `lead-captured.hbs`, etc.) — not introducing a new inconsistency, just matching the existing (if imperfect) convention. No `.env` change needed.
- New routes:
  - `POST /auth/magic-link/request` `{ email }` → email-enumeration-safe, same shape as password reset request → `otpService.generateOTP({ type: 'magic_link' })`.
  - `POST /auth/magic-link/verify` `{ email, token }` → `otpService.verifyOTP(user.id, token, 'magic_link')` → same `isVerified` check and session-creation tail as normal login.
- Rate-limited like password reset (3/hour).

**Frontend:**
- `login.ts`: "Email me a login link" option → prompts for email → calls request endpoint → shows a "check your email" confirmation state.
- New page `magic-login.ts` + route `#/magic-login`: reads `email`/`token` from the query string on mount, auto-calls the verify endpoint, stores tokens and redirects to the dashboard on success, shows a clear error + link back to login on failure/expiry.
- New `AUTH_ENDPOINTS` + `auth.service.ts` functions.

### Status — DONE
- [x] `OTPType.MAGIC_LINK` added (auth.types.ts, OTP model schema + interface, otpService options)
- [x] `otpService.generateOTP` issues a 40-char token for `magic_link` instead of the 6-digit numeric code
- [x] `magic-link.hbs` email template (CTA button + fallback plain-text link + 10-minute expiry note)
- [x] `email.core.service.ts` branches on `type === 'magic_link'` to render the new template with a `https://formachat.com/#/magic-login?email=&token=` URL, reusing the existing OTP storage/producer/consumer pipeline end-to-end (no new RabbitMQ event needed)
- [x] `POST /auth/magic-link/request` (rate-limited 3/hour, email-enumeration-safe)
- [x] `POST /auth/magic-link/verify` (rate-limited 10/15min, checks `isVerified`, completes login via the shared `completeLogin()` helper)
- [x] Frontend: "Email me a login link instead" toggle on the login page (request + confirmation state)
- [x] Frontend: new `#/magic-login` page — parses `email`/`token` from the hash query string (the router only extracts path segments, so this reads `window.location.hash` directly), auto-verifies, saves tokens, redirects
- [x] `tsc --noEmit` clean on both backend and frontend

**Note:** the magic-link email URL is hardcoded to `https://formachat.com/#/magic-login?...`, matching the existing convention already used in every other email template in this codebase (`welcome.hbs`, `lead-captured.hbs`, `weekly-summary.hbs`, etc.). This is a known pre-existing inconsistency (flagged in `roadmap.md` §13 as "hardcoded production URL"), not a new one introduced here — fixing it properly would mean adding a `FRONTEND_URL` env var across every template at once, which is out of scope for this feature and would need the env sign-off this file is otherwise avoiding.

---

## 5. Social sign-in (Google/GitHub) — PAUSED, plan only

**Not started.** This is the one sub-feature that needs new `.env` values: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and callback URLs for each provider, registered in Google Cloud Console / GitHub OAuth Apps first (outside this codebase). Per your instruction, I will check in with you before touching `.env` or starting this piece.

**Rough shape for later (not being built yet):**
- Backend: OAuth authorization-code flow (no `passport` dependency needed — can be done with direct HTTP calls to each provider's token endpoint). On successful OAuth callback: find-or-create user by email, set `source: 'google' | 'github'`, issue normal session tokens. Users created this way get a random unusable password hash (never used to log in) since `passwordHash` is currently required on the schema.
- Frontend: "Continue with Google" / "Continue with GitHub" buttons on login and register pages, redirecting to the backend's OAuth start route.
- Ties into `roadmap.md` §5 (Admin Dashboard) note: admin login must never share this OAuth session/client with business-owner accounts.

### Status
- [ ] Confirm `.env` plan with you (client IDs/secrets, callback URLs)
- [ ] Backend OAuth flow (Google)
- [ ] Backend OAuth flow (GitHub)
- [ ] Frontend buttons + callback handling
