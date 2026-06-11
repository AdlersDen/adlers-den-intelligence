// ──────────────────────────────────────────────────────────
// Shared scraper utility — _scrape.js
// Used by: search-competitors.js (competitor URL enrichment)
//          fetch-product.js (Layer 2 & 3 product fetch fallback)
// Prefixed with _ so Vercel does NOT expose it as a public route
// ──────────────────────────────────────────────────────────

import { callAI } from './_ai.js';

const SCRAPE_TIMEOUT_MS = 15000;

// ── Shopify brand map — corrected & complete ───────────────
// Any competitor whose hostname is in this map gets hit via
// products.json directly instead of a plain HTTP fetch
export const SHOPIFY_BRANDS = {
  'smoor.in': true,            // corrected — was smoor.com
  'paulandmike.co': true,      // corrected — was paulandmike.in
  'masonandco.in': true,       // intermittent TLS from dev box; expected to work in Vercel
  'kocoatrait.com': true,      // intermittent connect; expected to work in Vercel
  'naviluna.com': true,        // intermittent connect; expected to work in Vercel
  'manamchocolate.com': true,
  'zoroy.com': true,           // strong competitor, wide hamper range
  'entisi.com': true,
  'theobroma.in': true,
  'pascati.com': true,
  'earthloaf.com': true,       // intermittent connect; expected to work in Vercel
  'bonfiction.com': true,      // added — live Shopify; bars + assorted boxes
};

// ── Snack / flavoured-nut brand map ────────────────────────
// Used for Adler's Den's non-chocolate SKUs (Flavoured Nuts, Berries &
// Fruits, Dessert Collection). The chocolate brands above don't sell BBQ
// almonds or peppered cashews; this pool does. All audited 2026-05 as
// live Shopify endpoints. Failed entries (yogabar.in 403, truelements.in
// 404) intentionally excluded.
export const SHOPIFY_SNACK_BRANDS = {
  'happilo.com':              true,
  'opensecret.in':            true,
  'thewholetruthfoods.com':   true,
  'nourishyou.in':            true,
  'nuttyyogi.com':            true,
  'eatanytime.in':            true,
  'farmley.com':              true,
  'soulfullfoods.com':        true,
};

// ── Timeout helper ─────────────────────────────────────────
// Wraps a fetch call with an AbortController timeout.
// All three scraper functions use this identically.
function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .then(res => { clearTimeout(timer); return res; })
    .catch(err => { clearTimeout(timer); throw err; });
}

