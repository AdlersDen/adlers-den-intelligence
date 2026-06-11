// ──────────────────────────────────────────────────────────
// D1 — POST /api/fetch-product
// 3-layer waterfall:
//   Layer 1: WooCommerce REST API (structured, authoritative)
//   Layer 2: Browserless headless render (JS-rendered HTML)
//   Layer 3: Plain HTTP + Groq extraction (no JS required)
// Mock data is only available when NODE_ENV !== 'production'
// All responses include a _source field for debugging
// ──────────────────────────────────────────────────────────

import { scrapePlainHTTP, scrapeBrowserless, htmlToText } from './_scrape.js';

const WC_BASE      = 'https://adlersden.com/wp-json/wc/v3';
const PRODUCT_BASE = 'https://adlersden.com/product';

// Thin wrapper so existing call-sites stay readable; htmlToText handles
// tag stripping, paragraph preservation, and HTML entity decoding.
const stripHtml = (html) => htmlToText(html) || '';

function extractSlug(url) {
  // Handles: /product/slug, /products/slug, /shop/slug
  const match = url.match(/\/(?:product|products|shop)\/([^/?#]+)/i);
  return match ? match[1] : null;
}

// ── Layer 1: WooCommerce REST API ──────────────────────────

async function fetchFromWooCommerce(slug) {
  const { WC_CONSUMER_KEY, WC_CONSUMER_SECRET } = process.env;
  const credentials = Buffer.from(`${WC_CONSUMER_KEY}:${WC_CONSUMER_SECRET}`).toString('base64');

  const wcUrl = `${WC_BASE}/products?slug=${encodeURIComponent(slug)}&status=publish`;
  console.log('[fetch-product] WC query slug:', slug, '→', wcUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(wcUrl, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/json',
        'User-Agent':    'AdlersDen-Intelligence/1.0',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw new Error('WooCommerce authentication failed — check WC_CONSUMER_KEY and WC_CONSUMER_SECRET');
  if (res.status === 403) throw new Error('WooCommerce API returned 403 Forbidden — the API key may lack Read permissions. Regenerate with Read access in WP Admin → WooCommerce → Settings → REST API');
  if (res.status === 404) throw new Error('WooCommerce REST API not found — ensure WooCommerce is installed and REST API is enabled');
  if (!res.ok)            throw new Error(`WooCommerce returned HTTP ${res.status}`);

  const products = await res.json();
  console.log('[fetch-product] WC returned', products.length, 'product(s) for slug:', slug);
  if (!Array.isArray(products) || products.length === 0) return null;

  const p = products[0];
  console.log('[fetch-product] WC product type:', p.type, '| price:', p.price, '| variations:', p.variations?.length || 0);

  const description = [stripHtml(p.short_description), stripHtml(p.description)]
    .filter(Boolean)
    .join('\n\n');

  // ── Price handling ──────────────────────────────────────
  // WooCommerce sometimes returns a long decimal (e.g. "427.6190476")
  // when the store is configured with tax-exclusive base prices. We
  // round to whole rupees and format with Indian thousands separators.
  // Variable products have a price range in p.price_html; we extract
  // and round each number in that range as well.
  function formatRupees(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return null;
    return '₹' + Math.round(num).toLocaleString('en-IN');
  }
  function formatPriceHtml(html) {
    return stripHtml(html)
      .replace(/\s+/g, ' ')
      .trim()
      // round each ₹<digits>(.decimals)? to whole rupees with separators
      .replace(/₹\s?(\d+(?:\.\d+)?)/g, (_, n) => formatRupees(n) || ('₹' + n));
  }
  let priceDisplay;
  if (p.type === 'variable' && p.price_html) {
    priceDisplay = formatPriceHtml(p.price_html) || formatRupees(p.price) || 'Price not set';
  } else {
    priceDisplay = formatRupees(p.price) || 'Price not set';
  }

  return {
    name:          p.name,
    price:         priceDisplay,
    regular_price: p.regular_price || p.price,
    sale_price:    p.sale_price    || null,
    description,
    category:      p.categories?.map(c => c.name).join(', ') || 'Uncategorised',
    weight:        p.weight        || null,
    tags:          p.tags?.map(t => t.name) || [],
    images:        p.images?.slice(0, 3).map(i => i.src) || [],
    sku:           p.sku           || null,
    slug,
    _source:       'woocommerce',
  };
}

// ── Layer 2: Browserless headless render ───────────────────
// Constructs the product URL from the slug and delegates to
// scrapeBrowserless() which handles the timeout and Groq extraction

async function fetchViaBrowserless(slug) {
  const productUrl = `${PRODUCT_BASE}/${slug}/`;
  const scraped    = await scrapeBrowserless(productUrl);

  if (!scraped || !scraped.name) return null;

  // scrapeBrowserless now extracts category/weight/tags/ingredients
  // directly from the rendered page. Fold ingredients into the
  // description so the downstream composition extractor sees them.
  const ingredientLine = Array.isArray(scraped.ingredients) && scraped.ingredients.length
    ? `\nIngredients: ${scraped.ingredients.join(', ')}`
    : '';
  const description = (scraped.description || '') + ingredientLine;

  return {
    name:          scraped.name,
    price:         scraped.price         || 'Price not available',
    regular_price: scraped.price_numeric || null,
    sale_price:    null,
    description,
    category:      scraped.category      || 'Uncategorised',
    weight:        scraped.weight        || null,
    tags:          Array.isArray(scraped.tags) ? scraped.tags : [],
    images:        [],
    sku:           null,
    slug,
    _source:       'browserless',
  };
}

// ── Layer 3: Plain HTTP fetch + Groq extraction ────────────
// No JS rendering — works on Adler's Den SSR/WooCommerce pages
// Returns minimal product object; AI analysis handles the rest

async function fetchViaPlainHTTP(slug) {
  const productUrl = `${PRODUCT_BASE}/${slug}/`;
  const scraped    = await scrapePlainHTTP(productUrl);

  if (!scraped || !scraped.name) return null;

  return {
    name:          scraped.name,
    price:         scraped.price         || 'Price not available',
    regular_price: scraped.price_numeric || null,
    sale_price:    null,
    description:   scraped.description   || '',
    category:      'Uncategorised',
    weight:        null,
    tags:          [],
    images:        [],
    sku:           null,
    slug,
    _source:       'http_ai',
  };
}

// ── Mock data REMOVED ──────────────────────────────────────
// Mock fallback was removed to prevent fake data from appearing in
// reports. If all real layers fail, a clear error is returned instead.

// ── Route handler — 3-layer waterfall ─────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A product URL is required.' });
  }

  const slug = extractSlug(url);
  if (!slug) {
    return res.status(400).json({
      error: 'Could not extract a product slug from this URL. Make sure it is an adlersden.com/product/... URL.',
    });
  }

  const { WC_CONSUMER_KEY, WC_CONSUMER_SECRET } = process.env;

  // ── Layer 1: WooCommerce REST API ──────────────────────
  if (WC_CONSUMER_KEY && WC_CONSUMER_SECRET) {
    try {
      const product = await fetchFromWooCommerce(slug);
      if (product) {
        console.log('[fetch-product] Layer 1 success (woocommerce):', slug);
        return res.status(200).json(product);
      }
      // WooCommerce responded but returned no product for this slug
      console.warn('[fetch-product] Layer 1: no product found for slug:', slug);
    } catch (err) {
      console.warn('[fetch-product] Layer 1 failed:', err.message, '— trying Layer 2');
    }
  } else {
    console.warn('[fetch-product] WC keys not set — skipping Layer 1');
  }

  // ── Layer 2: Browserless headless render ───────────────
  try {
    const product = await fetchViaBrowserless(slug);
    if (product) {
      console.log('[fetch-product] Layer 2 success (browserless):', slug);
      return res.status(200).json(product);
    }
    console.warn('[fetch-product] Layer 2: scrape returned no usable data');
  } catch (err) {
    console.warn('[fetch-product] Layer 2 failed:', err.message, '— trying Layer 3');
  }

  // ── Layer 3: Plain HTTP + Groq extraction ──────────────
  try {
    const product = await fetchViaPlainHTTP(slug);
    if (product) {
      console.log('[fetch-product] Layer 3 success (http_ai):', slug);
      return res.status(200).json(product);
    }
    console.warn('[fetch-product] Layer 3: scrape returned no usable data');
  } catch (err) {
    console.warn('[fetch-product] Layer 3 failed:', err.message);
  }

  // ── All 3 layers failed ────────────────────────────────
  // No mock fallback — returning fake data would poison the entire
  // analysis pipeline and produce a misleading report.
  console.error('[fetch-product] All 3 layers failed for slug:', slug);
  return res.status(503).json({
    error: 'Could not fetch product data for this URL. All sources (WooCommerce API, Browserless, HTTP scrape) failed. Please check the product URL is correct and try again.',
  });
}
