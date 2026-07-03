// ──────────────────────────────────────────────────────────
// D3 — POST /api/search-competitors
// C1: Smart query construction with price range injection
// C2: Smart URL routing (Shopify / Amazon / Browserless)
// C3: Parallel enrichment via Promise.allSettled()
// C4: 4-round progressive competitor filter before AI
// ──────────────────────────────────────────────────────────

import { scrapeShopify, scrapeShopifyByHandle, scrapePlainHTTP, scrapeBrowserless, fetchShopifyProductsByTitle, SHOPIFY_BRANDS, SHOPIFY_SNACK_BRANDS } from './_scrape.js';

// Pull the /products/<handle> slug out of a Shopify URL, or null.
function shopifyHandleFromUrl(urlString) {
  try {
    const m = new URL(urlString).pathname.match(/\/products\/([^/?#]+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Corrected + expanded competitor domain list
const COMPETITOR_DOMAINS = [
  'smoor.in',           // corrected from smoor.com
  'paulandmike.co',     // corrected from paulandmike.in
  'masonandco.in',
  'entisi.com',         // added
  'kocoatrait.com',
  'naviluna.com',
  'manamchocolate.com',
  'zoroy.com',          // added
  'theobroma.in',       // added
  'pascati.com',
  'earthloaf.com',
  'bonfiction.com',
];

// ── SerpAPI source tiers ──────────────────────────────────
// Used to fan SerpAPI queries out across the wider Indian + international
// chocolate market, not just the 11 brand catalogs. Tiers are price-aware:
// quick-commerce only fires for budget/mid-range products; international
// luxury only fires for premium/luxury tier. This keeps the SerpAPI call
// budget under control and keeps results contextually appropriate.
const SERP_TIERS = {
  indian_premium: [
    'smoor.in', 'paulandmike.co', 'masonandco.in', 'entisi.com', 'kocoatrait.com',
    'naviluna.com', 'manamchocolate.com', 'zoroy.com', 'theobroma.in', 'pascati.com',
    'earthloaf.com', 'bonfiction.com', 'fabelle.in', 'loyka.in', 'toska.com',
    'sigl.in', 'anandas.in',
  ],
  // Snack-brand pool — used when productClass='snack' (Flavoured Nuts,
  // Berries, Desserts). Chocolate brands above would return zero useful
  // matches for these SKUs.
  indian_snacks: [
    'happilo.com', 'opensecret.in', 'thewholetruthfoods.com', 'nourishyou.in',
    'nuttyyogi.com', 'eatanytime.in', 'farmley.com', 'soulfullfoods.com',
    'yogabar.in', 'truelements.in',
  ],
  marketplaces:        ['amazon.in', 'flipkart.com'],
  quick_commerce:      ['bigbasket.com', 'jiomart.com', 'blinkit.com', 'zeptonow.com'],
  international_luxury: ['lindt.com', 'godiva.com', 'ferrerorocher.com', 'neuhauschocolates.com', 'lindtchocolate.in'],
};

// Pick which tiers apply at this price point AND product class. Snack
// products route to the snack pool + marketplaces (no international luxury
// — Lindt doesn't sell flavoured nuts). Chocolate products keep the
// existing tier logic.
function tiersForPriceTier(priceTier, productClass = 'chocolate') {
  if (productClass === 'snack') {
    // Quick-commerce sites (BigBasket, JioMart, Blinkit, Zepto) return
    // irrelevant category-page results via SerpAPI — Google indexes their
    // search results pages broadly, giving masala pastes and kitchenware.
    // Amazon.in and Flipkart.com produce clean product-page URLs and are
    // sufficient for marketplace-priced snack comparisons.
    return ['indian_snacks', 'marketplaces'];
  }
  const tiers = ['indian_premium', 'marketplaces'];
  if (priceTier === 'budget' || priceTier === 'mid-range') tiers.push('quick_commerce');
  if (priceTier === 'premium' || priceTier === 'luxury')   tiers.push('international_luxury');
  return tiers;
}

// Brand name map for display
const BRAND_MAP = {
  'smoor.in': 'Smoor',
  'paulandmike.co': 'Paul & Mike',
  'masonandco.in': 'Mason & Co',
  'entisi.com': 'Entisi',
  'kocoatrait.com': 'Kocoatrait',
  'naviluna.com': 'Naviluna',
  'manamchocolate.com': 'Manam Chocolate',
  'zoroy.com': 'Zoroy',
  'theobroma.in': 'Theobroma',
  'pascati.com': 'Pascati',
  'earthloaf.com': 'Earth Loaf',
  'bonfiction.com': 'Bon Fiction',
  'amazon.in': 'Amazon (3rd party)',
  'flipkart.com': 'Flipkart (3rd party)',
  'bigbasket.com': 'BigBasket',
  'jiomart.com': 'JioMart',
  'blinkit.com': 'Blinkit',
  'zeptonow.com': 'Zepto',
  'fabelle.in': 'Fabelle',
  'loyka.in': 'Loyka',
  'toska.com': 'Toska',
  'sigl.in': 'Sigl',
  'anandas.in': "Ananda's Chocolates",
  'lindt.com': 'Lindt',
  'lindtchocolate.in': 'Lindt India',
  'godiva.com': 'Godiva',
  'ferrerorocher.com': 'Ferrero Rocher',
  'neuhauschocolates.com': 'Neuhaus',
  // Snack / flavoured-nut brand pool (used for non-chocolate Adler's SKUs)
  'happilo.com':            'Happilo',
  'opensecret.in':          'Open Secret',
  'thewholetruthfoods.com': 'The Whole Truth',
  'nourishyou.in':          'Nourish You',
  'nuttyyogi.com':          'Nutty Yogi',
  'eatanytime.in':          'EAT Anytime',
  'farmley.com':            'Farmley',
  'soulfullfoods.com':      'Soulfull',
  'yogabar.in':             'Yogabar',
  'truelements.in':         'True Elements',
};

// ── Product class detection ────────────────────────────────
// Adler's Den catalog has chocolate SKUs AND non-chocolate SKUs (Flavoured
// Nuts, Berries & Fruits, Dessert Collection). The chocolate competitor
// brands don't sell BBQ almonds or peppered cashews, so for non-chocolate
// products we swap to a snack-brand pool. Detected from the WC category
// string + composition signals — never from product name alone (a Diwali
// chocolate hamper could contain "Almond Rochers" but is still chocolate).
const SNACK_CATEGORY_RE = /(flavoured\s*nut|spiced\s*nut|nuts?\b|berr|dried\s*fruit|fruit\s*and\s*nut|dessert|cake|brownie|cookie|snack)/i;
const CHOC_KEYWORD_RE   = /chocolate/i;

function detectProductClass(productCategory, composition) {
  const cat = String(productCategory || '');
  // Category explicitly says chocolate (including "Chocolate Coated Nuts")
  // → chocolate class.
  if (CHOC_KEYWORD_RE.test(cat)) return 'chocolate';
  // Category names a non-chocolate format (nuts/berries/fruits/desserts)
  // → snack class.
  if (SNACK_CATEGORY_RE.test(cat)) return 'snack';
  // No category signal — fall back to composition. Anything with a real
  // chocolate_type or cocoa% is chocolate; otherwise snack.
  if (composition?.chocolate_type) return 'chocolate';
  if (composition?.cocoa_percentage) return 'chocolate';
  // Hamper compositions carry chocolate_types_present (array) instead of
  // chocolate_type — without this check a chocolate hamper categorised as
  // "Christmas Gifts" was misrouted to the snack brand pool.
  if (Array.isArray(composition?.chocolate_types_present) && composition.chocolate_types_present.length > 0) return 'chocolate';
  if (Array.isArray(composition?.items) && composition.items.some(i => /chocolate/i.test(`${i?.category || ''} ${i?.chocolate_type || ''} ${i?.name || ''}`))) return 'chocolate';
  return 'snack';
}

// ── C1: Price helpers ──────────────────────────────────────

function getPriceTier(priceString) {
  if (!priceString) return 'premium';
  const numeric = parseInt(String(priceString).replace(/[₹,\s]/g, ''));
  if (isNaN(numeric)) return 'premium';
  if (numeric <= 500) return 'budget';
  if (numeric <= 1500) return 'mid-range';
  if (numeric <= 3000) return 'premium';
  return 'luxury';
}

// ── C1: Query builder ──────────────────────────────────────

function buildSearchQuery(composition, productType, productPrice, productClass = 'chocolate') {
  const tier       = getPriceTier(productPrice);
  const tierLabel  = tier === 'luxury' ? 'luxury' : tier === 'premium' ? 'premium' : tier;

  // NOTE: the price range is intentionally NOT injected into the query text —
  // search engines don't match "₹2,000–₹6,500" well and it crowds out the
  // useful keywords. Price filtering still happens post-search in
  // filterCompetitors() using the parsed numeric price.

  // ── Non-chocolate (snack) product class ──
  // Build a snack-flavoured query — "premium flavoured almonds India" —
  // so SerpAPI scopes to the snack pool meaningfully. Chocolate-specific
  // signals like cocoa% / bean-to-bar are dropped.
  if (productClass === 'snack') {
    const ingredients = composition.ingredients || [];
    const flavourNotes = composition.key_flavour_notes || [];
    const fmt = String(composition.format || '').toLowerCase();
    const SNACK_NOUN = {
      coated_nuts: 'flavoured nuts',
      barks:       'fruit and nut mix',
      cluster:     'nut clusters',
      bites:       'snack bites',
      spread:      'nut butter spread',
    };
    const noun = SNACK_NOUN[fmt] || 'snack';
    const parts = [`${tierLabel} ${noun} India`];
    const firstIng = ingredients.find(i => i && !/^(chocolate|sugar|salt|cocoa)$/i.test(String(i))) || ingredients[0];
    if (firstIng) parts.push(String(firstIng));
    const firstFlavour = flavourNotes.find(f => f && !/^(sweet|savoury)$/i.test(String(f)));
    if (firstFlavour) parts.push(String(firstFlavour));
    if (composition.dietary?.vegan)      parts.push('vegan');
    if (composition.dietary?.gluten_free) parts.push('gluten free');
    return parts.slice(0, 6).join(' ');
  }

  if (productType === 'hamper') {
    const chocolateTypes = composition.chocolate_types_present || [];
    const totalWeight    = Number(composition.total_weight_grams);
    const occasions      = composition.occasion_fit || [];

    const parts = [`${tierLabel} chocolate gift hamper India`];
    if (chocolateTypes.includes('dark'))  parts.push('dark chocolate');
    if (chocolateTypes.includes('milk'))  parts.push('milk chocolate');
    // Guard against null weight — `null < 200` coerces to true and used to
    // tag every hamper "mini hamper". Only label when weight is known.
    if (Number.isFinite(totalWeight) && totalWeight > 0) {
      if (totalWeight >= 1000)     parts.push('large hamper');
      else if (totalWeight < 250)  parts.push('mini hamper');
    }

    const occasionMap = {
      corporate_gifting: 'corporate gifting',
      festive:           'festive',
      birthday:          'birthday',
      romantic:          'romantic',
    };
    const primaryOccasion = occasions.map(o => occasionMap[o]).filter(Boolean)[0];
    if (primaryOccasion) parts.push(primaryOccasion);

    return parts.slice(0, 6).join(' ');
  }

  // single_chocolate
  const cocoa        = composition.cocoa_percentage;
  const origin       = composition.origin_region || composition.origin_country;
  const chocoType    = composition.chocolate_type || 'dark';
  const qualityTier  = composition.quality_tier;
  const formatNoun   = formatToNoun(composition.format);   // e.g. "chocolate rochers", not always "bar"
  const keyIngredient = (composition.ingredients || [])[0];

  const parts = [];
  if (cocoa)                               parts.push(`${cocoa}%`);
  if (origin && origin !== 'null')         parts.push(origin);
  // Use the actual product FORMAT instead of hardcoding "bar" so a rocher
  // is compared to rochers/clusters, not to dark chocolate bars.
  parts.push(`${chocoType} ${formatNoun} India`);
  if (keyIngredient)                       parts.push(keyIngredient);
  if (composition.is_bean_to_bar)          parts.push('bean to bar');
  if (qualityTier === 'premium' || qualityTier === 'luxury') parts.push('artisanal');

  return parts.slice(0, 6).join(' ');
}

// Map the extracted `format` to a natural search/display noun. Defaults to
// the generic "chocolate" when format is missing/"other" so we never wrongly
// force "bar".
const FORMAT_NOUN = {
  bar: 'chocolate bar',
  rocher: 'chocolate rochers',
  truffle: 'chocolate truffles',
  praline: 'chocolate pralines',
  bonbon: 'chocolate bonbons',
  dragees: 'chocolate dragees',
  barks: 'chocolate bark',
  coated_nuts: 'chocolate coated nuts',
  cluster: 'chocolate clusters',
  bites: 'chocolate bites',
  gianduja: 'gianduja chocolate',
  spread: 'chocolate spread',
};
function formatToNoun(format) {
  if (!format) return 'chocolate';
  return FORMAT_NOUN[String(format).toLowerCase()] || 'chocolate';
}

// ── Snippet price extractor (SerpAPI) ───────────────────────

function extractPrice(item) {
  // SerpAPI rich_snippet extensions may contain a price string like "₹1,299"
  const extensions = item.rich_snippet?.top?.extensions || item.rich_snippet?.bottom?.extensions || [];
  for (const ext of extensions) {
    const m = String(ext).match(/₹\s?[\d,]+/);
    if (m) {
      const numeric = parseInt(m[0].replace(/[₹,\s]/g, ''));
      if (!isNaN(numeric)) return { display: m[0].replace(/\s/, ''), numeric };
    }
  }
  // Fallback: scan the plain snippet text
  const snippetMatch = (item.snippet || '').match(/₹\s?[\d,]+/);
  if (snippetMatch) {
    const numeric = parseInt(snippetMatch[0].replace(/[₹,\s]/g, ''));
    if (!isNaN(numeric)) return { display: snippetMatch[0].replace(/\s/, ''), numeric };
  }
  return { display: null, numeric: null };
}

function extractBrandFromUrl(urlString) {
  try {
    const hostname = new URL(urlString).hostname.replace('www.', '');
    return BRAND_MAP[hostname] || hostname.split('.')[0].replace(/\b\w/g, c => c.toUpperCase());
  } catch {
    return 'Unknown';
  }
}

// Marketplace product titles start with the seller brand. Amazon: "TopNut
// Smoked BBQ Premium Almonds…", Flipkart: "Buy LINDT Excellence Black
// Currant…" or "NISHRU Barbeque Almonds…". Parsing the leading 1–2 tokens
// gives the founder the real competitor brand instead of just "Amazon".
const MARKETPLACE_PREFIX_RE = /^(?:Buy\s+)?([A-Z][A-Za-z0-9&\-']+(?:\s+[A-Z][A-Za-z0-9&\-']+)?)/;
const MARKETPLACE_HOSTS = new Set(['amazon.in', 'flipkart.com', 'amazon.com', 'bigbasket.com', 'jiomart.com', 'blinkit.com', 'zeptonow.com']);

function brandFromMarketplaceTitle(title) {
  if (!title) return null;
  // Strip common ASIN noise / pack-size suffix before the first comma
  const head = String(title).split(',')[0].trim();
  const m = head.match(MARKETPLACE_PREFIX_RE);
  if (!m) return null;
  // Generic descriptors that aren't brand names — if the first token is
  // one of these, the title doesn't lead with a brand. If the SECOND
  // token is one (e.g. "TopNut Smoked"), keep only the first token.
  const GENERIC = /^(BBQ|Barbeque|Barbecue|Barbequed|Barbecued|Smoked|Premium|Roasted|Toasted|Organic|Natural|Fresh|Classic|Original|Spicy|Sweet|Salted|Crunchy|Healthy|Dry|Raw|Sun|Vegan|Gluten|Dark|Milk|White|Pure|Real|New|Best|Mini|Big|Small|Hot|Cold|Sugar|No|Low|Free|Texas|Indian|Almonds?|Cashews?|Walnuts?|Pistachios?|Peanuts?|Hazelnuts?|Nuts|Bites|Pack|Mix|Box|Jar|Pouch|Gourmet)$/i;
  const tokens = m[1].trim().split(/\s+/);
  if (GENERIC.test(tokens[0])) return null;
  let candidate = tokens[0];
  if (tokens[1] && !GENERIC.test(tokens[1])) candidate = `${tokens[0]} ${tokens[1]}`;
  if (candidate.length < 3 || candidate.length > 30) return null;
  return candidate;
}

// Wrap extractBrandFromUrl with marketplace-title parsing so an Amazon
// listing for "Ambriona Vegan Barbequed Almonds" shows brand="Ambriona"
// instead of "Amazon (3rd party)". Keeps the marketplace suffix in
// parentheses for transparency when the parse fails.
function extractBrand(urlString, title) {
  let hostname;
  try { hostname = new URL(urlString).hostname.replace('www.', ''); }
  catch { return 'Unknown'; }

  if (MARKETPLACE_HOSTS.has(hostname)) {
    const parsed = brandFromMarketplaceTitle(title);
    if (parsed) {
      const marketplace = BRAND_MAP[hostname]?.replace(' (3rd party)', '').trim() || hostname.split('.')[0];
      return `${parsed} · ${marketplace}`;
    }
  }
  return extractBrandFromUrl(urlString);
}

// ── C2: URL routing — enrich one competitor ────────────────

async function enrichCompetitor(competitor) {
  let hostname;
  try {
    hostname = new URL(competitor.url).hostname.replace('www.', '');
  } catch {
    return competitor; // malformed URL
  }

  // Non-product URLs (brand homepages, /collections/, /blogs/) are
  // kept as brand mentions but skip enrichment — otherwise we'd scrape
  // an unrelated first-on-the-shelf product and present it as a match.
  if (competitor._enrichable === false) {
    return { ...competitor, _enriched_source: 'snippet_only' };
  }

  try {
    let scraped = null;

    if (SHOPIFY_BRANDS[hostname]) {
      // Prefer the exact product the result URL points to (so the shown
      // price/description always matches the link). Fall back to a title
      // search only when the URL has no /products/<handle>.
      const handle = shopifyHandleFromUrl(competitor.url);
      if (handle) {
        scraped = await scrapeShopifyByHandle(hostname, handle);
      } else {
        scraped = await scrapeShopify(hostname, competitor.product_name);
      }
    } else if (hostname === 'amazon.in' || hostname.endsWith('.amazon.in')) {
      scraped = await scrapePlainHTTP(competitor.url);
    } else if (hostname === 'flipkart.com') {
      scraped = await scrapePlainHTTP(competitor.url);
    } else {
      scraped = await scrapeBrowserless(competitor.url);
    }

    if (scraped) {
      return {
        ...competitor,
        price:              scraped.price        || competitor.price,
        price_numeric:      scraped.price_numeric ?? competitor.price_numeric,
        description:        scraped.description   || competitor.description,
        weight:             scraped.weight        || competitor.weight || null,
        _enriched_source:   scraped._source,
      };
    }
  } catch (err) {
    console.warn(`[search-competitors] enrichCompetitor(${hostname}): ${err.message}`);
  }

  return competitor; // unenriched — non-fatal
}

// ── URL classification helpers ─────────────────────────────
// Two-tier filter:
//   isAggregatorUrl   — food-delivery / Swiggy / Zomato / order.*
//                       These are never the brand's own page; drop them
//                       so brand="Order" garbage never reaches the UI.
//   isEnrichableProductUrl — a specific /products/<handle> page worth
//                       enriching via scrapeShopify/scrapeBrowserless.
//                       Category pages, blog posts, and homepages are
//                       KEPT (so the brand still shows up as a mention)
//                       but flagged so enrichCompetitor leaves them as
//                       snippet-only — no fake product data is attached.
function isAggregatorUrl(urlString) {
  let u;
  try { u = new URL(urlString); } catch { return true; } // unparseable → drop
  const host = u.hostname.toLowerCase();
  const AGGREGATORS = ['swiggy.com', 'zomato.com', 'magicpin.in', 'order.online', 'dunzo.com', 'instamart.com'];
  if (AGGREGATORS.some(h => host === h || host.endsWith('.' + h))) return true;
  if (host.startsWith('order.')) return true; // order.<chain>.in
  return false;
}

function isEnrichableProductUrl(urlString) {
  let u;
  try { u = new URL(urlString); } catch { return false; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  // Shopify product handle
  if (/^\/products\//.test(path)) return true;
  // Amazon / Flipkart product page
  if ((host === 'amazon.in' || host.endsWith('.amazon.in')) && /\/dp\//.test(path)) return true;
  if ((host === 'flipkart.com' || host.endsWith('.flipkart.com')) && /\/p\//.test(path)) return true;
  return false;
}

// ── C3: Parse + enrich in parallel ────────────────────────

async function parseAndEnrichResults(items) {
  const parsed = items
    .filter(item => !item.link.includes('adlersden.com'))
    .filter(item => {
      if (isAggregatorUrl(item.link)) {
        console.log('[search-competitors] dropped aggregator URL:', item.link);
        return false;
      }
      return true;
    })
    .map(item => {
      const { display: price, numeric: priceNumeric } = extractPrice(item);
      // Parse the seller brand out of the Amazon/Flipkart title when
      // possible — "TopNut Smoked BBQ Almonds…" → "TopNut · Amazon" —
      // so the founder sees who's actually competing rather than just
      // the marketplace name.
      return {
        brand:         extractBrand(item.link, item.title),
        product_name:  item.title?.replace(/\s*[-|].*$/, '').trim() || item.title,
        description:   item.snippet || '',
        url:           item.link,
        price:         price || 'N/A',
        price_numeric: priceNumeric,
        weight:        null,
        key_features:  [],
        // Tag for the enricher — non-product URLs stay as snippet-only
        _enrichable:   isEnrichableProductUrl(item.link),
      };
    })
    .filter(c => c.product_name && c.brand);

  // C3: All enrichCompetitor calls run in parallel
  const settled = await Promise.allSettled(parsed.map(c => enrichCompetitor(c)));
  return settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .map(({ _enrichable, ...rest }) => rest); // strip internal flag before returning
}

// ── C4: 4-round progressive filter ────────────────────────

function extractCompositionKeywords(composition, productType) {
  if (productType === 'hamper') {
    return [
      ...(composition.chocolate_types_present || []),
      ...(composition.occasion_fit || []).map(o => o.replace('_', ' ')),
      composition.total_weight_grams > 400 ? 'large' : null,
    ].filter(Boolean);
  }
  return [
    composition.chocolate_type,
    composition.is_bean_to_bar    ? 'bean to bar' : null,
    composition.is_indian_origin  ? 'india'       : null,
    composition.origin_region,
    composition.cocoa_percentage  ? `${composition.cocoa_percentage}%` : null,
  ].filter(Boolean);
}

function matchesType(competitor, productType) {
  const text = `${competitor.product_name} ${competitor.description}`.toLowerCase();
  if (productType === 'hamper') {
    const isHamper   = /hamper|gift box|gift set|assortment|collection|basket/.test(text);
    const isPureBar  = /\b\d{2,3}%|bean.?to.?bar|single.?origin/.test(text) && !isHamper;
    return !isPureBar;
  }
  const isPureHamper = /hamper|gift box|gift set|assortment|basket/.test(text) &&
                       !/\b\d{2,3}%|chocolate bar/.test(text);
  return !isPureHamper;
}

function matchesPrice(competitor, productPrice, tolerance) {
  if (!competitor.price_numeric || !productPrice) return true;
  const numeric = parseInt(String(productPrice).replace(/[₹,\s]/g, ''));
  if (isNaN(numeric)) return true;
  return (
    competitor.price_numeric >= numeric * (1 - tolerance) &&
    competitor.price_numeric <= numeric * (1 + tolerance)
  );
}

function matchesKeywords(competitor, keywords) {
  if (!keywords.length) return true;
  const text = `${competitor.product_name} ${competitor.description}`.toLowerCase();
  return keywords.some(kw => text.includes(kw.toLowerCase()));
}

function runFilterRound(competitors, productType, productPrice, rules) {
  return competitors.filter(c => {
    if (!matchesType(c, productType))                                          return false;
    if (rules.checkPrice    && !matchesPrice(c, productPrice, rules.priceTolerance)) return false;
    if (rules.checkKeywords && !matchesKeywords(c, rules.keywords))            return false;
    return true;
  });
}

function filterCompetitors(competitors, productType, productPrice, composition) {
  const keywords = extractCompositionKeywords(composition, productType);

  // Round 1: type + price ±50% + keyword overlap
  let result = runFilterRound(competitors, productType, productPrice,
    { checkPrice: true, priceTolerance: 0.5, checkKeywords: true, keywords });
  if (result.length >= 3) {
    console.log(`[search-competitors] filtered ${competitors.length} → ${result.length} via Round 1`);
    return result;
  }

  // Round 2: type + price ±75%
  result = runFilterRound(competitors, productType, productPrice,
    { checkPrice: true, priceTolerance: 0.75, checkKeywords: false, keywords: [] });
  if (result.length >= 3) {
    console.log(`[search-competitors] filtered ${competitors.length} → ${result.length} via Round 2`);
    return result;
  }

  // Round 3: type match only
  result = runFilterRound(competitors, productType, productPrice,
    { checkPrice: false, priceTolerance: 0, checkKeywords: false, keywords: [] });
  if (result.length >= 3) {
    console.log(`[search-competitors] filtered ${competitors.length} → ${result.length} via Round 3`);
    return result;
  }

  // Round 4: pass everything — let AI decide
  console.log(`[search-competitors] Round 4 — passing all ${competitors.length} (no filter)`);
  return competitors;
}

// ── Catalog-first competitor search ────────────────────────
// Instead of trusting whatever URL Google/SerpAPI returns (often a
// homepage or category page), we query the competitor brands' own Shopify
// catalogs for products that match THIS product's descriptors. That yields
// real, same-format comparables with correct prices and product links.

function priceNumeric(priceString) {
  const n = parseInt(String(priceString || '').replace(/[₹,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Estimate how many items a competitor hamper contains by scanning the
// title + description for common indicators. Lets the hamper analyst do
// honest price-per-item math against Adler's hamper (which the model
// already knows exactly). Returns ≥1; defaults to 1 when no signal exists
// so we never invent a count. Surfaced as `_estimated_item_count`.
function estimateHamperItemCount(name, description) {
  const text = `${name || ''}\n${description || ''}`;
  // Direct "Set of N" / "N piece(s)" / "[N pcs]" / "N x ..." declarations.
  const setRe   = /\b(?:set\s*of|pack\s*of|box\s*of)\s*(\d{1,2})\b/i;
  const piecesRe = /\[\s*(\d{1,2})\s*p(?:c|cs|iece|ieces)?\s*\]/i;
  const xRe     = /\b(\d{1,2})\s*x\b/i;
  for (const re of [setRe, piecesRe, xRe]) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 30) return n;
    }
  }
  // Comma/bullet itemised lists in the description — Theobroma uses these
  // ("Mother's Day Brownies [Set of 2], Butter Palmiers [3pcs], Oats &
  // Raisins…"). Split on commas/bullets/newlines/' & '/"and" and count
  // segments that look like item names (start with a capital letter or
  // chocolate-adjacent noun). Caps at 12 to avoid blowing up on prose.
  const seg = description
    ? description.split(/,|•|\n|\s—\s|\s-\s| & | and /i).map(s => s.trim()).filter(Boolean)
    : [];
  const itemy = seg.filter(s => /^[A-Z][a-zA-Z]/.test(s) || /(brownie|cookie|cake|palmier|chocolate|truffle|praline|nuts|cranberr|jam|premix|bar)/i.test(s));
  if (itemy.length >= 2 && itemy.length <= 12) return itemy.length;
  return 1;
}

// ── Occasion detection ────────────────────────────────────
// composition.occasion_fit is generic ("festive", "romantic"); the real
// signal lives in the product NAME and CATEGORY ("Diwali Hamper",
// "Valentine's Day", "Christmas Gifts"). Detecting the specific occasion
// lets us search competitor catalogs for THAT occasion's hampers — so a
// Diwali product no longer scores Mother's Day hampers as relevant.
const OCCASION_MATCHERS = [
  { occasion: 'diwali',    re: /\b(diwali|deepavali)\b/i,                 terms: ['diwali hamper', 'diwali gift', 'diwali'] },
  { occasion: 'christmas', re: /\b(christmas|xmas|x[- ]?mas)\b/i,         terms: ['christmas hamper', 'christmas gift', 'christmas box'] },
  { occasion: 'valentine', re: /\b(valentine|romance|romantic|sinful|trunkful of love|hearts?)\b/i, terms: ['valentine hamper', 'love gift', 'romantic hamper', 'heart chocolate'] },
  { occasion: 'rakhi',     re: /\b(rakhi|raksha\s*bandhan)\b/i,           terms: ['rakhi hamper', 'rakhi gift'] },
  { occasion: 'mother',    re: /\b(mother'?s?\s*day|mom\b|maa\b)/i,       terms: ['mother day hamper', 'mother day gift'] },
  { occasion: 'father',    re: /\b(father'?s?\s*day|dad\b|papa\b)/i,      terms: ['father day hamper', 'father day gift'] },
  { occasion: 'birthday',  re: /\bbirthday\b/i,                           terms: ['birthday hamper', 'birthday gift'] },
  { occasion: 'easter',    re: /\beaster\b/i,                             terms: ['easter hamper', 'easter gift', 'easter box'] },
  { occasion: 'holi',      re: /\bholi\b/i,                               terms: ['holi hamper', 'holi gift'] },
  { occasion: 'ganesh',    re: /\b(ganesh|ganpati|ganesha)\b/i,           terms: ['ganesh chocolate', 'ganesha'] },
  { occasion: 'corporate', re: /\bcorporate\b/i,                          terms: ['corporate hamper', 'corporate gift'] },
  { occasion: 'newyear',   re: /\b(new\s*year)\b/i,                       terms: ['new year hamper', 'new year gift'] },
];

function detectOccasion(productName, productCategory) {
  const haystack = `${productName || ''} ${productCategory || ''}`;
  for (const m of OCCASION_MATCHERS) {
    if (m.re.test(haystack)) return m;
  }
  return null;
}

// ── Format synonyms ───────────────────────────────────────
// Used for single-product strict matching. A "bites" product should be
// compared to bites/nibbles/squares/clusters — never to bars or truffles.
const FORMAT_SYNONYMS = {
  bar:         ['bar', 'tablet', 'slab'],
  rocher:      ['rocher', 'rochers', 'cluster', 'clusters'],
  truffle:     ['truffle', 'truffles', 'ganache'],
  praline:     ['praline', 'pralines'],
  bonbon:      ['bonbon', 'bonbons', 'filled chocolate'],
  dragees:     ['dragees', 'dragee'],
  barks:       ['bark', 'barks'],
  coated_nuts: ['coated', 'nibbles', 'covered nuts'],
  cluster:     ['cluster', 'clusters', 'rocher', 'rochers'],
  bites:       ['bites', 'nibbles', 'squares', 'square', 'pieces', 'minis', 'bark'],
  gianduja:    ['gianduja'],
  spread:      ['spread', 'chocolate butter'],
  other:       [],
};
function formatSynonyms(format) {
  return FORMAT_SYNONYMS[String(format || '').toLowerCase()] || [];
}

// Pick the catalog title-filter term(s). Hampers fan out to multiple
// occasion-specific terms; singles try the format/ingredient that most
// uniquely identifies the product. Always returns an array of 1–4 terms.
function catalogTermsFor(composition, productType, occasion, productClass = 'chocolate') {
  // ── Snack class — use ingredient + flavour-note as the title filter.
  // Happilo/Open Secret catalogs use words like "Almonds", "Cashews",
  // "Berry Mix", "Peri Peri". Filtering on those terms returns real
  // comparator products instead of zero matches.
  if (productClass === 'snack') {
    const ingredients = composition.ingredients || [];
    const flavours    = composition.key_flavour_notes || [];
    const fmt         = String(composition.format || '').toLowerCase();
    const SNACK_TERM = {
      coated_nuts: 'flavoured',
      barks:       'mix',
      cluster:     'cluster',
      bites:       'bites',
      spread:      'butter',
    };
    const terms = [];
    // 1. Strongest filter: the actual nut/fruit ingredient ("almonds", "cashews")
    const firstReal = ingredients.find(i => i && !/^(chocolate|sugar|salt|cocoa)$/i.test(String(i)));
    if (firstReal) terms.push(String(firstReal).toLowerCase());
    // 2. Flavour profile ("barbeque", "peri peri", "cinnamon")
    const firstFlavour = flavours.find(f => f && String(f).length >= 3);
    if (firstFlavour) terms.push(String(firstFlavour).toLowerCase());
    // 3. Format noun ("flavoured", "mix", "cluster") for the catalog filter
    if (SNACK_TERM[fmt]) terms.push(SNACK_TERM[fmt]);
    // 4. Generic almonds/cashews fallback if no ingredient pulled (e.g.
    //    Adler's "Chilli Guava" — guava isn't a default snack-brand SKU)
    if (terms.length === 0) terms.push('nuts', 'almonds');
    return [...new Set(terms)].slice(0, 4);
  }

  if (productType === 'hamper') {
    if (occasion) {
      // Occasion-specific terms PLUS a generic 'hamper' filler so brands
      // without occasion-named SKUs still contribute candidates (which
      // then get penalised in scoring vs. the occasion matches).
      return [...occasion.terms.slice(0, 3), 'hamper'];
    }
    return ['hamper', 'gift box', 'gift hamper'];
  }

  // single_chocolate
  const fmt = String(composition.format || '').toLowerCase();
  const DISTINCT_FORMATS = { rocher: 'rocher', truffle: 'truffle', praline: 'praline', bonbon: 'bonbon', dragees: 'dragees', barks: 'bark', gianduja: 'gianduja', cluster: 'cluster' };
  if (DISTINCT_FORMATS[fmt]) return [DISTINCT_FORMATS[fmt]];

  const ingredients = composition.ingredients || [];
  const firstReal = ingredients.find(i => i && !/^(dark|milk|white|ruby|chocolate)$/i.test(i));
  const terms = [];
  if (firstReal) terms.push(String(firstReal).toLowerCase());
  if (fmt === 'bites') terms.push('bites', 'nibbles');
  if (fmt === 'bar')   terms.push('bar');
  if (composition.cocoa_percentage) terms.push(`${composition.cocoa_percentage}%`);
  if (terms.length === 0) terms.push(String(composition.chocolate_type || 'dark').toLowerCase());
  return [...new Set(terms)].slice(0, 4);
}

// Weighted scoring. Higher = more relevant.
//   Hampers:
//     +5  title/desc contains the detected occasion keyword
//     +2  generic gift/hamper word in title
//     +1  matching chocolate_type or generic descriptor token
//   Singles:
//     +5  title contains the product format synonym
//     +3  title or desc contains a key ingredient
//     +2  title/desc contains the detected occasion keyword (for shape/occasion items like Ganesh, Easter)
//     +1  matching chocolate_type / generic token
function scoreHamperCandidate(cand, composition, occasion) {
  const title = String(cand.product_name || '').toLowerCase();
  const text  = `${title} ${String(cand.description || '').toLowerCase()}`;
  let score = 0;

  if (occasion && occasion.re.test(text)) score += 5;

  if (/\b(hamper|gift\s*box|gift\s*set|gift\s*basket|combo|gift\s*pack|gift\s*bag|basket)\b/.test(title)) score += 2;

  const types = (composition.chocolate_types_present || []).filter(Boolean);
  for (const t of types) {
    if (text.includes(String(t).toLowerCase())) { score += 1; break; }
  }

  // Penalise off-occasion hampers when we know the right one. Mother's Day
  // shouldn't appear for Diwali products even as filler.
  if (occasion) {
    const OTHER_OCCASIONS = OCCASION_MATCHERS.filter(m => m.occasion !== occasion.occasion);
    for (const other of OTHER_OCCASIONS) {
      if (other.re.test(title)) { score -= 3; break; }
    }
  }
  return score;
}

// ── Snack candidate scorer ─────────────────────────────────
// Different signal weights than chocolate: the key feature is the
// nut/fruit type (almonds, cashews, berries) and the flavour profile
// (BBQ, peri-peri, cinnamon). No cocoa%, no chocolate format synonyms.
function scoreSnackCandidate(cand, composition) {
  const title = String(cand.product_name || '').toLowerCase();
  const desc  = String(cand.description || '').toLowerCase();
  let score = 0;

  // Ingredient match: +5 if the nut/fruit appears in the TITLE (strong
  // signal — this IS that product), +2 if only in the description (weaker
  // — could be a minor ingredient buried in a different SKU). This is the
  // tightening that stops "High Protein Oats - Chocolate" matching at +5
  // just because the description's ingredient list mentioned almonds.
  for (const ing of (composition.ingredients || [])) {
    const t = String(ing).toLowerCase().trim();
    if (t.length < 4) continue;
    if (/^(sugar|salt|cocoa|cacao|butter|cream|chocolate)$/.test(t)) continue;
    if (title.includes(t))      { score += 5; break; }
    if (desc.includes(t))       { score += 2; break; }
  }

  // Flavour profile: +4 if title carries it (BBQ Almonds), +2 if desc only
  for (const note of (composition.key_flavour_notes || [])) {
    const t = String(note).toLowerCase().trim();
    if (t.length < 3) continue;
    if (/^(sweet|savoury|salty|sour)$/.test(t)) continue;
    if (title.includes(t)) { score += 4; break; }
    if (desc.includes(t))  { score += 2; break; }
  }

  // +2 for matching format keyword (flavoured / mix / cluster / bites)
  const fmt = String(composition.format || '').toLowerCase();
  const FMT_KEY = { coated_nuts: 'flavoured', barks: 'mix', cluster: 'cluster', bites: 'bites', spread: 'butter' };
  if (FMT_KEY[fmt] && (title.includes(FMT_KEY[fmt]) || desc.includes(FMT_KEY[fmt]))) score += 2;

  // +1 for vegan / gluten-free match (dietary signals)
  if (composition.dietary?.vegan && /\bvegan\b/.test(`${title} ${desc}`)) score += 1;
  if (composition.dietary?.gluten_free && /\b(gluten[- ]?free|gf)\b/.test(`${title} ${desc}`)) score += 1;

  // Penalise candidates whose title is clearly a different snack format
  // (oats, breakfast cereal, protein powder, drinks) when our product is
  // a nut/coated-nut. These slipped through the type filter because
  // happilo.com / opensecret.in carry mixed-category catalogs.
  const NON_NUT_TITLE = /\b(oats|granola|cereal|muesli|protein\s*powder|tea|coffee|drink|beverage|shake|milk|chips|crisps|biscuit|cookie|cake|breakfast)\b/i;
  if (NON_NUT_TITLE.test(title) && fmt === 'coated_nuts') score -= 4;

  // Wrong-nut penalty — if our product is almonds but the candidate title
  // is clearly a different nut/fruit category (dates, cashews, raisins,
  // walnuts, berries), demote it. Catches Farmley Date Bites scoring high
  // against BBQ Almonds because both have "vegan, gluten-free" descriptions.
  const ourIngs = (composition.ingredients || []).map(i => String(i).toLowerCase());
  const NUT_FRUIT_FAMILIES = ['almond', 'cashew', 'walnut', 'pistachio', 'peanut', 'hazelnut', 'pecan', 'macadamia', 'date', 'raisin', 'cranberry', 'berry', 'guava', 'mango', 'apricot', 'fig', 'coconut'];
  const ourFamily = NUT_FRUIT_FAMILIES.find(f => ourIngs.some(i => i.includes(f)));
  if (ourFamily) {
    const otherFamilies = NUT_FRUIT_FAMILIES.filter(f => f !== ourFamily && !ourFamily.includes(f) && !f.includes(ourFamily));
    for (const wrong of otherFamilies) {
      if (new RegExp(`\\b${wrong}s?\\b`, 'i').test(title)) { score -= 3; break; }
    }
  }

  return score;
}

// Distinctive descriptor tokens for a single product — the words that make
// it THIS product (mango, currant, orange, cashew, cranberry, hazelnut…),
// drawn from BOTH ingredients and key_flavour_notes and tokenised so a
// multi-word ingredient like "freeze-dried Alphonso mango pieces" still
// contributes the matchable token "mango". Generic chocolate/processing
// words are dropped so they never inflate a match.
const DESCRIPTOR_STOPWORDS = new Set([
  'dark', 'milk', 'white', 'ruby', 'chocolate', 'chocolates', 'cocoa', 'cacao',
  'sugar', 'sugarfree', 'butter', 'cream', 'salt', 'salted', 'roasted', 'freeze',
  'freezedried', 'dried', 'pieces', 'piece', 'coated', 'with', 'and', 'the', 'in',
  'premium', 'gourmet', 'natural', 'organic', 'vegan', 'sweet', 'savoury', 'plain',
]);
function distinctiveTokens(composition) {
  const raw = [
    ...(composition.ingredients || []),
    ...(composition.key_flavour_notes || []),
  ];
  const tokens = new Set();
  for (const item of raw) {
    for (const w of String(item).toLowerCase().split(/[^a-z0-9%]+/)) {
      const t = w.trim();
      if (t.length >= 4 && !DESCRIPTOR_STOPWORDS.has(t)) tokens.add(t);
    }
  }
  return [...tokens];
}

// How strongly a competitor matches the product's distinctive descriptors.
// Title hit weighs more than description hit. Used both inside the single
// scorer and for the final source-agnostic re-rank in the handler.
function descriptorOverlap(cand, tokens) {
  if (!tokens.length) return 0;
  const title = String(cand.product_name || '').toLowerCase();
  const desc  = String(cand.description || '').toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (title.includes(t)) s += 3;
    else if (desc.includes(t)) s += 1;
  }
  return s;
}

function scoreSingleCandidate(cand, composition, occasion) {
  const title = String(cand.product_name || '').toLowerCase();
  const text  = `${title} ${String(cand.description || '').toLowerCase()}`;
  let score = 0;

  // Distinctive ingredient/flavour match is the STRONGEST signal — a product
  // sharing the defining ingredient (mango, black currant, orange) is more
  // relevant than one that merely shares the format. Weighted above format
  // so "Mango Bites" beats "Hazelnut nibbles" for a mango product.
  const descScore = descriptorOverlap(cand, distinctiveTokens(composition));
  if (descScore > 0) score += Math.min(descScore + 3, 8); // cap so one match ~6, multi ~8

  // Format synonym match — relevant but secondary to the ingredient identity.
  const synonyms = formatSynonyms(composition.format);
  for (const syn of synonyms) {
    if (title.includes(syn)) { score += 4; break; }
  }

  if (occasion && occasion.re.test(text)) score += 2;

  if (composition.chocolate_type && text.includes(String(composition.chocolate_type).toLowerCase())) score += 1;

  if (composition.cocoa_percentage && text.includes(`${composition.cocoa_percentage}%`)) score += 1;

  // Penalise candidates whose title screams a DIFFERENT format (eg "Bar"
  // in a search for "Bites"). Without this, a single-product search keeps
  // returning bars because they all mention dark chocolate.
  if (composition.format) {
    const wrongFormats = Object.entries(FORMAT_SYNONYMS)
      .filter(([k]) => k !== String(composition.format).toLowerCase())
      .flatMap(([, list]) => list);
    for (const syn of synonyms) wrongFormats.splice(wrongFormats.indexOf(syn), 1); // don't penalise own synonyms
    for (const wrong of wrongFormats) {
      if (wrong.length >= 4 && new RegExp(`\\b${wrong}\\b`, 'i').test(title)) { score -= 2; break; }
    }
  }
  return score;
}

// Brand-specific catalog term aliases — some brands name the same product
// shape with different words ("tablet" vs "bar", "single origin" vs format),
// so a global search term misses them. When the global term doesn't fit a
// brand's vocabulary we add the brand's preferred alias to that brand's
// queries only. Keeps the global term list short while still surfacing
// brand-shaped matches.
const BRAND_TERM_ALIASES = {
  'naviluna.com':   { bar: ['tablet'] },
  'kocoatrait.com': { bar: ['single origin', 'tablet'] },
  'masonandco.in':  { bar: ['single origin'] },
  'earthloaf.com':  { bar: ['single origin'] },
  'manamchocolate.com': { bar: ['couverture', 'baking'] },
};

function termsForBrand(globalTerms, domain, composition) {
  const aliases = BRAND_TERM_ALIASES[domain];
  if (!aliases) return globalTerms;
  const fmt = String(composition.format || '').toLowerCase();
  const extra = aliases[fmt] || [];
  return [...new Set([...globalTerms, ...extra])];
}

// Some brands' catalog "descriptions" are just their internal tag list
// ("bogo-offer, city-bangalore, city-chennai, …" — Smoor does this). Strip
// tag-like tokens so they never reach the UI or the analyst prompt as if
// they were product copy; if the whole string was tags, blank it.
function cleanCatalogDescription(desc) {
  if (!desc) return '';
  const segs = String(desc).split(/,\s*/);
  const TAG_RE = /^(city-[a-z-]+|bogo-?offer|combo-?offer|offer|new-?arrivals?|best-?sellers?|out-?of-?stock|sale|featured)$/i;
  const kept = segs.filter(s => !TAG_RE.test(s.trim()));
  if (kept.length === 0) return '';
  // Mostly tags with a word or two left over → still junk, drop it.
  if (kept.length < segs.length / 2) return '';
  return kept.join(', ').trim();
}

async function catalogSearch(composition, productType, productPrice, productName, productCategory, productClass = 'chocolate') {
  const occasion = detectOccasion(productName, productCategory);
  const terms    = catalogTermsFor(composition, productType, occasion, productClass);
  const target   = priceNumeric(productPrice);
  // Pick the brand pool by product class — chocolate SKUs query the
  // existing 12 Shopify chocolate brands, snack SKUs query the 8 snack
  // brands (Happilo, Open Secret, Whole Truth, etc.) instead.
  const domains  = productClass === 'snack'
    ? Object.keys(SHOPIFY_SNACK_BRANDS)
    : Object.keys(SHOPIFY_BRANDS);

  console.log(`[search-competitors] Catalog search class=${productClass} type=${productType} occasion=${occasion?.occasion || 'none'} terms=[${terms.join(' | ')}] across ${domains.length} brands`);

  // Fan-out: one fetch per (domain, term) pair, with brand-specific term
  // aliases mixed in so e.g. Naviluna gets queried with "tablet" alongside
  // "bar". Each brand contributes candidates matching ANY of its terms.
  const fetches = [];
  for (const d of domains) {
    const brandTerms = termsForBrand(terms, d, composition);
    for (const t of brandTerms) {
      fetches.push(fetchShopifyProductsByTitle(d, t, 10).then(r => ({ domain: d, products: r })));
    }
  }
  const settled = await Promise.allSettled(fetches);

  const HAMPER_TITLE_RE = /\b(hamper|gift\s*box|gift\s*set|gift\s*basket|gift\s*pack|combo|basket|gift\s*bag)\b/i;
  const candidates = [];
  const seenUrls = new Set();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    const { domain, products } = r.value;
    for (const p of products) {
      if (!p.url || !p.name || seenUrls.has(p.url)) continue;
      seenUrls.add(p.url);
      candidates.push({
        brand:            BRAND_MAP[domain] || domain.split('.')[0],
        product_name:     p.name,
        description:      cleanCatalogDescription(p.description),
        url:              p.url,
        price:            p.price || 'N/A',
        price_numeric:    p.price_numeric ?? null,
        weight:           p.weight || null,
        key_features:     [],
        _enriched_source: 'shopify_catalog',
      });
    }
  }

  // Hard type filter — a single-product search must never return hampers,
  // cakes, brownies, drinks, kits, or anything that isn't actually a piece
  // of chocolate (those leak through because the brand's catalog mentions
  // "chocolate" in everything).
  const NON_CHOCOLATE_TITLE_RE = /\b(brownies?|cookies?|biscuits?|cakes?|tarts?|cupcakes?|muffins?|donuts?|pastr(?:y|ies)|loaf|breads?|baking\s*pods?|hot\s*chocolates?|drinking\s*chocolates?|premixes?|sauces?|jams?|t[- ]?shirts?|mugs?|cards?|bouquets?|flowers?|candles?|tealights?|hamper\s*combo)\b/i;
  // Snack class shouldn't see chocolate bars/truffles in the comparator
  // set either — Happilo's catalog includes a few coated-chocolate SKUs
  // but those aren't peers for BBQ Almonds.
  const CHOCOLATE_HEAVY_TITLE_RE = /\b(chocolate\s*(bar|truffle|praline|rocher)|cocoa\s*bar|dark\s*chocolate\s*bar|milk\s*chocolate\s*bar)\b/i;
  const typeFiltered = candidates.filter(c => {
    const title = c.product_name || '';
    if (productClass === 'snack') {
      if (HAMPER_TITLE_RE.test(title)) return false;
      if (CHOCOLATE_HEAVY_TITLE_RE.test(title)) return false;
      return true; // snack scorer below handles the relevance bar
    }
    if (productType !== 'hamper' && HAMPER_TITLE_RE.test(title)) return false;
    if (productType !== 'hamper' && NON_CHOCOLATE_TITLE_RE.test(title)) return false;
    if (productType === 'hamper' && !HAMPER_TITLE_RE.test(title) && !/\bgift\b/i.test(title)) return false;
    return matchesType(c, productType);
  });

  // Score each candidate with the type-appropriate scorer.
  const scored = typeFiltered.map(c => ({
    ...c,
    _score: productClass === 'snack'
      ? scoreSnackCandidate(c, composition)
      : productType === 'hamper'
        ? scoreHamperCandidate(c, composition, occasion)
        : scoreSingleCandidate(c, composition, occasion),
  }));

  // Threshold: drop candidates with score < 1 (means no signal at all
  // matched). With weighted scoring this still admits weak generic matches
  // when nothing better exists, but stops "Mango bar" appearing under
  // "Black Currant" because both share only the word "chocolate".
  const MIN_SCORE = productClass === 'snack' ? 2 : productType === 'hamper' ? 1 : 2;
  let relevant = scored.filter(c => c._score >= MIN_SCORE);

  // ── Composite ranking (similar-first, price-aware) ──
  // Composition similarity wins big (×2 weight) so a same-format competitor
  // always beats a price-similar but format-distant one. Then a soft price
  // band: candidates within ±50% of target get a +1 bonus, ±100% get 0, and
  // outliers get a small penalty proportional to how far they sit. This
  // surfaces "closest match" first without letting an exactly-priced
  // wrong-format product win the top slot.
  for (const c of relevant) {
    let priceAdj = 0;
    if (target && c.price_numeric) {
      const distPct = Math.min(Math.abs(c.price_numeric - target) / target, 2.0);
      if (distPct <= 0.5) priceAdj = 1;       // within ±50% — bonus
      else if (distPct <= 1.0) priceAdj = 0;  // ±100% — neutral
      else priceAdj = -(distPct * 0.5);       // beyond ±100% — penalty
    }
    c._composite = (c._score * 2) + priceAdj;
    c._price_distance_pct = target && c.price_numeric ? Math.abs(c.price_numeric - target) / target : null;
  }

  relevant.sort((a, b) => {
    if (b._composite !== a._composite) return b._composite - a._composite;
    // Tie-breaker: closer price wins
    if (a._price_distance_pct != null && b._price_distance_pct != null) {
      return a._price_distance_pct - b._price_distance_pct;
    }
    return 0;
  });

  // Count how many were "true" occasion matches before we cap.
  let occasionMatchCount = 0;
  if (occasion) {
    for (const c of relevant) {
      const text = `${c.product_name} ${c.description}`;
      if (occasion.re.test(text)) occasionMatchCount += 1;
    }
  }

  // Brand diversity — cap each brand at 2 results so one brand with many
  // matching SKUs doesn't crowd out the comparator list. Founders need to
  // see range, not a single brand's catalog dressed up as competition.
  // Two-pass: strict cap first; if we ended up with fewer than 4 results,
  // do a second pass that relaxes to 3 per brand (so the founder still
  // gets a usable comparator set when only 1–2 brands have matches).
  const out = [];
  const perBrandCount = new Map();
  const pickUpToCap = (cap) => {
    for (const c of relevant) {
      if (out.includes(c)) continue;
      const n = perBrandCount.get(c.brand) || 0;
      if (n >= cap) continue;
      perBrandCount.set(c.brand, n + 1);
      out.push(c);
      if (out.length >= 8) break;
    }
  };
  pickUpToCap(2);
  if (out.length < 4) pickUpToCap(3);
  // Tag each result with a relevance bucket so the UI / analyse prompt can
  // group them: "closest" for the top 3 by composite score, "related" for
  // 4–6, "context" for 7–8. Then strip internal scoring fields. For
  // hampers, attach an estimated item count so analyse.js can do honest
  // price-per-item math instead of comparing Adler's 2-item hamper to a
  // 5-item Theobroma hamper as if they were equivalent.
  for (let i = 0; i < out.length; i++) {
    const relevance = i < 3 ? 'closest' : i < 6 ? 'related' : 'context';
    const { _score, _composite, _price_distance_pct, ...rest } = out[i];
    const extras = { _relevance: relevance };
    if (productType === 'hamper') {
      extras._estimated_item_count = estimateHamperItemCount(rest.product_name, rest.description);
    }
    out[i] = { ...rest, ...extras };
  }
  console.log(`[search-competitors] Catalog search: ${candidates.length} candidates → ${typeFiltered.length} type-matched → ${out.length} returned (${occasionMatchCount} true occasion matches, brand-diverse)`);
  return { competitors: out, occasion, occasionMatchCount };
}

// ── SerpAPI search — fan out across 4 source tiers ─────────
// Runs one SerpAPI query per applicable tier (indian_premium, marketplaces,
// quick_commerce, international_luxury) in parallel, capped at MAX_TIER_CALLS
// to keep costs predictable. Each tier scopes its query with site: filters
// so results are pre-filtered to the right kind of source. If every scoped
// tier comes back empty, falls back to one broad-web query.
// Returns { competitors, query, callsMade }.
async function serpApiSearch(composition, productType, productPrice, apiKey, productClass = 'chocolate') {
  const MAX_TIER_CALLS = 4; // cost guardrail — never make more than this
  const baseQuery = buildSearchQuery(composition, productType, productPrice, productClass);
  const tierKeys  = tiersForPriceTier(getPriceTier(productPrice), productClass).slice(0, MAX_TIER_CALLS);
  // Google Shopping query — drop tier-label noise ("budget", "premium")
  // since the Shopping grid ranks by product relevance, not adjectives.
  const shoppingQuery = baseQuery.replace(/^\s*(budget|mid-range|premium|luxury)\s+/i, '').trim();
  console.log(`[search-competitors] SerpAPI fan-out: class=${productClass} base="${baseQuery}" tiers=[${tierKeys.join(', ')}] +shopping`);

  let callsMade = 0;

  // ── Google Shopping (primary, high-quality) ──
  // Fires in parallel with the tier organic calls. Returns the structured
  // product grid with real prices + merchant — the same results the founder
  // sees on shopping.google.com.
  callsMade += 1;
  const shoppingPromise = serpShopping(shoppingQuery, apiKey).catch(err => {
    console.warn(`[search-competitors] Google Shopping failed: ${err.message}`);
    return [];
  });

  const tierFetches = tierKeys.map(async (key) => {
    const domains = SERP_TIERS[key] || [];
    if (domains.length === 0) return [];
    const siteFilter = domains.map(d => `site:${d}`).join(' OR ');
    const q = `${baseQuery} (${siteFilter})`;
    callsMade += 1;
    try {
      return await serpOrganic(q, apiKey);
    } catch (err) {
      console.warn(`[search-competitors] SerpAPI tier "${key}" failed: ${err.message}`);
      return [];
    }
  });
  const [shoppingRaw, tierResults] = await Promise.all([shoppingPromise, Promise.all(tierFetches)]);
  let items = tierResults.flat();
  const shoppingCompetitors = normalizeShoppingResults(shoppingRaw, productType, productPrice, composition);

  // If every organic tier came back empty AND shopping gave nothing, one
  // final broad-web call so we never return zero on a novel product.
  let query = `${baseQuery}  [tiered: ${tierKeys.join('+')}+shopping]`;
  if (items.length === 0 && shoppingCompetitors.length === 0 && callsMade < MAX_TIER_CALLS + 2) {
    console.log('[search-competitors] All tiers + shopping empty — broad web fallback');
    callsMade += 1;
    items = await serpOrganic(baseQuery, apiKey).catch(() => []);
    query = `${baseQuery}  [broad fallback]`;
  }

  // Drop sitemaps / category / generic listing pages / non-commerce sites.
  // The non-commerce host list catches the dictionary + reference pages
  // that the broad-web fallback dredges up when nothing tier-scoped matches.
  const NON_COMMERCE_HOSTS = /(merriam-webster|dictionary|vocabulary|thesaurus|wikipedia|reddit|quora|medium\.com|wikihow|youtube|facebook|instagram|twitter|x\.com|linkedin|pinterest|coursera|udemy|investopedia|britannica|stackexchange|tripadvisor|yelp)\./i;
  items = items.filter(item => {
    const url = (item.link || '').toLowerCase();
    const title = (item.title || '').toLowerCase();
    const bannedUrlPatterns = ['/sitemap', '/collections/all', '/collections/cakes', '/pages/', '/category/', '/blog/', '/blogs/', '/article/', '/articles/', '/news/', '/journal/', 'search', '/account', '/cart'];
    if (bannedUrlPatterns.some(p => url.includes(p))) return false;
    if (url.includes('/collections/') && !url.includes('/products/')) return false;
    if (NON_COMMERCE_HOSTS.test(url)) return false;
    const bannedTitles = ['sitemap', 'products', 'shop', 'home', 'collection', 'all products'];
    if (bannedTitles.includes(title.trim())) return false;
    if (title.includes('order cakes online')) return false;
    // Title looks like a dictionary definition? Drop it.
    if (/\bdefinitions?\b|\bmeanings?\b|\bdefined\b|\bsynonyms?\b|^premium\s*$|^chocolate\s*$/.test(title)) return false;
    // Amazon/BigBasket category pages start with "Buy X Online at Best Price…"
    // or "Shop X Online" — these are listing pages, not specific products.
    if (/^buy\s+.+\bonline\b/i.test(title)) return false;
    if (/^shop\s+.+\bonline\b/i.test(title)) return false;
    if (/best\s*price\s*in\s*india/i.test(title)) return false;
    return true;
  });

  // Organic results still go through enrichment + the progressive filter.
  const enriched = items.length ? await parseAndEnrichResults(items) : [];
  const filteredOrganic = items.length ? filterCompetitors(enriched, productType, productPrice, composition) : [];

  // Merge: Google Shopping results first (they carry real prices + are
  // relevance-ranked by Google), then organic site-scoped results, deduped
  // by URL. Shopping is the better signal so it leads.
  const merged = [];
  const seen = new Set();
  for (const c of [...shoppingCompetitors, ...filteredOrganic]) {
    const key = (c.url || c.product_name || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!c._relevance) c._relevance = 'context';
    merged.push(c);
  }

  console.log(`[search-competitors] SerpAPI returned ${merged.length} competitors (${shoppingCompetitors.length} shopping + ${filteredOrganic.length} organic) across ${callsMade} calls`);
  return { competitors: merged, query, callsMade };
}

// ── Normalise Google Shopping results → competitor shape ───
// shopping_results carry { title, source (merchant), price, extracted_price,
// product_link/link, thumbnail }. We parse the real product brand from the
// title when possible (Cornitos, Nutty Gritties…), else use the merchant.
// Applies a light type filter so chocolate searches don't surface snacks
// and vice-versa, and drops obvious non-product noise.
function normalizeShoppingResults(results, productType, productPrice, composition) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const target = priceNumeric(productPrice);
  const HAMPER_TITLE_RE = /\b(hamper|gift\s*box|gift\s*set|gift\s*basket|gift\s*pack|combo|basket|gift\s*bag)\b/i;

  const out = [];
  for (const r of results) {
    const title = r.title || '';
    if (!title) continue;
    const url = r.product_link || r.link || null;
    if (!url) continue;

    // Light type filter: single-product searches drop hamper-titled grid
    // items; hamper searches keep only hamper/gift-titled ones.
    if (productType !== 'hamper' && HAMPER_TITLE_RE.test(title)) continue;
    if (productType === 'hamper' && !HAMPER_TITLE_RE.test(title) && !/\bgift\b/i.test(title)) continue;

    const priceNum = Number.isFinite(r.extracted_price) ? r.extracted_price : priceNumeric(r.price);
    const brandParsed = brandFromMarketplaceTitle(title);
    const merchantRaw = r.source || 'Google Shopping';
    const merchant = merchantRaw.replace(/\.(in|com|co)\b.*$/i, '').replace(/^www\./, '').trim();
    // Avoid "Cornitos · Cornitos" when the brand we parsed from the title is
    // also the merchant. Show the brand alone in that case.
    const sameBrandMerchant = brandParsed &&
      brandParsed.toLowerCase().replace(/\s+/g, '') === merchant.toLowerCase().replace(/\s+/g, '');
    const brand = brandParsed
      ? (sameBrandMerchant ? brandParsed : `${brandParsed} · ${merchant}`)
      : merchant;

    out.push({
      brand,
      product_name:     title,
      description:      r.snippet || title,
      url,
      price:            r.price || (priceNum ? `₹${priceNum.toLocaleString('en-IN')}` : 'N/A'),
      price_numeric:    priceNum ?? null,
      weight:           null,
      key_features:     [],
      thumbnail:        r.thumbnail || null,
      _enriched_source: 'google_shopping',
    });
  }

  // Rank by price proximity to the analysed product so the closest-priced
  // comparators lead. Shopping already relevance-ranks, so this is a gentle
  // re-order, not a hard sort.
  if (target) {
    out.sort((a, b) => {
      const da = a.price_numeric ? Math.abs(a.price_numeric - target) : Infinity;
      const db = b.price_numeric ? Math.abs(b.price_numeric - target) : Infinity;
      return da - db;
    });
  }

  // Cap shopping contribution at 6 so organic premium-brand results still
  // get a slot in the final 8.
  const capped = out.slice(0, 6);
  for (let i = 0; i < capped.length; i++) {
    capped[i]._relevance = i < 3 ? 'closest' : 'related';
  }
  return capped;
}

// ── SerpAPI call helper ────────────────────────────────────
// Returns the organic_results array (possibly empty) or throws.
async function serpOrganic(query, apiKey) {
  const searchUrl = new URL('https://serpapi.com/search');
  searchUrl.searchParams.set('engine', 'google');
  searchUrl.searchParams.set('api_key', apiKey);
  searchUrl.searchParams.set('q',       query);
  searchUrl.searchParams.set('num',     '10');
  searchUrl.searchParams.set('gl',      'in');   // country: India
  searchUrl.searchParams.set('hl',      'en');   // language: English
  searchUrl.searchParams.set('safe',    'active');
  searchUrl.searchParams.set('output',  'json');

  const data = await serpFetch(searchUrl.toString());
  return data.organic_results || [];
}

// ── Google Shopping search ─────────────────────────────────
// engine=google_shopping returns the structured product grid (the same one
// the founder sees on shopping.google.com): real product titles, prices,
// merchant source, and product links — far richer than organic blue links
// for both chocolate and snack products. Returns the raw shopping_results.
async function serpShopping(query, apiKey) {
  const searchUrl = new URL('https://serpapi.com/search');
  searchUrl.searchParams.set('engine',  'google_shopping');
  searchUrl.searchParams.set('api_key', apiKey);
  searchUrl.searchParams.set('q',       query);
  searchUrl.searchParams.set('gl',      'in');
  searchUrl.searchParams.set('hl',      'en');
  searchUrl.searchParams.set('output',  'json');

  const data = await serpFetch(searchUrl.toString());
  return data.shopping_results || [];
}

// Shared SerpAPI fetch with a 15s timeout and a single retry on transient
// failure (network blip / 5xx / rate-spike). Without this, one failed call
// returns zero competitors — fatal for snack products where SerpAPI is the
// only source (the snack brand catalogs don't carry the product).
async function serpFetch(url, attempt = 0) {
  const MAX_ATTEMPTS = 2;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`SerpAPI ${res.status}: ${err.error || res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt < MAX_ATTEMPTS - 1) {
      console.warn(`[search-competitors] SerpAPI fetch failed (${err.message}) — retrying once…`);
      await new Promise(r => setTimeout(r, 1200));
      return serpFetch(url, attempt + 1);
    }
    throw err;
  }
}

// ── Route handler ──────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { composition, productType, productPrice, productName, productCategory } = req.body || {};
  if (!composition || !productType) {
    return res.status(400).json({ error: 'composition and productType are required' });
  }

  // Detect whether this is a chocolate or snack product. Snack products
  // (Flavoured Nuts, Berries, Desserts) use a different brand pool +
  // search vocabulary — see SHOPIFY_SNACK_BRANDS / SERP_TIERS.indian_snacks.
  const productClass = detectProductClass(productCategory, composition);

  let query = '[catalog + serpapi]';
  let serpCallsMade = 0;
  try {
    // ── Run catalog + SerpAPI in PARALLEL ──
    // Catalog returns precise format-matched competitors from the 11
    // brand list. SerpAPI fans out across 4 source tiers (Indian premium,
    // marketplaces, quick-commerce, international luxury) to surface the
    // wider market. Merging both gives the founder a comparator set that
    // spans premium artisanal AND marketplace pricing in one view.
    const { SERP_API_KEY } = process.env;
    const [catalogResult, serpResult] = await Promise.all([
      catalogSearch(composition, productType, productPrice, productName, productCategory, productClass),
      SERP_API_KEY
        ? serpApiSearch(composition, productType, productPrice, SERP_API_KEY, productClass).catch(err => {
            console.warn('[search-competitors] SerpAPI failed:', err.message);
            return { competitors: [], query: '[serpapi failed]', callsMade: 0 };
          })
        : Promise.resolve({ competitors: [], query: '[no SERP_API_KEY]', callsMade: 0 }),
    ]);

    // Merge, deduping by URL AND by a normalised title key so near-identical
    // marketplace listings ("Rizz Alphonso Mango Bites" at ₹159 and ₹160 from
    // two sellers) collapse to one entry.
    const titleKey = (c) => String(c.product_name || '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    let competitors = [];
    const seen = new Set();
    const seenTitles = new Set();
    for (const c of [...catalogResult.competitors, ...serpResult.competitors]) {
      const tk = titleKey(c);
      if ((c.url && seen.has(c.url)) || (tk && seenTitles.has(tk))) continue;
      if (c.url) seen.add(c.url);
      if (tk) seenTitles.add(tk);
      competitors.push(c);
    }

    query        = serpResult.query || query;
    serpCallsMade = serpResult.callsMade || 0;
    const sourceNote = catalogResult.competitors.length && serpResult.competitors.length
      ? 'catalog+serpapi'
      : catalogResult.competitors.length
      ? 'shopify_catalog'
      : serpResult.competitors.length
      ? 'serpapi'
      : 'none';

    // Non-food items leak in when flavour words double as scent words —
    // "Coffee Beans For Fragrance" (air freshener) matched a filter-coffee
    // chocolate search. Applies to every product class.
    const NON_FOOD_TITLE_RE = /\b(fragrances?|air\s*fresheners?|diffusers?|candles?|tealights?|soaps?|perfumes?|room\s*spray|incense|essential\s*oils?|body\s*(?:wash|lotion|butter|scrub)|shampoo|wax\s*melts?|potpourri)\b/i;
    {
      const before = competitors.length;
      competitors = competitors.filter(c => !NON_FOOD_TITLE_RE.test(String(c.product_name || '')));
      if (competitors.length < before) {
        console.log(`[search-competitors] dropped ${before - competitors.length} non-food result(s)`);
      }
    }

    // Condiments are never comparators for Adler's snack SKUs (dried fruits,
    // flavoured nuts) — SerpAPI matches flavour words ("chilli") to pickles
    // and chutney powders. Titles like "Masala Guava" survive because the
    // regex requires the condiment noun itself, not the flavour adjective.
    if (productClass === 'snack') {
      const CONDIMENT_TITLE_RE = /\b(pickles?|achaa?r|chutney|podi|masala\s*(powder|paste)|spice\s*(mix|powder|blend)|seasonings?|sauces?|ketchup|dips?|papad)\b/i;
      const before = competitors.length;
      competitors = competitors.filter(c => !CONDIMENT_TITLE_RE.test(String(c.product_name || '')));
      if (competitors.length < before) {
        console.log(`[search-competitors] dropped ${before - competitors.length} condiment result(s) for snack product`);
      }
    }

    // ── Final relevance re-rank (source-agnostic) ──
    // A competitor sharing the product's DISTINCTIVE descriptor (mango,
    // black currant, orange…) is more relevant than one that only shares
    // the format (bites/nibbles) or the brand catalog. Previously catalog
    // results always led, so for a "Mango Bites" product the founder saw
    // sugar-free hazelnut nibbles up top and the real mango competitors
    // buried or dropped. Re-rank the whole merged pool by descriptor overlap
    // (title-weighted), keeping the prior order as a stable tiebreak. Skip
    // for hampers (their relevance is occasion/curation, handled in catalog).
    if (productType !== 'hamper') {
      const tokens = distinctiveTokens(composition);
      if (tokens.length) {
        competitors = competitors
          .map((c, i) => ({ c, i, s: descriptorOverlap(c, tokens) }))
          .sort((a, b) => (b.s - a.s) || (a.i - b.i))
          .map(x => x.c);
      }
    }

    // Cap at 8.
    competitors = competitors.slice(0, 8);

    // Re-tag relevance by FINAL position so the badges match the order the
    // founder actually sees (top 3 closest, 4–6 related, rest context).
    for (let i = 0; i < competitors.length; i++) {
      competitors[i]._relevance = i < 3 ? 'closest' : i < 6 ? 'related' : 'context';
      // Catalog results already carry an estimated item count; SerpAPI ones
      // don't, so a "Pack of 20" combo was being priced as one item in the
      // hamper per-item math. Estimate for any competitor that lacks it.
      if (productType === 'hamper' && !Number.isFinite(competitors[i]._estimated_item_count)) {
        competitors[i]._estimated_item_count = estimateHamperItemCount(competitors[i].product_name, competitors[i].description);
      }
    }

    // ── Occasion-match summary ──
    // Lets the UI warn the founder when we detected (say) Diwali but the
    // competitor brands don't stock a Diwali-named hamper — so they don't
    // mistake the Mother's Day fillers for real Diwali comparators.
    const detectedOccasion = catalogResult.occasion?.occasion || null;
    const occasionMatchCount = catalogResult.occasionMatchCount || 0;
    const occasion_match = detectedOccasion
      ? {
          detected:     detectedOccasion,
          found_count:  occasionMatchCount,
          sufficient:   occasionMatchCount >= 2,
        }
      : null;

    return res.status(200).json({
      competitors,
      search_quality:  competitors.length >= 4 ? 'high' : competitors.length >= 2 ? 'medium' : 'low',
      query_used:      query,
      occasion_match,
      product_class:   productClass,
      serp_calls_made: serpCallsMade,
      _source:         sourceNote,
    });
  } catch (err) {
    console.error('[search-competitors] Error:', err.message);
    return res.status(200).json({
      competitors:    [],
      search_quality: 'error',
      query_used:     query,
      _note:          err.message,
    });
  }
}
