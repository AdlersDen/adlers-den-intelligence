# Adler's Den — Product Intelligence Tool · Handover Document

**Last updated:** 3 July 2026
**Live tool:** https://part-a-v2.vercel.app ✅ (⚠️ currently OPEN — no auth, see §11)
**Repository:** https://github.com/AdlersDen/adlers-den-intelligence (Public)
**Vercel project:** `part-a-v2`, linked to the GitHub repo — **every push to `main` auto-deploys to production** (~1 minute)

---

## 1. What this is

An internal web tool for **competitive analysis of Adler's Den products** (chocolates, flavoured nuts & dried fruits, and gift hampers).

A user provides one of three inputs and receives an AI-generated intelligence report:

| Input mode | What the user provides | Typical use |
|---|---|---|
| **Product URL** | An `adlersden.com/product/...` link | Analyse a live SKU |
| **Concept — text brief** | A paragraph describing an unlaunched product | Validate a new idea |
| **Concept — structured form** | Name, price, format, cocoa %, weight, ingredients, occasion | Validate a fully specified single product (hampers: use the text brief — the form is single-product by design) |

Every report contains: executive summary · pricing verdict with per-gram (single products) or per-item (hampers) math · composition profile with a data-completeness score and an expandable list of missing fields · composition quality rating · recommended improvements anchored to named competitors · market gaps · the live competitor list with links and prices.

> ⚠️ **No access control is currently implemented.** The README and `.env.example`
> describe a password gate (`APP_PASSWORD` / `PasswordGate` / `/api/auth-check`),
> but none of that exists in the code — the app opens straight to the Dashboard.
> The live tool and its API routes are publicly accessible. See §11.

---

## 2. Current status (verified 3 July 2026)

| Item | Status |
|---|---|
| Source code | ✅ On GitHub, `main` branch |
| Repository visibility | ⚠️ **Public** — contains the internal PRD `.docx`. Switch to Private if unintended. |
| Secrets | ✅ Safe — `.env`, `.env.local`, `.vercel/` are git-ignored, never uploaded |
| CI/CD | ✅ GitHub → Vercel auto-deploy on push to `main` |
| **Production deployment** | ✅ **Live** at https://part-a-v2.vercel.app |
| Production env vars | ✅ All 6 keys working (verified end-to-end on production) |
| End-to-end testing | ✅ Full matrix passed on production, 3 July 2026 (see §8) |
| Access control | ❌ None — open to anyone with the URL |

---

## 3. Tech stack & architecture

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui (SPA; `vercel.json` rewrites non-`/api` paths to `index.html`) |
| Backend | Vercel Serverless Functions in `/api/*.js` (60s max duration) |
| AI — primary | **Groq** — Llama 3.3 70B |
| AI — fallback | **Google Gemini** 1.5 Flash (automatic cascade in `api/_ai.js`) |
| Competitor search | **SerpAPI** — Google organic (site-scoped brand tiers) + Google Shopping |
| Competitor catalogs | Direct Shopify catalog reads for ~20 Indian craft-chocolate & snack brands |
| Competitor scraping | **Browserless** (headless render for JS-heavy pages) + plain-HTTP fallback |
| Product data | **WooCommerce REST API** (adlersden.com) with Browserless/HTTP fallback layers |
| Report storage | Browser localStorage (per-user, capped at 20 reports, Export/Import JSON supported) |

> **README caveat:** the README mentions "Google Custom Search" — the code
> actually uses **SerpAPI** (`SERP_API_KEY`). Trust the code / `.env.example`.

### The analysis pipeline

```
User input (URL or concept)
        ↓
POST /api/fetch-product          (URL flow only) WooCommerce → Browserless → HTTP+AI waterfall
        ↓
POST /api/extract-composition    Classify hamper vs single + extract composition (AI),
                                 cross-validate dietary claims, backfill from raw text,
                                 score data completeness incl. missing-field names
        ↓
POST /api/search-competitors     Product-class routing (chocolate vs snack pools),
                                 Shopify catalogs + SerpAPI tiers + Google Shopping in parallel,
                                 occasion detection, relevance scoring & re-rank,
                                 junk filters (condiments, non-food, tag-list descriptions),
                                 hamper item-count estimation + wider-market slots
        ↓
POST /api/analyse                Full report (AI) with server-computed per-gram / per-item
                                 math, sanity ceilings, citation rules, text post-processing
        ↓
Report rendered + saved to localStorage
```

---

## 4. Environment variables

Local values live in `.env.local` (git-ignored); template with instructions in `.env.example`. Production values live in **Vercel → Project Settings → Environment Variables**.

