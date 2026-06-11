# Adler's Den — Product Intelligence Tool

An internal tool for competitive analysis of Adler's Den chocolate products.
Paste a product URL → get AI-powered pricing analysis, composition profiling, competitor benchmarking, and improvement recommendations.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| API Routes | Vercel Serverless Functions (`/api/*.js`) |
| AI (Primary) | Groq — Llama 3.3 70B |
| AI (Fallback) | Google Gemini 1.5 Flash |
| Competitor Search | Google Custom Search JSON API |
| Competitor Scrape | Browserless (for JS-rendered sites) |
| Product Data | WooCommerce REST API (adlersden.com) |

---

## Local Development

### 1. Clone the repository

```bash
git clone <repo-url>
cd "Part A v2"
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ Strongly recommended | Primary AI — [console.groq.com](https://console.groq.com) |
| `GEMINI_API_KEY` | ✅ Fallback AI | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| `GOOGLE_SEARCH_API_KEY` | Optional | Competitor search — [Google Cloud Console](https://console.cloud.google.com) |
| `GOOGLE_SEARCH_ENGINE_ID` | Optional | Programmable Search Engine ID |
| `BROWSERLESS_API_KEY` | Optional | Headless scraper — [browserless.io](https://www.browserless.io) |
| `WC_CONSUMER_KEY` | ✅ Required in Prod | WooCommerce REST API key (read-only) |
| `WC_CONSUMER_SECRET` | ✅ Required in Prod | WooCommerce REST API secret |
| `APP_PASSWORD` | Production only | Password gate for the deployed tool |
| `VITE_DEV_PASSWORD` | Local dev only | Local password fallback (default: `adlers2025`) |

> **Note:** In local development (`NODE_ENV !== 'production'`), if `WC_CONSUMER_KEY` is missing, the tool falls back to realistic mock product data. In production, the mock fallback is disabled.

### 4. Run the development server

```bash
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173).

> **API routes in local dev:** Vercel serverless functions (`/api/*`) are **not** available when running plain `npm run dev`. To test API routes locally, use the [Vercel CLI](https://vercel.com/docs/cli): `npx vercel dev`.

---

## Analysis Pipeline

```
User pastes product URL
       ↓
POST /api/fetch-product     → Fetch product from WooCommerce (or mock)
       ↓
POST /api/extract-composition → Classify type + extract composition (AI)
       ↓
POST /api/search-competitors  → Google Custom Search for live competitor data
       ↓
POST /api/analyse             → Generate full 4-section intelligence report (AI)
       ↓
Report page rendered + saved to localStorage
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in [Vercel Dashboard](https://vercel.com)
3. Set all environment variables in **Project Settings → Environment Variables**
4. Deploy — `vercel.json` handles SPA routing and function timeouts automatically

---

## WooCommerce Integration

**To generate keys:** WordPress Admin → WooCommerce → Settings → Advanced → REST API → Add key (Read permission is sufficient).

Once keys are set in Vercel environment variables, the tool will fetch live product data. The mock data fallback is strictly disabled in production environments.

---

## Project Structure

```
Part A v2/
├── api/                    # Vercel serverless functions
│   ├── _ai.js              # Shared AI utility (Groq → Gemini cascade)
│   ├── fetch-product.js    # D1: Fetch product from WooCommerce
│   ├── extract-composition.js  # D2: Classify + extract composition
│   ├── search-competitors.js   # D3: Google Custom Search
│   ├── analyse.js          # D4: Comparative intelligence report
│   └── auth-check.js       # Password gate verification
├── src/
│   ├── lib/
│   │   └── analysisService.js  # Frontend API orchestrator
│   ├── pages/
│   │   ├── Dashboard.jsx   # URL input + analysis trigger
│   │   └── Report.jsx      # Full report display
│   └── components/
│       ├── PasswordGate.jsx
│       ├── analysis/       # URLInput, AnalysisProgress
│       └── report/         # Report section components
├── .env.example            # Template for all required env vars
└── vercel.json             # SPA rewrite + function timeout config
```