// ── HTML → text helper ─────────────────────────────────────
// Strips tags and decodes the common HTML entities Shopify and
// WooCommerce return in body_html / description. Preserves paragraph
// breaks as newlines so the downstream extractor sees structure.
// Exported so fetch-product.js can drop its near-duplicate.
export function htmlToText(html) {
  if (!html) return null;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,    '&')
    .replace(/&nbsp;/g,   ' ')
    .replace(/&rsquo;/g,  "'")
    .replace(/&lsquo;/g,  "'")
    .replace(/&rdquo;/g,  '"')
    .replace(/&ldquo;/g,  '"')
    .replace(/&quot;/g,   '"')
    .replace(/&#39;/g,    "'")
    .replace(/&hellip;/g, '…')
    .replace(/&ndash;/g,  '–')
    .replace(/&mdash;/g,  '—')
    .replace(/&lt;/g,     '<')
    .replace(/&gt;/g,     '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]{2,}/g, ' ')      // collapse spaces/tabs only
    .replace(/\n{3,}/g, '\n\n')      // cap consecutive blank lines
    .trim();
}

// ── Title relevance check ──────────────────────────────────
// Shopify's ?title= is a fuzzy match — for "milk peanut clusters"
// it happily returns "Buy Chocolate Bar Online In India" if it
// thinks any token overlaps. We re-verify by requiring at least one
// non-stopword token from the query to appear in the returned title.
const TITLE_STOPWORDS = new Set([
  'the', 'and', 'a', 'an', 'of', 'in', 'for', 'with', 'to', 'on', 'by',
  'chocolate', 'chocolates', 'bar', 'box', 'pack', 'gift', 'india', 'online', 'buy',
]);

function titleMatches(returnedTitle, queryTerm) {
  if (!returnedTitle || !queryTerm) return false;
  const tokens = queryTerm
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter(t => t.length >= 3 && !TITLE_STOPWORDS.has(t));
  if (tokens.length === 0) return true; // query was only stopwords — trust Shopify
  const titleLower = returnedTitle.toLowerCase();
  return tokens.some(t => titleLower.includes(t));
}

// ── scrapeShopify ──────────────────────────────────────────
// Hits Shopify's native ?title= filter — far more reliable than
// fetching random products and filtering locally.
// Shopify max limit is 250. Returns normalised product data or null.
export async function scrapeShopify(domain, queryTerm) {
  const url = `https://${domain}/products.json?title=${encodeURIComponent(queryTerm)}&limit=250`;

  let data;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'AdlersDen-Intelligence/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    throw new Error(`scrapeShopify(${domain}): ${err.message}`);
  }

  const products = data.products || [];
  if (products.length === 0) return null;

  // Shopify ?title= is fuzzy — pick the first product whose title actually
  // shares a real token with the query. Falls through to null if nothing
  // matches, so the caller can skip the brand instead of showing junk.
  const product = products.find(p => titleMatches(p.title, queryTerm));
  if (!product) return null;

  return normalizeShopifyProduct(product);
}

// Shared normaliser for a Shopify product object (from products.json or
// products/<handle>.json) → our competitor shape.
function normalizeShopifyProduct(product) {
  if (!product) return null;
  const variant = product.variants?.[0];
  const priceRaw = variant?.price ? parseFloat(variant.price) : null;
  // Competitor card uses this as a one-line snippet — collapse newlines.
  const description = (htmlToText(product.body_html) || product.tags?.join?.(', ') || '')
    .replace(/\s+/g, ' ')
    .trim() || null;

  return {
    name: product.title || null,
    price: priceRaw ? `₹${priceRaw.toLocaleString('en-IN')}` : null,
    price_numeric: priceRaw,
    description: description ? description.slice(0, 500) : null,
    weight: variant?.weight ? `${variant.weight}${variant.weight_unit || 'g'}` : null,
    _source: 'shopify_api',
  };
}

// ── fetchShopifyProductsByTitle ────────────────────────────
// Catalog search: query a brand's storefront for products whose title
// matches `title` (Shopify substring filter). Returns an array of
// normalised products, each with its handle + canonical product URL so
// the competitor card links to the exact product. Never throws — a brand
// that errors or blocks simply contributes nothing.
export async function fetchShopifyProductsByTitle(domain, title, limit = 20) {
  const url = `https://${domain}/products.json?title=${encodeURIComponent(title)}&limit=${limit}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'AdlersDen-Intelligence/1.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.products || []).map(p => {
      const norm = normalizeShopifyProduct(p);
      if (!norm) return null;
      return {
        ...norm,
        handle: p.handle || null,
        url: p.handle ? `https://${domain}/products/${p.handle}` : null,
        title: p.title || norm.name,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ── scrapeShopifyByHandle ──────────────────────────────────
// When the SerpAPI result URL already points at a specific Shopify
// product (/products/<handle>), fetch THAT product directly instead of
// title-searching. Title search could return a different product than
// the link, producing a price/description that doesn't match the URL the
// user clicks. Returns normalised product data or null.
export async function scrapeShopifyByHandle(domain, handle) {
  const url = `https://${domain}/products/${encodeURIComponent(handle)}.json`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'AdlersDen-Intelligence/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return normalizeShopifyProduct(data.product);
  } catch (err) {
    throw new Error(`scrapeShopifyByHandle(${domain}/${handle}): ${err.message}`);
  }
}

