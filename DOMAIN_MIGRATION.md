# Domain Migration Guide — Adler's Den Product Intelligence Tool

**Audience:** Project Manager / next developer
**Scenario covered:** What happens to this tool if the company changes the domain of its store website (currently `adlersden.com`), and exactly what must be changed in the background.
**Last verified against the codebase:** 3 July 2026

---

## 1. Executive summary

The intelligence tool is **hard-wired to `adlersden.com` in 6 places** (4 code locations + 2 user-facing text locations). If the store's domain changes and nothing is updated:

- ❌ **Every product analysis will fail or silently use stale data** — the tool will keep calling the old domain's WooCommerce API and product pages.
- ❌ **The URL input box will reject the new domain** — users cannot even paste a new-domain product URL.
- ⚠️ **Adler's Den's own products may appear as "competitors"** in reports, because the self-exclusion filter only knows the old domain.

**Effort to fix: roughly 30 minutes of developer time + one redeploy.** No data is lost; no third-party accounts (Groq, Gemini, SerpAPI, Browserless) are affected — only the WooCommerce connection and the domain strings.

| Impact area | Breaks on domain change? | Fix effort |
|---|---|---|
| Product fetching (WooCommerce API) | ❌ Yes — immediately | 1 line + possibly new API keys |
| Product page scraping (fallback layers) | ❌ Yes | 1 line |
| URL input validation (frontend) | ❌ Yes — blocks users at the door | 3 lines |
| Competitor self-exclusion | ⚠️ Silently degrades | 1 line |
| Error-message wording | Cosmetic | 2 lines |
| AI providers, competitor search, reports UI | ✅ Unaffected | none |

---

## 2. How the tool uses the domain today

The domain appears at every stage of the "existing product" analysis flow:

```
User pastes URL ──► URLInput.jsx validates it contains "adlersden.com"
        │
        ▼
/api/fetch-product extracts the product slug, then tries 3 layers:
   Layer 1: WooCommerce REST API  ── https://adlersden.com/wp-json/wc/v3
   Layer 2: Browserless render    ── https://adlersden.com/product/<slug>/
   Layer 3: Plain HTTP + AI       ── https://adlersden.com/product/<slug>/
        │
        ▼
/api/search-competitors drops any Google result whose link
contains "adlersden.com" (so the store's own products are never
listed as their own competitors)
```

Concept-product analyses (text brief / structured form) do **not** touch the store domain at all — they would keep working unchanged.

---

## 3. Scenario A — Same store, new domain (most likely case)

*Example: the WordPress/WooCommerce site is migrated from `adlersden.com` to `adlersden.in` or a rebranded domain. Same products, same WordPress install.*

### 3.1 Code changes (6 edits, all string replacements)

| # | File & line | Current value | Change to |
|---|---|---|---|
| 1 | `api/fetch-product.js:13` | `const WC_BASE = 'https://adlersden.com/wp-json/wc/v3'` | new domain |
| 2 | `api/fetch-product.js:14` | `const PRODUCT_BASE = 'https://adlersden.com/product'` | new domain |
| 3 | `api/fetch-product.js:188` | error text "…an adlersden.com/product/... URL" | new domain (cosmetic) |
| 4 | `src/components/analysis/URLInput.jsx:16` | `if (!value.includes('adlersden.com')) …` | new domain — **this is the gate that blocks users** |
| 5 | `src/components/analysis/URLInput.jsx:17 & 74` | validation hint + placeholder example URL | new domain (user-facing text) |
| 6 | `api/search-competitors.js:441` | `.filter(item => !item.link.includes('adlersden.com'))` | **keep the old domain AND add the new one** (see §3.4) |

Also update the documentation files that mention the domain: `README.md`, `HANDOVER.md`, `DEPLOYMENT.md` (references only — nothing functional).

### 3.2 WooCommerce API keys — check, possibly regenerate

The tool authenticates to WooCommerce with `WC_CONSUMER_KEY` / `WC_CONSUMER_SECRET` (stored in Vercel → Project Settings → Environment Variables).

- If the migration keeps the **same WordPress database**, the existing keys usually keep working — they live in the database, not the domain.
- If the store is **re-installed or re-platformed**, generate new keys: *WP Admin → WooCommerce → Settings → Advanced → REST API → Add key (Read permission)* and update both values in Vercel.
- **The new domain must serve valid HTTPS.** The API call sends credentials over the connection; an invalid certificate will make every fetch fail.

### 3.3 ⚠️ The redirect trap (important, non-obvious)

If the old domain is kept alive as a **301 redirect** to the new domain, the tool will *appear* to half-work but Layer 1 will break in a confusing way:

> Node.js `fetch` **strips the `Authorization` header when following a redirect to a different domain** (a security feature). So calls to `old-domain/wp-json/...` will redirect to the new domain *without credentials* and fail with **401 Unauthorized** — even though the keys are correct.

**Lesson:** do not rely on redirects to avoid the code change. The `WC_BASE` constant must point directly at the new domain.

