# SEO Audit & Action Plan

**Audited:** 2026-07-12, against the live site (`https://formachat.com` / `https://www.formachat.com`), not just local source — confirmed the deployed version matches what's in the repo.

## What's already good (don't undo this)

- Meta description, `og:*`, `twitter:*` tags, and a `canonical` link all exist and are actually being served in production.
- A JSON-LD `Organization` schema block is present.
- A hidden static fallback section (`.seo-hidden`) gives crawlers real text content — headline, feature list, "how it works," benefits — instead of an empty `<div id="app">`. Confirmed via direct fetch: this content **is** what a basic crawler sees.
- `robots.txt`, `sitemap.xml`, `manifest.json`, and a Google Search Console verification file (`google905ebc468f54ec1d.html`) all exist and resolve live (200 OK).
- Favicon/apple-touch-icon/theme-color are set.
- Brand assets (logo, olive palette, the new banner) are consistent and reasonably polished.

This is a better starting point than most early-stage SaaS sites — someone clearly did a first SEO pass already. The issues below are refinements and one structural limitation, not "starting from zero."

---

## Critical: the structural issue (read this first)

**The app uses hash-based routing (`#/login`, `#/dashboard`, etc.), which means there is exactly one real, crawlable URL: `https://www.formachat.com/`.** Everything after the `#` is invisible to the server and to almost every crawler that matters for SEO/social purposes — the fragment is never sent in the HTTP request. Confirmed live:

- `document.title` is never updated anywhere in the frontend — every route shows the identical browser tab title.
- `index.html`'s meta tags (title, description, `og:*`, `twitter:*`) are static and identical no matter which page is requested.
- Social platforms (Facebook, LinkedIn, Twitter/X, Slack, iMessage, WhatsApp) read `og:*` tags from the **raw HTML response** and do **not** execute JavaScript to see route-specific content. So: **right now, every single link you share — homepage, `/#/register`, a specific business's chat page, anything — produces the exact same social card**: title "FormaChat - AI-Powered Customer Support for Your Business," the same description, the same image. There is no way to make a link to `/#/register` show different preview text than the homepage without a bigger architectural change.
- Google *can* execute JavaScript when crawling and, in principle, can index hash-fragment routes if it renders them directly — but it won't get distinct titles/descriptions per route either way (see above), and relying on Googlebot's JS rendering budget is much less reliable than real HTML per page.

This isn't something to "fix" with a meta tag — it's a consequence of the routing architecture. Two honest paths forward, one already done:

- [x] **Cheap, partial fix — done.** `document.title` now updates per route (`router.ts`, every `route()`/`protectedRoute()` call now takes a title). Helps browser tabs, bookmarks, and history. Does **not** fix social card previews — those still need the raw HTML to differ, see below.
- [ ] **Real fix, bigger scope — not started, needs your call.** Move the public-facing pages (home, login, register, and eventually a per-business `/chat/:businessId` page) off hash routing onto real paths with either server-side rendering or a build-time prerender step (e.g. `vite-plugin-ssr`, `prerender-spa-plugin`, or a tiny custom prerender script that snapshots each public route to its own `index.html` with route-specific meta tags). Dashboard/authenticated routes can stay exactly as they are — there's no SEO reason to touch those. Worth doing eventually (especially once you want businesses' individual chat pages to be shareable with their own preview card), but it's a real scoping decision, not a quick patch — flagging it rather than starting it unprompted.

---

## Fix now (small, safe, no architecture decisions needed)

- [ ] **`formachat.com` → `www.formachat.com` redirect is a 307, should be 301. Still outstanding — this is the one item here I can't fix from the repo.** Confirmed live via `curl`: the apex domain temporary-redirects instead of permanently redirecting. Search engines treat 307 as "this might change back" and may keep crawling/indexing the apex version separately instead of fully consolidating ranking signal onto `www`. This is a Vercel config change (redirects in `vercel.json`, which doesn't exist in this repo, or the Vercel dashboard's Domains settings) — needs your Vercel account access, not app code.
- [x] **Hidden `<h1>` mismatch — fixed.** Rather than just editing the hidden text to match, `main.ts` now removes the static `<h1>` + `.seo-hidden` fallback block from the DOM the moment the JS app takes over (`removeStaticSeoFallback()`, called at the top of `initApp()`). A no-JS crawler still sees the full fallback content in the raw HTML response (that audience is unaffected); a JS-rendering crawler now sees only the real, visible page — no hidden/visible mismatch left in the post-render DOM at all.
- [x] **`sitemap.xml` trimmed to the one real URL** (`https://www.formachat.com/`) — the `#/login`/`#/register`/`#/verify-email` entries were removed since fragment URLs don't function as distinct sitemap entries.
- [x] **`robots.txt` simplified** to `Allow: /` + sitemap reference — the non-functional `Disallow` rules for hash routes are gone.
- [x] **New 1200×630 `og-image.png` built and wired in.** Composited from the banner you added (`formachat-banner.png`): logo + wordmark + leaf pattern on a pure white background, no visible crop/pad seam. `index.html`'s `og:image`/`twitter:image` now point at it, plus added `og:image:width`/`og:image:height` (a nice-to-have that helps some platforms render the preview faster). Went with logo-only rather than adding a tagline in text, since I can't preview/iterate on custom typography reliably without a design tool — happy to add a tagline version if you want to see one.
- [x] **Filename space fixed** — `formachat banner.png` → `formachat-banner.png`.
- [x] **`PRODUCTION_APP_URL` now points at `www.formachat.com`**, matching the canonical domain, so widget/share links the app generates don't cost users an extra redirect hop.
- [x] **Bonus: deleted the old `formachat.png`** (3.8MB, unused once `og-image.png` replaced it as the OG image) — everything in `public/` ships to production regardless of whether it's linked, so dead weight there is pure bloat, not just clutter.

---

## Worth knowing about, not urgent

- [ ] **`/chat/:businessId` (each business's public chat page) has no route-specific SEO at all** — same generic homepage card as everything else. Once the routing/prerendering work above happens, this is the page that benefits most: a business owner sharing their own chat link should see *their* business name and description in the preview, not "FormaChat - AI-Powered Customer Support." Worth keeping in mind as a reason to eventually do the bigger fix, not just a nice-to-have for the marketing site.
- [ ] **No `alt` text audit done yet** on images in the real (JS-rendered) pages — didn't check this pass, worth a quick look since it's cheap and helps both accessibility and image search.
- [ ] **No blog/content section** — not a bug, just noting that there's currently no organic-content acquisition surface (nothing wrong with that at this stage; flagging only because it's the next lever once the technical basics above are fixed).

---

## Answering your direct question: what does a shared link look like right now?

Today, sharing **any** FormaChat URL — the homepage, `/#/register`, anyone's chat link — produces the same card everywhere:

- **Title:** FormaChat - AI-Powered Customer Support
- **Description:** "FormaChat helps businesses automate customer support with AI chatbots trained on your data to answer questions 24/7, boost conversions, and delight customers."
- **Image:** the plain logo mark (`formachat.png`) — no tagline, no screenshot, roughly the right shape but not intentionally composed for a share card.

That's functional but generic. The single highest-leverage fix for "how does it look when shared" is the new 1200×630 image with the tagline baked in — that's a same-day fix. Making *different* links show *different* cards is the bigger routing/prerendering project above.