// ── scrapePlainHTTP ────────────────────────────────────────
// Plain HTTP fetch → raw HTML → Groq extracts product fields.
// Used for Amazon.in, Flipkart, and any non-Shopify non-JS site.
// Returns normalised product data or null.
export async function scrapePlainHTTP(url) {
  let html;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AdlersDen-Intelligence/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    throw new Error(`scrapePlainHTTP fetch(${url}): ${err.message}`);
  }

  // Trim to first 8000 chars — enough for product info above the fold,
  // keeps Groq token cost low
  const truncated = html.slice(0, 8000);

  const result = await callAI({
    system: `You are a product data extractor. Extract the product name, price, and description from the HTML text provided.
You MUST respond with valid JSON only — no markdown, no preamble.`,
    user: `Extract product data from this HTML:

${truncated}

Respond with exactly this JSON (use null for any field you cannot find):
{
  "name": "product name or null",
  "price": "₹X,XXX formatted string or null",
  "price_numeric": number or null,
  "description": "product description max 300 chars or null"
}`,
    maxTokens: 512,
    label: 'plain-http-extract',
  });

  return { ...result, _source: 'http_ai' };
}

// ── scrapeBrowserless ──────────────────────────────────────
// Headless browser render via Browserless.io content API.
// Used for JavaScript-rendered storefronts that plain HTTP can't read.
// Gated on BROWSERLESS_API_KEY — throws if key not set.
// Returns normalised product data or null.
export async function scrapeBrowserless(url) {
  const { BROWSERLESS_API_KEY } = process.env;
  if (!BROWSERLESS_API_KEY) {
    throw new Error('BROWSERLESS_API_KEY not set — skipping headless scrape');
  }

  const browserlessEndpoint = `https://chrome.browserless.io/content?token=${BROWSERLESS_API_KEY}`;

  let html;
  try {
    const res = await fetchWithTimeout(browserlessEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle2' },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Browserless HTTP ${res.status}: ${errText}`);
    }
    html = await res.text();
  } catch (err) {
    throw new Error(`scrapeBrowserless(${url}): ${err.message}`);
  }

  // Rendered HTML is larger — trim to 16000 chars so we keep the
  // ingredients/specs section that usually sits below the fold on
  // adlersden.com product pages. Larger budget lets the extractor see
  // weight, category, and the long description, not just the H1 + price.
  const truncated = html.slice(0, 16000);

  const result = await callAI({
    system: `You are a product data extractor for premium Indian chocolate/gifting sites.
Extract every product attribute you can find in the rendered page HTML provided.
You MUST respond with valid JSON only — no markdown, no preamble.
If a field is genuinely absent in the HTML, return null — do not guess.`,
    user: `Extract product data from this rendered product page HTML:

${truncated}

Respond with EXACTLY this JSON shape (use null for any field genuinely not present in the HTML):
{
  "name":          "exact product name or null",
  "price":         "₹X,XXX formatted string or null",
  "price_numeric": number or null,
  "description":   "full product description, up to 1500 chars — include ingredients, contents, occasion language, and any composition detail visible on the page",
  "weight":        "weight string like '250g' or null",
  "category":      "category/collection name shown on the page (e.g. 'Gift Hampers', 'Single Origin Bars') or null",
  "ingredients":   ["ingredient 1", "ingredient 2"] or null,
  "tags":          ["tag 1", "tag 2"] or null
}

Rules:
- description should be COMPREHENSIVE — copy every sentence describing what the product contains, its ingredients, sourcing, occasion, and dietary attributes. Do not summarise to one line.
- ingredients should list every ingredient or contained item mentioned anywhere on the page.
- If the page lists multiple chocolate pieces or hamper contents, include each in the description AND in ingredients.`,
    maxTokens: 1200,
    label: 'browserless-extract',
  });

  return { ...result, _source: 'browserless' };
}
