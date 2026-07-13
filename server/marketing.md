# FormaChat — Marketing Email Plan

**Prepared:** 2026-07-13. Audience: your existing registered users (people who already signed up but may not know how much has shipped since). Not an acquisition campaign — a re-engagement/product-update email.

## The one-email-or-many decision

**Recommendation: one single email now.** Here's the reasoning, as a marketing call, not just a content question:

- You have a *lot* of shipped features and a real roadmap. The instinct to split that into a drip series (one email per feature) feels thorough, but for a re-engagement email to existing users, a rapid sequence of "New feature: X!" emails in the same week reads as spam pressure, not progress — especially to users who signed up a while ago and haven't logged back in. Multiple emails landing close together is the actual spam signal, not the length of one email.
- One well-organized "here's everything at a glance" email, sent once, does the opposite: it reads as a genuine update, gives the reader full context in one sitting, and ends with a single clear next step (log back in). That's a normal, expected pattern for a product update email — most SaaS companies send exactly this kind of "state of the product" email periodically.
- **The follow-up habit to build going forward:** once this baseline email is out, don't repeat the full list again. Future emails should be one-feature-at-a-time announcements *only* when something genuinely new ships (e.g., "Human handoff is live"), spaced out naturally by real release cadence rather than a schedule. That's what keeps a feature-update email list from turning into noise over time.

## What's actually live today (pulled from the build, not just the roadmap — `roadmap.md` was pruned to only show what's *left*, so the done list below is reconstructed from the actual shipped work this project)

1. AI chatbot trained on the business's own data (RAG via Pinecone + Groq) — answers customer questions 24/7 using their real products, policies, and FAQs, not generic responses.
2. AI-assisted onboarding — paste website copy or upload a document and FormaChat drafts the business profile automatically instead of a blank form.
3. Live product catalog — photos, prices, stock counts; the chatbot always quotes current numbers pulled live, never a stale snapshot.
4. Document knowledge base — PDF/Word upload, automatically parsed and embedded into the AI's knowledge.
5. Embeddable chat widget — one script tag, works on any site, customizable color/position/avatar, mobile-responsive full-screen mode.
6. Lead capture — conversations that share contact info become leads, viewable with full session history.
7. Analytics dashboard — sessions/messages/leads charted over time, CSV export.
8. Webhooks — signed, retried delivery into a CRM/Zapier/custom system the moment a lead is captured.
9. QR code and shareable chat links — zero-friction way to get a conversation started.
10. Account security — two-factor authentication, magic-link sign-in, breach-checked passwords, multi-device session management, and account deactivation with a 30-day reactivation window instead of instant, unrecoverable deletion.

## What's coming (curated from `roadmap.md`, filtered to what a business owner would actually care about — internal-only items like the admin dashboard or dark mode are left out of customer-facing marketing copy)

1. Live streaming responses — answers appear as they're generated instead of a wait-then-reveal.
2. Multi-language support.
3. Human handoff — hand a conversation to a real person when it gets complex.
4. WhatsApp, Telegram, Instagram, and more — meet customers on the channels they already use.
5. Simple pricing tiers as the free-for-now product moves toward paid plans.
6. A developer API/SDK for custom integrations.

## Email structure (matches your existing template design system — `welcome.hbs`)

- Banner image (same `EMAIL_BANNER_URL` every other email uses)
- Short intro/greeting
- "What's live right now" — numbered list
- "What's coming next" — numbered list
- Single CTA button: "Log In & Explore" → dashboard
- Same footer pattern (copyright, olive divider) as every other template

No new colors — olive `#636b2f` only, same as every other email, matching `welcome.hbs` exactly (same fonts, same spacing, same button style).

## Sending plan

1. **Preview to yourself first:** `npx tsx scripts/send-marketing-preview.ts` — sends the real rendered email to `owusujoyansah@gmail.com` only. Safe to run any time, sends nothing to real users.
2. **Broadcast to real users, when you're ready:** `npx tsx scripts/send-marketing-broadcast.ts` — defaults to a **dry run** (prints the recipient list and count, sends nothing) until you pass `--send`. Targets everyone with `isActive: true` AND `isVerified: true` — active accounts that completed registration and never deactivated. Sends one email at a time, personalized by first name, with a short delay between sends to stay well under Resend's rate limits. This script is yours to run when you decide to pull the trigger — it's not something that runs on its own.

## Notes

- Not committed - same as always, your call on when to push.
- If you want a shorter "highlights only" version instead of all 10 current features, say so and I'll trim it — right now it's the full list per your instruction.