### 3.4 The self-exclusion filter — add, don't replace

`api/search-competitors.js:441` exists so Adler's Den's own catalog never shows up as its own "competition." After a migration:

- Google will index the **new** domain — so the filter must include it, or reports will recommend "competing" against Adler's Den itself.
- Google may keep returning **old**-domain results for weeks — so keep the old domain in the filter too during the transition:

```js
.filter(item => !item.link.includes('adlersden.com') && !item.link.includes('NEW-DOMAIN.com'))
```

### 3.5 Deploy

The project auto-deploys from GitHub (`AdlersDen/adlers-den-intelligence`, `main` branch → Vercel project `part-a-v2`):

1. Make the edits above, commit, push to `main`
2. Vercel builds and deploys automatically (~1 minute)
3. If env keys changed, update them in Vercel **before** the deploy, or trigger a redeploy after saving them (env changes do not redeploy automatically)

### 3.6 Verification checklist (10 minutes)

- [ ] Paste a new-domain product URL into the tool — the input accepts it
- [ ] Run a full analysis on a **variable-priced** product — report loads, price shows a range (e.g. "₹275 – ₹428"), per-gram value is a sane single-digit number
- [ ] Check the report's `_source` (Export JSON → `product data`) says `woocommerce` — confirms Layer 1 works, not just the scraper fallbacks
- [ ] Run a **hamper** URL — classified as hamper, per-item pricing shown
- [ ] Confirm no Adler's Den products appear in the competitor list
- [ ] Run one **concept** analysis — should be unaffected (control test)

### 3.7 Side effects that need no action (but are worth knowing)

- **Old saved reports** (browser localStorage) keep their old-domain product links and image URLs. If the old domain is fully shut down, thumbnails in *old* reports stop loading. New analyses are unaffected. No fix needed — the data expires naturally as the 20-report cap rotates.
- **Permalink structure matters more than domain:** the slug extractor accepts `/product/`, `/products/`, and `/shop/` paths. If the new site also changes its permalink pattern (e.g. `/item/<slug>`), update the regex in `api/fetch-product.js:22` as well.

---

## 4. Scenario B — New store platform (bigger change)

*Example: moving off WordPress/WooCommerce entirely (to Shopify, a custom store, etc.).*

Everything in Scenario A applies, **plus** Layer 1 of `api/fetch-product.js` must be rewritten for the new platform's API:

- **Shopify:** replace the WooCommerce call with Shopify's product API — conveniently, the codebase already contains working Shopify catalog readers in `api/_scrape.js` (`scrapeShopify`, `scrapeShopifyByHandle`) used for competitor brands; these can be adapted for the own-store fetch in ~1–2 hours.
- **Any platform:** Layers 2 and 3 (Browserless render, plain HTTP + AI extraction) are platform-agnostic and will keep working as fallbacks with only the `PRODUCT_BASE` change — so the tool degrades gracefully even before Layer 1 is rewritten.
- New API credentials will be needed either way; the env-variable names can be reused or renamed.

Estimated effort: **half a day** including testing.

---

## 5. Scenario C — Only the *tool's* URL changes

*Example: moving the tool itself from `part-a-v2.vercel.app` to `intel.adlersden.com`.*

**No code changes are required.** The frontend calls its API with relative paths (`/api/...`), so the tool is domain-agnostic about itself. Steps:

1. Vercel → Project `part-a-v2` → Settings → Domains → add the custom domain
2. Add the DNS record Vercel shows (CNAME) at the domain registrar
3. Update the bookmark/links shared with the team, and the repo's Website field

---

## 6. Recommended hardening (optional, ~20 minutes)

To make any *future* domain change a **configuration change instead of a code change**, move the domain into an environment variable:

```js
// api/fetch-product.js
const STORE_DOMAIN = process.env.STORE_DOMAIN || 'adlersden.com';
const WC_BASE      = `https://${STORE_DOMAIN}/wp-json/wc/v3`;
const PRODUCT_BASE = `https://${STORE_DOMAIN}/product`;
```

…and read the same variable in the URL validator and the competitor self-exclusion filter (the frontend would use a `VITE_STORE_DOMAIN` build-time variable). After this refactor, a domain change becomes: *update one env var in Vercel → redeploy → done.* This was not implemented in the submitted version to keep the audited code stable, but it is the first improvement the next maintainer should consider.

---

## 7. Quick-reference card

**If the store domain changes tomorrow, do this:**

1. Edit the 6 locations in §3.1 (old domain → new; filter gets *both*)
2. Verify HTTPS is valid on the new domain
3. Test WooCommerce keys; regenerate in WP Admin if 401
4. Update keys in Vercel env vars if changed
5. `git push` → auto-deploys
6. Run the §3.6 checklist
7. Do **not** rely on 301 redirects — the API auth header does not survive them

*Total effort: ~30 min (same store) · ~half a day (new platform) · 0 min of user-data migration (reports live in each user's browser).*
