# Adler's Den — Product Intelligence Tool · Handover Document

**Last updated:** 2026-06-12
**Live tool:** https://part-a-v2.vercel.app ✅ (password-gated)
**Repository:** https://github.com/AdlersDen/adlers-den-intelligence (Public)
**Vercel project:** `part-a-v2` (linked — see `.vercel/project.json`)

---

## 1. What this is

An internal web tool for **competitive analysis of Adler's Den chocolate products**.

A user pastes a product URL (or concept) and the tool returns an AI-generated
intelligence report covering:

- **Pricing analysis** — how the product is priced vs. the market
- **Composition profiling** — ingredients / product type classification
- **Competitor benchmarking** — live competitor listings pulled from the web
- **Improvement recommendations** — actionable suggestions
- **Market gaps** — opportunities the analysis surfaces

It is gated behind a password (`APP_PASSWORD`) in production.

---

## 2. Current status (as of 2026-06-12)

| Item | Status |
|---|---|
| Source code | ✅ Pushed to GitHub (`main` branch) |
| Repository visibility | ⚠️ **Public** — contains an internal PRD `.docx`. Switch to Private if that's not intended. |
| Secrets | ✅ Safe — `.env`, `.env.local`, `.vercel/` are git-ignored and were **not** uploaded |
| Vercel project link | ✅ Exists (`part-a-v2`, Vite framework, Node 24.x) |
| **Production deployment** | ✅ **Live** at https://part-a-v2.vercel.app (serves the app, HTTP 200) |
| Production env vars on Vercel | ✅ Appears configured (the live site loads). Re-run `.\_deploy.ps1` after any key change. |

> **To redeploy / refresh keys:** log into Vercel (`npx vercel login`) and run the
> deploy script (Section 6).

---

## 3. Tech stack & architecture

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| Routing | SPA, client-side; `vercel.json` rewrites all non-`/api` paths to `index.html` |
| Backend | Vercel Serverless Functions in `/api/*.js` (max duration 60s) |
| AI — primary | **Groq** — Llama 3.3 70B |
| AI — fallback | **Google Gemini** 1.5 Flash (used automatically if Groq fails) |
| Competitor search | **SerpAPI** (Google Search results) |
| Competitor scraping | **Browserless** (headless browser for JS-rendered sites) |
| Product data | **WooCommerce REST API** (adlersden.com) |

> **Note:** The `README.md` mentions "Google Custom Search JSON API" for
> competitor search, but the actual code and deploy script use **SerpAPI**
> (`SERP_API_KEY`). Trust the code / `.env.example` over the README here.

---

## 4. The analysis pipeline

```
User pastes product URL
        ↓
POST /api/fetch-product        → Fetch product from WooCommerce (or mock data in local dev)
        ↓
POST /api/extract-composition  → Classify product type + extract composition (AI)
        ↓
POST /api/search-competitors   → Find live competitor listings (SerpAPI + Browserless)
        ↓
POST /api/analyse              → Generate the full multi-section intelligence report (AI)
        ↓
Report page rendered + saved to browser localStorage
```

Shared AI logic (Groq → Gemini cascade) lives in `api/_ai.js`.
Shared scraping logic lives in `api/_scrape.js`.

---

## 5. Environment variables

All keys live locally in `.env.local` (git-ignored). A template with instructions
is in `.env.example`. For production they must be set in the **Vercel dashboard**
(or pushed via `_deploy.ps1`).

| Variable | Required | Purpose / where to get it |
|---|---|---|
| `GROQ_API_KEY` | ✅ Strongly recommended | Primary AI — https://console.groq.com |
| `GEMINI_API_KEY` | ✅ Fallback AI | https://aistudio.google.com/app/apikey |
| `SERP_API_KEY` | Optional (recommended) | Competitor search — https://serpapi.com/manage-api-key |
| `BROWSERLESS_API_KEY` | Optional | Headless scraping — https://www.browserless.io |
| `WC_CONSUMER_KEY` | ✅ Required in prod | WooCommerce REST API key (Read-only) |
| `WC_CONSUMER_SECRET` | ✅ Required in prod | WooCommerce REST API secret |
| `APP_PASSWORD` | Production only | Password users enter to access the tool |
| `VITE_DEV_PASSWORD` | Local dev only | Local password fallback (default: `adlers2025`) |

**WooCommerce keys:** WordPress Admin → WooCommerce → Settings → Advanced →
REST API → Add key (Read permission is sufficient).

> ⚠️ **Known gap:** the `_deploy.ps1` script pushes only these 6 keys:
> `GROQ_API_KEY`, `GEMINI_API_KEY`, `SERP_API_KEY`, `BROWSERLESS_API_KEY`,
> `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`.
> It does **not** push `APP_PASSWORD`. If the production password gate isn't
> working, set `APP_PASSWORD` manually in **Vercel → Project Settings →
> Environment Variables**.

> **Local-dev behaviour:** if `WC_CONSUMER_KEY` is missing in local dev, the tool
> falls back to realistic mock product data. In production this fallback is disabled.

