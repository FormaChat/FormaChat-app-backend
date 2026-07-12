# Feature 4 — Live Product Catalog

**Source:** copied from `roadmap.md` §4.

**How to use:** same convention as `feature1.md`/`feature6-10-11.md` — `[x]` = built and verified, `[ ]` = not yet. Update as we go; when done, go back to `roadmap.md` and flip the corresponding boxes.

---

## Goal (unchanged from roadmap.md)

Restructure the business profile into two distinct sections — a **Questionnaire** (the existing static business-info wizard) and a **Products** section where owners add per-product images and live stock counts. The chatbot reads current stock/price directly, not a stale snapshot from onboarding. Foundation for a future POS/e-commerce mode and for sending product images through channels like WhatsApp.

## Decisions made before building

1. **Product descriptions are owner-typed, not AI-generated from photos.** The original plan called for GPT-4o Vision to auto-describe uploaded images. This project has no OpenAI key (everything else runs on Groq), so rather than add a new paid dependency, the owner types name/category/description/price when adding a product — same pattern as every other field in the wizard today. The image is still uploaded and stored (for display in chat/WhatsApp later), it's just not what generates the searchable text. This also means **no vision API, no new AI cost per product** — the existing text-embedding pipeline (`embeddingService.embedTexts`) handles it exactly like any other business text field.
2. **Image upload is server-mediated, not a direct-to-Cloudinary unsigned upload.** No upload pipeline exists anywhere in this codebase yet (no `multer`, no Cloudinary SDK wired in — the credentials sit unused in `.env`, and `business.env.ts`'s schema literally has them commented out). A direct-from-browser unsigned upload would need an "unsigned upload preset" configured in your Cloudinary dashboard first (a manual step outside my control). Server-side upload instead: browser sends the file to our API, we upload to Cloudinary with the existing secret key, return the URL. Nothing for you to configure — just two new npm packages (`multer`, `cloudinary`).
3. **Correction to `roadmap.md`'s Tech Stack table:** embeddings are **not** actually OpenAI's `text-embedding-3-small` as documented — `pinecone.ts` uses Pinecone's own hosted embedding model (`createEmbeddings` "replaces OpenAI's embedding API", per its own comment). Will fix that line in `roadmap.md` when this feature lands.

---

## Backend — DONE

- [x] **Enable Cloudinary config** — uncommented in `business/config/business.env.ts`'s envalid schema. New `business/config/cloudinary.ts` configures the SDK from `CLOUDINARY_URL` (parsing the cloud name out of it) + the explicit key/secret, and exports `uploadImageBuffer(buffer, folder)` wrapping `cloudinary.uploader.upload_stream`.
- [x] **Image upload endpoint** — `POST /businesses/:id/products/upload-image`. Installed `multer` + `cloudinary` (`pnpm add`) — neither existed in this codebase before. Multer uses memory storage (5MB limit) so the buffer goes straight to Cloudinary, never touching disk. Rejects non-image mimetypes. Same `authMiddleware` + `ownershipMiddleware` pattern as every other business route.
- [x] **`Product` model** (`business/models/product.model.ts`) — `businessId`, `name`, `description`, `price`, `stockQuantity`, `category`, `imageUrl`, `isActive`, `pineconeVectorId`. Own collection, not embedded — confirmed a stock write never touches the rest of the document.
- [x] **Product CRUD routes** (`business/controllers/product.controllers.ts`, `business/services/product.service.ts`) — `GET/POST /businesses/:id/products`, `PUT/DELETE /businesses/:id/products/:productId`. Create/update builds the embedding text as `"{name}. {description} Category: {category}. Price: ${price}."` and reuses `embeddingService.embedTexts()` completely unchanged (this is exactly why skipping vision AI was low-cost — the text-embedding path already existed and needed zero new code). Upserts into the business's existing namespace (`business_${businessId}`, same convention as everything else) with `type: 'product'`, `productId`, `name`, `price`, `imageUrl` in vector metadata. Delete removes the Mongo doc **and** calls the existing `deleteVectors()` helper — if that fails, logs a warning but still deletes the Mongo doc rather than leaving an orphaned, undeletable product.
- [x] **Re-embed only when searchable fields change** — `updateProduct` diffs `name`/`description`/`category`/`price` before deciding whether to re-embed; a stock-only or image-only update (via `updateProduct`, not the fast path) skips the Pinecone call entirely.
- [x] **Live stock endpoint** — `PATCH /businesses/:id/products/:productId/stock`. Single `findOneAndUpdate` on `stockQuantity` only — no re-embedding, no Pinecone touch, no other-field validation overhead.
- [x] **Chat integration** — `chat.pinecone.config.ts`'s `searchBusiness()` now returns `metadata` per result (previously stripped down to just `sourceType` — additive change, doesn't break the two other existing callers). `chat.service.ts` has a new private `getProductsFromSearch()`: filters results where `metadata.type === 'product'`, dedupes `productId`s, looks up live data via `productService.getProductsByIds()` (MongoDB, always current), and the result is threaded through `sendMessage()`'s return type → `chat.controller.ts`'s response body as `data.products`. Only wired into the non-streaming `sendMessage` path (what the frontend widget actually calls today) — `sendMessageStream` untouched, since nothing consumes SSE yet per `roadmap.md` §2.
- [x] **POS/e-commerce hook** — not building anything now, confirmed the model shape doesn't block it: `$inc` on `stockQuantity` is all a future order/POS integration would need.
- [x] `tsc --noEmit` clean.

