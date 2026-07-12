# Questionnaire Modernization

**Source:** requested directly after a review of the onboarding wizard against modern SaaS onboarding standards.

**Assessment given (for reference):** the wizard was functional and reasonably polished (tile checkboxes, dynamic arrays, glass UI) but had no AI-assistance filling out an AI product's own setup form, no autosave, no live tone preview, and no industry-aware defaults. Chose to build AI pre-fill first (highest leverage, directly fixes "how do I hand over a document instead of typing everything").

## Built

### Backend
- [x] `GROQ_API_KEY`/`GROQ_MODEL` exposed to the business module (reused, not a new credential — same env var the chat module already uses).
- [x] `business/services/prefill.service.ts` — extracts text from an uploaded PDF/DOCX (small self-contained duplicate of `embedding.service.ts`'s parsing, deliberately not shared — this runs before a business exists, so there's no Cloudinary URL to download from yet) or accepts pasted raw text, sends it to Groq with a structured-extraction prompt, returns sanitized JSON: `businessDescription`, `businessType`, `offerings`, `faqs[]`, `refundPolicy`, `chatbotTone`.
- [x] `POST /businesses/prefill` — authenticated, no ownership check (business doesn't exist yet).

### Frontend
- [x] New "Quick Start" step (Step 1 of 5, before the existing 4 steps) in `businesses/create.ts`: paste text and/or upload a PDF/DOCX, "Generate Suggestions" button calls the endpoint and populates the actual wizard fields in steps 2-5 (dispatches `input`/`change` events so character counters update correctly), or "Skip - I'll fill it in myself" to bypass entirely and use the wizard exactly as before.
- [x] Not built into `edit.ts` — pre-fill only makes sense once, at creation; editing an existing business already has real data to work from.

## Follow-up requested mid-build: remove duplicate Products questionnaire

While building the above, flagged that "Popular Items" (a free-text name/description/price array inside the questionnaire's Products & Services step) duplicates the new structured Products tab. Fixed:

- [x] Removed the "Popular Items" dynamic array from **both** `create.ts` and `edit.ts`'s Products & Services step. Kept "What do you offer?" (general text), Service Delivery options, and the pricing-discussion toggle — those aren't duplicated by the Products tab (delivery method and pricing-discussion policy are different concepts than individual SKUs).
- [x] `productsServices.popularItems` is now always sent as `[]` on create/edit — the field still exists on the backend schema (harmless, unused going forward) rather than requiring a schema migration.
- [x] Removed `popularItems` from the AI pre-fill extraction entirely (backend prompt + sanitizer) — no point drafting a field the UI no longer shows.
- [x] **Business creation now redirects straight to the new business's Products tab** instead of back to the business list, with a toast: "Business created! Now add your products." This directly addresses "I want users to even see [Products] when creating a business" — since products are scoped by `businessId` and can't exist before the business does, the fix is getting the owner onto the tabbed page (Questionnaire/Products/Documents) the instant creation succeeds, same page `edit.ts` already uses.

## Deliberately not attempted this pass
- Autosave drafts to `localStorage` (next priority per the original 4-item plan).
- Industry-aware defaults/placeholders per business type.
- Live tone preview.
- Turning AI-extracted "popular items" (when the LLM does spot them in a document) into actual pre-created Product entries via the Products API — currently that signal is just discarded since the field was removed. Worth revisiting once the base flow is confirmed working.

## Notes / things to verify once deployed
- `tsc --noEmit` clean on both sides.
- Not committed — same as always, your call on when to push.