| Variable | Required | Purpose / where to get it |
|---|---|---|
| `GROQ_API_KEY` | ✅ | Primary AI — https://console.groq.com |
| `GEMINI_API_KEY` | ✅ | Fallback AI — https://aistudio.google.com/app/apikey |
| `SERP_API_KEY` | ✅ recommended | Competitor search — https://serpapi.com/manage-api-key |
| `BROWSERLESS_API_KEY` | Optional | Headless scraping — https://www.browserless.io |
| `WC_CONSUMER_KEY` | ✅ in prod | WooCommerce REST key (Read-only) — WP Admin → WooCommerce → Settings → Advanced → REST API |
| `WC_CONSUMER_SECRET` | ✅ in prod | WooCommerce REST secret |
| `APP_PASSWORD` | ❌ Not wired up | Described in `.env.example` but **unused** by current code |
| `VITE_DEV_PASSWORD` | ❌ Not wired up | Described in `.env.example` but **unused** by current code |

The helper script `_deploy.ps1` pushes the 6 real keys from `.env.local` to Vercel Production and deploys — all verified working in production. Note: **changing an env var in Vercel does not redeploy automatically**; push a commit or trigger a redeploy after saving.

---

## 5. How to deploy

**Normal flow (recommended):** commit → `git push origin main` → Vercel builds and deploys automatically (~1 min). Nothing else to do.

**Manual/CLI flow:** `npx vercel login` once, then `.\_deploy.ps1` (refreshes the 6 env keys and deploys) — mainly useful when rotating API keys.

---

## 6. Local development

```bash
git clone https://github.com/AdlersDen/adlers-den-intelligence.git
cd adlers-den-intelligence
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:5173 — FRONTEND ONLY
```

> ⚠️ Plain `npm run dev` does **not** serve the `/api/*` functions. To run the
> full pipeline locally use `npx vercel dev`, or `node _local-server.mjs`.

Useful scripts: `npm run build` · `npm run lint` / `lint:fix` · `npm run typecheck` · `node _pipeline.mjs <product-url>` — end-to-end smoke test that prints each step's output (set `BASE=https://part-a-v2.vercel.app` to run it against production).

---

## 7. Project structure

```
adlers-den-intelligence/
├── api/                        # Vercel serverless functions
│   ├── _ai.js                  # Shared AI utility (Groq → Gemini cascade)
│   ├── _scrape.js              # Scraping helpers (Shopify catalogs, Browserless, plain HTTP)
│   ├── fetch-product.js        # Step 1: 3-layer product fetch (WooCommerce → Browserless → HTTP+AI)
│   ├── extract-composition.js  # Step 2: classify + extract + completeness scoring
│   ├── search-competitors.js   # Step 3: multi-source competitor search + filters + ranking
│   └── analyse.js              # Step 4: report generation + server-side pricing math
├── src/
│   ├── lib/analysisService.js  # Frontend orchestrator (URL flow + both concept flows)
│   ├── pages/Dashboard.jsx     # Input UI + progress   ·  pages/Report.jsx — report display
│   └── components/
│       ├── analysis/           # URLInput, ConceptInput, AnalysisProgress
│       └── report/             # Report sections (CompositionProfile, CompetitorTable, …)
├── _pipeline.mjs               # CLI end-to-end smoke test
├── _local-server.mjs           # Minimal local API server
├── _deploy.ps1                 # CLI deploy + env-var push helper
├── DOMAIN_MIGRATION.md         # What to change if the store's domain changes
├── DEPLOYMENT.md · README.md · HANDOVER.md (this file)
└── vercel.json                 # SPA rewrite + 60s function timeout
```

---

## 8. Testing performed (all on production, 2–3 July 2026)

Every flow was exercised end-to-end against the live deployment, both via scripted API runs (28/28 automated checks passed) and manually through the UI with screenshot review:

| Flow | Test case | Result |
|---|---|---|
| URL — chocolate, variable price | Almond Rochers, Intense Orange Barks, Chocolate Coated Almonds, Rocky Road Bites | ✅ per-gram exact (e.g. ₹4.61/g = 323÷70) |
| URL — snack | Chilli Guava | ✅ snack routing, condiment filter, real dried-guava comparators |
| URL — hamper | Grand Christmas Gift Hamper (₹3,380, 13 items) | ✅ hamper classification, ₹260/item math, chocolate-hamper comparators + wider-market slots |
| Concept — text brief | Pistachio Kunafa Clusters · Filter Coffee Bar (12/12 extraction) | ✅ incl. direct "Dubai chocolate" competitors found |
| Concept — structured | Hazelnut Praline Rochers · Paan Gulkand White Truffles | ✅ white-chocolate dietary guard, Diwali occasion banner |
| Honest-failure paths | Occasion mismatch banners, missing-fields dropdown, empty-description store products | ✅ fail loudly, never invent data |

**Verification style used throughout:** every AI-quoted number was recomputed by hand (pack price ÷ grams, price ÷ item count, premium percentages) — the server computes these and feeds them to the model, so they are deterministic.

---

## 9. Fixes & features shipped during final testing (2–3 July)

The next maintainer should know these exist — they encode hard-won lessons:

1. **Price-range parsing bug (critical):** variable products ("₹275 – ₹428") had all digits concatenated → ₹3,934/g instead of ₹3.93/g, corrupting every pricing verdict. Now parses the range floor; plus a **₹100/g sanity ceiling** so a bad parse can never reach the model or UI again. (`api/analyse.js`)
2. **Hamper misrouting:** chocolate hampers categorised e.g. "Christmas Gifts" fell into the *snack* brand pool (hamper compositions carry `chocolate_types_present`, not `chocolate_type`) and were compared to millet snacks. Fixed in `detectProductClass`. (`api/search-competitors.js`)
3. **Hamper per-item honesty:** item counts are now estimated for *all* comparators (a "Pack of 20" was previously priced as one item).
4. **Wider-market slots (hampers):** one extra unscoped Google Shopping query (occasion-aware, e.g. "christmas gift hamper india"); top 6 slots stay craft-chocolate comparators, last 2 carry an amber "wider gifting market" badge and are prompt-flagged as price context only.
5. **Junk filters:** condiments (pickles/chutney/podi) excluded for snack searches; non-food scent products (air fresheners, candles) excluded everywhere; Shopify tag-list "descriptions" (`bogo-offer, city-bangalore…`) stripped.
6. **Missing-fields dropdown:** `data_completeness.missing` names every unextracted field; both the limited-data banner and the "X/12 fields extracted" caption expand to list them.
7. **Citation hardening:** the analyst must quote competitor product names verbatim (was embellishing names); rupee decimal artefacts ("₹4. 99/g") joined deterministically; "Belgian/Swiss chocolate" now recognised as `origin_country`.
8. **UI polish:** pack chips no longer show a stray separator dot; ingredient chips lowercased; occasion-banner wording made product-type-neutral.

Full detail is in the git history — commit messages are written to explain *why*.

---

## 10. Accounts / access needed to operate this

- **GitHub** — `AdlersDen` org, `adlers-den-intelligence` repo (pushes to `main` deploy to production!)
- **Vercel** — team owning project `part-a-v2` (env vars, domains, deploy logs)
- **Groq**, **Google AI Studio** (Gemini), **SerpAPI**, **Browserless** accounts (key rotation)
- **WordPress admin** on adlersden.com (WooCommerce REST keys)

Key *values* are in `.env.local` on the current developer's machine and in Vercel env settings — **not** in the repo. Hand them over via a password manager, never git.

---

## 11. Known issues & limitations (current, honest list)

1. **🔓 No access control (highest priority).** The app and all `/api/*` routes are publicly reachable. Anyone with the URL can run analyses, consuming Groq/SerpAPI/Browserless credits. Quickest fix: Vercel **Deployment Protection** (Project → Settings) — no code needed. Proper fix: implement the password gate the README describes.
2. **Repo is public** and contains the internal PRD `.docx`. Switch to Private if that matters.
3. **README drift:** README still says Google Custom Search + password gate; reality is SerpAPI + no gate.
4. **Store data quality:** `big-hamper` and both sugar-free hampers on adlersden.com have **empty descriptions and a ₹106 price** — the tool correctly refuses to analyse them (honest failure), but the store data itself should be fixed.
5. **Structured concept form is single-product only** (no items field; classification hardcoded). Hamper concepts must use the text brief — the AI classifies them correctly.
6. **Scope boundary:** competitor data covers chocolate & snack brand pools only. A concept hamper that is *mostly* non-chocolate (wine, cushions) would silently route to the snack pool with poor comparators — a "mostly non-chocolate hamper" warning banner is the suggested future fix.
7. **Snack completeness scores read low by design:** 7 of the 12 scored fields are chocolate-specific, so snacks realistically cap around 5/12. The missing-fields dropdown makes this transparent.
8. **LLM phrasing varies between runs** (temperature 0.2). Numbers, verdict inputs, competitor sets, and math are server-computed and deterministic; the prose is not.
9. **Search latency varies** — the competitor step is usually ~8s but occasionally ~30s when SerpAPI is slow (frontend timeout is 90s, so it never hangs).

---

## 12. Related documents

- **`DOMAIN_MIGRATION.md`** — exactly what to change (6 code locations, key handling, redirect trap) if the store's domain ever changes
- **`PROJECT_REPORT.md` / `.pdf`** — the academic project report
- **`DEPLOYMENT.md`** — original deploy notes · **`README.md`** — setup & stack (with the drift noted in §11.3)

---

## 13. Quick-start checklist for the new owner

- [ ] Get access to the GitHub repo and Vercel project
- [ ] Receive the `.env.local` key values securely
- [ ] `git clone` + `npm install` + copy keys into `.env.local`
- [ ] `npx vercel dev` — run one URL analysis and one concept analysis locally
- [ ] Confirm the live tool works: https://part-a-v2.vercel.app (try a product URL end-to-end)
- [ ] **Decide how to protect access** — the tool is currently open (§11.1)
- [ ] Decide repo visibility (Public vs Private)
- [ ] Read `DOMAIN_MIGRATION.md` before any domain/store change
- [ ] Remember: **pushing to `main` deploys to production** — use branches for experiments