## Frontend — DONE

- [x] **Products page** — new page at `#/dashboard/businesses/:id/products` (`pages/dashboard/businesses/products.ts`), linked from a new "Products" card on the Channels detail page (not the business edit wizard - kept the questionnaire and the product catalog as clearly separate concerns, matching the roadmap's "alongside, not replacing" framing). Grid of product cards (image thumbnail or placeholder, category, name, price, description, inline stock editor, Edit/Hide/Delete). "+ Add Product" and "Edit" both open the same modal: file input (uploads immediately on selection via the new upload endpoint, shows a live preview), name, category, price, stock, description.
- [x] **Live stock editing UI** — built directly into each product card (not a separate view): number input + "Save" button, calls `PATCH .../stock` directly — no full form, no re-fetching the whole product list.
- [x] **Chat widget product cards** — `chat-widget.ts`'s `sendChatMessage` handler now renders a `product-cards-wrapper` under the bot's text bubble whenever `response.products` is non-empty: small horizontal cards (image, name, price, "N in stock" / "Out of stock" in green/red). New `ChatProduct` type exported from `chat.service.ts`.
- [x] Found and fixed one bug during a self-review before typecheck: the empty-products state originally used `grid.replaceWith(emptyStateEl)`, which detaches the `grid` element from the DOM - a later `refresh()` call (e.g. right after adding the first product) would have silently written into a detached node and the UI would never update. Fixed by keeping `grid` as a permanent container and appending/clearing its contents instead of replacing the element itself.
- [x] `tsc --noEmit` clean.

## Note on image upload (server-mediated, not direct-to-Cloudinary)

The shared `apiFetch`/`executeRequest` helper in `utils/api.utils.ts` unconditionally sets `Content-Type: application/json` on every request, which would break a multipart file upload (the browser needs to set its own `Content-Type` with the form boundary). Rather than modify that shared helper - used by every other feature in the app - `uploadProductImage()` in the new `product.service.ts` uses a small dedicated raw `fetch()` call with `FormData`, reusing `getAccessToken()` for the auth header. Everything else (list/create/update/delete/stock) goes through the normal `apiGet`/`apiPost`/`apiPut`/`apiDelete` wrappers as usual.

---

## Notes as we build

(Running log of decisions/surprises found during implementation.)
