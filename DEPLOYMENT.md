# Deployment — Adler's Den Product Intelligence

This tool ships as a Vercel project: a Vite React SPA in `src/`, plus four
serverless API routes in `api/`. There is no auth gate — the URL is the
gate. Rotate keys monthly.

## 1. Required environment variables

Set every one of these in the Vercel project dashboard
(*Settings → Environment Variables*, scope: Production + Preview):

| Var | What it does | Where to get a fresh key |
| --- | --- | --- |
| `GROQ_API_KEY`        | Primary LLM (Llama 3.3 70B). Fast + free tier.        | https://console.groq.com |
| `GEMINI_API_KEY`      | Fallback LLM when Groq rate-limits. **Model: `gemini-flash-latest`**, pinned in `api/_ai.js`. | https://aistudio.google.com/app/apikey |
| `SERP_API_KEY`        | SerpAPI — broader web competitor search beyond the 11-brand catalog. | https://serpapi.com/manage-api-key |
| `BROWSERLESS_API_KEY` | Headless Chrome for JS-rendered competitor pages.      | https://www.browserless.io/ |
| `WC_CONSUMER_KEY`     | WooCommerce REST API — fetches the Adler's Den product. | WP admin → WooCommerce → Settings → Advanced → REST API → Read-only key |
| `WC_CONSUMER_SECRET`  | Pair with `WC_CONSUMER_KEY`.                            | (same screen)                                            |

After setting all six, redeploy (`vercel --prod` or push a commit). The
tool degrades gracefully if `SERP_API_KEY` is absent (catalog-only) or if
`BROWSERLESS_API_KEY` is absent (plain-HTTP scrape only). All other vars
are required.

## 2. Free-tier quotas + upgrade path

| Provider | Free quota | What hits it most | Paid tier |
| --- | --- | --- | --- |
| Groq      | 30 req/min, 14,400 req/day on Llama-70B | extract + analyse calls (3 per product analysis) | https://console.groq.com/billing |
| Gemini    | ~15 req/min, 1500 req/day                | fallback when Groq throttles                      | https://aistudio.google.com → API key → Cloud project quota |
| SerpAPI   | 100 searches/month                       | 4 calls per analysis (one per source tier)        | https://serpapi.com/billing            |
| Browserless | 1000 sessions/month                    | competitor pages outside the 11 known brands       | https://www.browserless.io/pricing      |
| WooCommerce | unlimited (your own server)           | 1 call per analysis                                | n/a                                    |

**Rough usage:** ~30 analyses/day stays inside every free tier. Above
that, Groq + SerpAPI fall over first. Switching Groq to paid (~$0.50/M
tokens) is the cheapest first upgrade.

## 3. Key rotation procedure

Once a month (or immediately if a key is exposed):

1. Generate a new key at the provider console (links in table above).
2. Update the value in *Vercel → Settings → Environment Variables*.
3. Redeploy (or hit *Redeploy with current commit*).
4. Revoke the old key at the provider console.

### Gemini model name (important after Nov 2025)

Google **deprecated `gemini-1.5-flash` for new users** in Nov 2025. The code
now uses `gemini-flash-latest` and disables Gemini 2.5's "thinking" tokens
via `thinkingConfig: { thinkingBudget: 0 }` so the full output budget goes
to the response (otherwise the JSON gets truncated mid-document).

If a future deploy throws `HTTP 404: This model models/<name> is no longer
available`, swap the URL in `api/_ai.js` line 9 to any of the current
families: `gemini-flash-latest`, `gemini-2.5-flash-lite`,
`gemini-2.5-flash`. List the live models for your key with:

```
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
```

## 4. Cost guardrails baked in

- `api/search-competitors.js` caps SerpAPI at 4 tier calls + 1 broad-web
  fallback = max 5 calls per analysis. Logged as `serp_calls_made` in the
  response; watch this in Vercel logs.
- `api/_ai.js` throws a structured `rate_limited` error when every provider
  is throttled; the message tells the founder to retry in 30–60s instead
  of falling back into infinite retry loops.

## 5. First deploy checklist (fresh dev → live in 15 min)

```
1. git clone <repo>
2. npm install
3. Create .env.local from .env, replacing every key with a fresh one
4. npm run dev       — smoke-test on http://localhost:5173
5. npx vercel login  — authenticate with the team account
6. npx vercel link   — link the project
7. Set all 6 env vars in the Vercel dashboard
8. npx vercel --prod
9. Open the deployed URL, paste an adlersden.com/product/* URL, verify a report renders
10. Try a Concept Product run from the "Plan a concept product" tab
```

## 6. Known-flaky competitor brands

The Shopify catalog endpoint for `masonandco.in`, `kocoatrait.com`,
`naviluna.com`, and `earthloaf.com` was unreachable from the Windows dev
box at the time of writing (connection / TLS issues, possibly geo or
firewall). They are kept in `SHOPIFY_BRANDS` because Vercel's outbound
network usually reaches them fine. If a deployed analysis still misses
these brands, hit `https://<brand>/products.json?limit=2` from a Vercel
function and re-evaluate.

## 7. Logs to watch in Vercel

- `[search-competitors] SerpAPI fan-out` — confirms broader-internet search ran
- `[search-competitors] Catalog search: N candidates → M type-matched → K returned` — sanity-check that filtering is reasonable
- `[<label>] Groq rate-limited, retrying in 10s` — quota nearing exhaustion
- `[<label>] Trying Gemini...` — Groq has burned out; if Gemini ALSO fails
  with "API key expired", rotate per §3