---

## 6. How to deploy (Vercel)

The repo includes a one-shot helper: **`_deploy.ps1`**.

```powershell
# From the project root, in PowerShell:
npx vercel login      # one-time: completes in the browser
.\_deploy.ps1         # pushes env vars to Production, then builds & deploys
```

What `_deploy.ps1` does:
1. Checks you're logged into Vercel (prompts login if not)
2. Reads the 6 API keys from `.env.local` and pushes them to Vercel **Production**
   (replacing existing values each run — harmless to re-run)
3. Builds and deploys to production, then prints the live URL

After it finishes, the production URL is printed in the terminal — that's the live tool.

**Manual alternative (Vercel dashboard):**
1. Import the GitHub repo at https://vercel.com
2. Set all env vars in Project Settings → Environment Variables
3. Deploy — `vercel.json` handles SPA routing + function timeouts automatically

---

## 7. Local development

```bash
git clone https://github.com/AdlersDen/adlers-den-intelligence.git
cd adlers-den-intelligence
npm install
cp .env.example .env.local   # then fill in your keys
npm run dev                  # http://localhost:5173
```

> ⚠️ Plain `npm run dev` runs the **frontend only** — the `/api/*` serverless
> functions are NOT available. To test the full pipeline (API routes) locally,
> use the Vercel CLI instead:
>
> ```bash
> npx vercel dev
> ```

Useful scripts (`package.json`):
- `npm run dev` — Vite dev server (frontend only)
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run typecheck` — type-check via jsconfig

---

## 8. Project structure

```
adlers-den-intelligence/
├── api/                        # Vercel serverless functions
│   ├── _ai.js                  # Shared AI utility (Groq → Gemini cascade)
│   ├── _scrape.js              # Shared scraping helper (Browserless)
│   ├── fetch-product.js        # Step 1: fetch product from WooCommerce
│   ├── extract-composition.js  # Step 2: classify + extract composition
│   ├── search-competitors.js   # Step 3: SerpAPI competitor search
│   └── analyse.js              # Step 4: comparative intelligence report
├── src/
│   ├── App.jsx
│   ├── lib/analysisService.js  # Frontend API orchestrator
│   ├── pages/
│   │   ├── Dashboard.jsx        # URL input + analysis trigger
│   │   └── Report.jsx           # Full report display
│   └── components/
│       ├── analysis/            # URLInput, ConceptInput, AnalysisProgress
│       ├── layout/              # AppLayout, Sidebar
│       └── report/              # ExecutiveSummary, Pricing, Composition,
│                                #   Improvements, MarketGaps sections
├── entities/Analysis.db         # Small schema/seed file
├── _deploy.ps1                  # One-shot Vercel deploy helper
├── _local-server.mjs            # Local API server for testing
├── _pipeline.mjs                # Local end-to-end pipeline smoke test
├── .env.example                 # Env var template
├── vercel.json                  # SPA rewrite + 60s function timeout
└── DEPLOYMENT.md                # Additional deploy notes
```

---

## 9. Accounts / access needed to operate this

The next owner will need access to (or fresh keys for):

- **GitHub** — `AdlersDen` org, `adlers-den-intelligence` repo
- **Vercel** — the team that owns project `part-a-v2`
  (orgId `team_vE63hC6zIKL4kd8uEW6wmznZ`)
- **Groq** account (primary AI key)
- **Google AI Studio** (Gemini fallback key)
- **SerpAPI** account (competitor search)
- **Browserless** account (scraping)
- **WooCommerce / WordPress admin** on adlersden.com (to issue REST API keys)

> The actual key *values* are in `.env.local` on the current developer's machine —
> they are **not** in the repo. Make sure these are handed over securely
> (password manager / encrypted channel), not committed to git.

---

## 10. Known issues & open items

1. **`APP_PASSWORD` not pushed by the deploy script** — set it manually in Vercel
   if the production password gate fails (Section 5).
2. **Repo is public** — it contains the internal PRD (`Adlers_Den_Product_Intelligence_PRD.docx`).
   Switch to Private (Settings → Danger Zone) if that document shouldn't be public.
3. **README vs. code mismatch** — README says Google Custom Search; the code uses
   SerpAPI. Worth updating the README to avoid confusion.
4. **Set the repo "Website" field** — point it at https://part-a-v2.vercel.app
   so the live tool is linked from GitHub.

---

## 11. Quick-start checklist for the new owner

- [ ] Get access to the GitHub repo and Vercel project
- [ ] Receive the `.env.local` key values securely
- [ ] `git clone` + `npm install`
- [ ] Copy keys into `.env.local`
- [ ] `npx vercel dev` to confirm the full pipeline works locally
- [ ] Confirm you can access the live tool at https://part-a-v2.vercel.app
- [ ] `npx vercel login` → `.\_deploy.ps1` to redeploy / refresh keys when needed
- [ ] Set `APP_PASSWORD` in Vercel if the password gate fails
- [ ] Decide on repo visibility (Public vs. Private)
```
