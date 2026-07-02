// ──────────────────────────────────────────────────────────
// D4 — POST /api/analyse
// E1: Separate prompts for hamper vs single chocolate
// E2: "Never suggest what already exists" guard
// E3: Per-section confidence scoring on all 4 sections
// ──────────────────────────────────────────────────────────

import { callAI } from './_ai.js';

const KNOWN_BRANDS = [
  'Smoor', 'Paul & Mike', 'Mason & Co', 'Entisi', 'Kocoatrait',
  'Naviluna', 'Manam Chocolate', 'Pascati', 'Earth Loaf', 'Bon Fiction',
  'Zoroy', 'Theobroma',
];

// Maps the extracted `format` to a plural display noun used throughout the
// single-product prompt, so a rocher/truffle/bark is framed as itself rather
// than as a generic "bar".
const SINGLE_FORMAT_NOUN = {
  bar: 'bar', rocher: 'rochers', truffle: 'truffles', praline: 'pralines',
  bonbon: 'bonbons', dragees: 'dragees', barks: 'bark', coated_nuts: 'coated nuts',
  cluster: 'clusters', bites: 'bites', gianduja: 'gianduja', spread: 'spread',
};
function singleProductNoun(format) {
  if (!format) return 'chocolate product';
  return SINGLE_FORMAT_NOUN[String(format).toLowerCase()] || 'chocolate product';
}

// Strings fetch-product returns when WooCommerce + scrapers can't surface a price.
// Anything else (e.g. "₹1,299") is treated as a real price.
function priceIsKnown(price) {
  if (!price || typeof price !== 'string') return false;
  const p = price.trim();
  if (!p) return false;
  if (p === 'Price not available' || p === 'Price not set') return false;
  return /\d/.test(p); // must contain at least one digit
}

// Parse the numeric price from a display string. Variable products carry a
// RANGE ("₹275 – ₹428") — stripping every non-digit would concatenate the two
// numbers into 275428, so instead take the FIRST number (the range floor,
// which is the most conservative basis for per-gram / per-item math).
function firstPriceNumber(price) {
  if (!price || typeof price !== 'string') return null;
  const m = price.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Parse a weight in grams from a competitor title/description. Many
// marketplace + Shopping titles embed it: "Cornitos … 200 G",
// "TopNut … 100gm", "1kg pack". Returns grams (10–5000) or null. Lets the
// single-product analyst compute a real price-per-gram instead of comparing
// raw pack totals of different sizes.
function parseWeightGrams(text) {
  if (!text) return null;
  const s = String(text);
  const kg = s.match(/\b(\d+(?:\.\d+)?)\s*kg\b/i);
  if (kg) {
    const n = Math.round(parseFloat(kg[1]) * 1000);
    if (n >= 10 && n <= 5000) return n;
  }
  const g = s.match(/\b(\d{2,4})\s*(?:g|gm|gms|gram|grams)\b/i);
  if (g) {
    const n = parseInt(g[1], 10);
    if (n >= 10 && n <= 5000) return n;
  }
  return null;
}

// Adler's own weight for a single product — prefer the explicit grams, else
// the smallest pack option. Returns a number or null.
function singleWeightGrams(composition, productData) {
  if (Number.isFinite(composition.weight_grams)) return composition.weight_grams;
  const packs = (composition.pack_options || []).filter(p => p && Number.isFinite(p.weight_grams));
  if (packs.length) return packs.reduce((m, p) => Math.min(m, p.weight_grams), packs[0].weight_grams);
  return parseWeightGrams(productData.weight) || null;
}

// ── E2: Extract existing attributes as flat checklist ──────
// Gives Groq a concrete list to cross-reference instead of
// parsing nested JSON — prevents "suggest what already exists" bug

function extractExistingAttributes(composition, productType) {
  if (productType === 'hamper') {
    return [
      ...(composition.chocolate_types_present || []),
      composition.packaging_quality     ? `${composition.packaging_quality} packaging` : null,
      ...(composition.occasion_fit || []).map(o => o.replace('_', ' ')),
      composition.has_non_chocolate_items ? 'non_chocolate_items included' : null,
    ].filter(Boolean);
  }

  // single_chocolate
  const dietary = composition.dietary || {};
  return [
    composition.chocolate_type,
    composition.is_bean_to_bar   ? 'bean_to_bar'    : null,
    composition.is_indian_origin ? 'indian_origin'   : null,
    dietary.vegan                ? 'vegan'           : null,
    dietary.gluten_free          ? 'gluten_free'     : null,
    dietary.sugar_free           ? 'sugar_free'      : null,
    dietary.dairy_free           ? 'dairy_free'      : null,
    dietary.soy_free             ? 'soy_free'        : null,
    ...(composition.certifications || []),
    composition.processing_method || null,
    composition.quality_tier       || null,
    composition.origin_region      || null,
    composition.origin_country     || null,
  ].filter(Boolean);
}

// Mirror of extractExistingAttributes: lists every composition field that
// is null / empty in the input. The analyst prompt embeds this as a
// "DO NOT call these weaknesses" block so the model can't accidentally
// confuse extraction gaps with product gaps (which it kept doing despite
// the system-prompt rule alone).
// Compact "Evidence Pool" used by the analyst prompts: a one-line summary of
// each top competitor's distinctive strength, drawn from the live product
// title + description. Forces the model to anchor recommendations to a
// concrete competitor instead of producing template phrases. Kept short
// (≤6 entries) to stay within the prompt budget.
function buildCompetitorEvidence(competitors) {
  if (!Array.isArray(competitors) || competitors.length === 0) return null;
  const STRENGTH_PATTERNS = [
    // Chocolate-specific strengths
    { re: /heavy.?metals?\s*tested/i,            label: 'heavy-metals tested' },
    { re: /no\s*added\s*sugar|sugar.?free/i,     label: 'no added sugar' },
    { re: /bean.?to.?bar/i,                      label: 'bean-to-bar' },
    { re: /single.?origin/i,                     label: 'single-origin' },
    { re: /\b(\d{2,3})\s*%\s*(dark|cocoa|cacao)/i, label: 'high-cocoa-% positioning' },
    { re: /kerala|south\s*indian|indian\s*(cocoa|cacao|beans)/i, label: 'Indian-origin cocoa' },
    // Cross-category strengths (chocolate AND snack)
    { re: /vegan/i,                              label: 'vegan' },
    { re: /gluten.?free/i,                       label: 'gluten-free' },
    { re: /organic/i,                            label: 'organic' },
    { re: /fair[- ]?trade/i,                     label: 'fair-trade' },
    { re: /eco.?friendly|sustainable|plastic.?free/i, label: 'eco-friendly packaging' },
    { re: /gift\s*(box|hamper|basket|set)/i,     label: 'gifting-first packaging' },
    { re: /handcrafted|artisanal|small.?batch/i, label: 'artisanal positioning' },
    // Snack-specific strengths (Happilo / Open Secret / Whole Truth language)
    { re: /no\s*preservatives?|preservative.?free/i, label: 'no preservatives' },
    { re: /no\s*added\s*oil|oil.?free/i,         label: 'no added oil' },
    { re: /protein.?rich|high.?protein/i,        label: 'high-protein positioning' },
    { re: /roasted|oven.?roasted/i,              label: 'roasted (not fried)' },
    { re: /baked.?not.?fried/i,                  label: 'baked-not-fried' },
    { re: /keto|low.?carb/i,                     label: 'keto / low-carb' },
    { re: /\bclean\s*label\b/i,                  label: 'clean-label' },
    { re: /\b(himalayan|rock|sea)\s*salt\b/i,    label: 'premium-salt positioning' },
  ];
  const lines = [];
  for (const c of competitors.slice(0, 6)) {
    const text = `${c.product_name || ''} ${c.description || ''}`;
    const strengths = STRENGTH_PATTERNS.filter(p => p.re.test(text)).map(p => p.label);
    const priceBit  = c.price && c.price !== 'N/A' ? ` at ${c.price}` : '';
    const top = strengths.slice(0, 3).join(', ') || 'no distinctive marker extracted';
    lines.push(`- ${c.brand || 'Unknown'}: "${(c.product_name || '').slice(0, 60)}"${priceBit} — ${top}`);
  }
  return lines.join('\n');
}

function extractMissingAttributes(composition, productType) {
  if (productType === 'hamper') {
    const missing = [];
    if (!composition.items?.length)             missing.push('itemised contents list');
    if (composition.total_weight_grams == null) missing.push('total weight');
    if (!composition.packaging_quality)         missing.push('packaging quality grade');
    if (!composition.occasion_fit?.length)      missing.push('occasion fit tags');
    if (!composition.chocolate_types_present?.length) missing.push('chocolate types present');
    return missing;
  }
  const dietary = composition.dietary || {};
  const missing = [];
  if (!composition.cocoa_percentage)  missing.push('cocoa percentage');
  if (!composition.origin_region && !composition.origin_country) missing.push('origin provenance');
  if (composition.is_bean_to_bar == null) missing.push('bean-to-bar credential');
  if (!composition.ingredients?.length)   missing.push('ingredient list');
  if (!composition.key_flavour_notes?.length) missing.push('flavour notes');
  if (!composition.weight_grams)              missing.push('weight in grams');
  if (!composition.processing_method)         missing.push('processing method');
  if (!composition.certifications?.length)    missing.push('certifications');
  if (Object.values(dietary).every(v => v == null)) missing.push('dietary attributes');
  return missing;
}

// ── Shared system prompt ───────────────────────────────────

function buildAnalysisSystem() {
  return `You are a senior product strategist at a premium Indian chocolate and gifting company.
You provide rigorous, specific, and actionable competitive intelligence.
You have deep knowledge of the Indian premium chocolate market including all major craft and artisanal brands.

Rules:
- Be specific — reference actual composition details, actual competitor names, actual price points
- NEVER suggest improvements that are listed under "Already Present in This Product"
- Do NOT use vague language like "consider adding" without specifying what and why
- Ground every insight in the composition data or competitor intelligence provided
- Be concise — each point should be immediately actionable by the founder
- You MUST respond with valid JSON only — no markdown, no preamble outside the JSON

Anchoring rule (CRITICAL — non-negotiable):
Each improvement and each market_gap MUST be anchored to at least ONE of:
  (a) a specific composition gap this product has (e.g. "no white-chocolate variant when 3 of the top 5 competitors offer one")
  (b) a specific competitor strength this product lacks (cite the competitor by name and the strength)
  (c) a specific occasion, dietary segment, or buyer segment named in the product or category
Recommendations that could apply to "any chocolate product" are forbidden. If you cannot anchor a recommendation, omit it.

Banned generic phrases (do not use unless the product data explicitly motivates them with a named anchor):
  "Corporate Bulk Orders", "Premium Festive Tiers", "Premium Packaging Options",
  "New Flavour Extensions", "Dietary-Specific Versions", "Gifting Presentation Options",
  "Sourcing Upgrades", "Expand Variety", "Add More Chocolate Formats".
If you want to suggest any of these themes, you MUST rewrite the title and description so they name (a) the specific competitor you're countering, (b) the specific format/flavour/segment being added, and (c) why this product is well-positioned to do it. A generic version is worse than omitting the item.

Missing data rule (CRITICAL — non-negotiable):
- Null/empty composition fields = OUR extractor missed them. NOT a product gap.
- Do not name a missing field anywhere in the output — not in weaknesses, not in notes, not in improvements, not in market_gaps, not in the executive_summary. Any mention of "absence of", "lack of", "unclear", "unknown", "missing", "no information on", "no data on", "details unavailable" referring to a composition field is forbidden.
- BAD (forbidden): "Lack of cocoa percentage", "Unclear origin provenance", "Missing dietary attributes", "absence of detailed composition data hinders…", "No clarity on bean-to-bar".
- GOOD (allowed): silently skip the insight, set the section's confidence to "low", and write data_basis: "composition data was incomplete" if needed.
- A real weakness must have POSITIVE evidence (e.g. a competitor has X, this product explicitly does not).
- The "Data We Could NOT Extract" block in the user message lists exactly which fields to avoid mentioning. Treat that list as a hard banlist.`;
}

// ── E1 + E2 + E3: Hamper analysis prompt ──────────────────

function buildHamperAnalysisUser(productData, composition, competitors) {
  const existingAttributes = extractExistingAttributes(composition, 'hamper');
  const missingAttributes  = extractMissingAttributes(composition, 'hamper');
  const hasCompetitors     = competitors && competitors.length > 0;
  const validPricesCount   = hasCompetitors ? competitors.filter(c => c.price_numeric > 0).length : 0;
  const hasPrice           = priceIsKnown(productData.price);

  const competitorSection = hasCompetitors
    ? `## Live Competitor Data (from Google Search)\n${JSON.stringify(competitors, null, 2)}\n(Note: Only ${validPricesCount} of these competitors have known numeric prices.)`
    : `## Competitor Data\nNo live search results. Use your knowledge of these Indian premium chocolate brands:\n${KNOWN_BRANDS.join(', ')}`;

  const missingBlock = missingAttributes.length
    ? `\n## Data We Could NOT Extract (DO NOT call these product weaknesses)
The following composition fields were missing from our source data. They describe an extraction failure, NOT a product gap. If you mention any of these as a "weakness" or "area to improve", your output will be rejected.
${missingAttributes.map(a => `- ${a}`).join('\n')}

BAD example (do not write this): "Lack of ${missingAttributes[0]} hinders comparison"
GOOD example (do write this if applicable): mark the relevant insight with confidence "low" and skip it, or note in data_basis that "composition data was incomplete".\n`
    : '';

  const itemCount = Array.isArray(composition.items) ? composition.items.length : null;
  const evidence  = buildCompetitorEvidence(competitors);
  const evidenceBlock = evidence
    ? `\n## Evidence Pool (anchor every recommendation to one of these)
Each line lists a competitor and a distinct strength their product carries that you should reference when making a recommendation. Improvements/market_gaps MUST cite at least one of these competitors by name OR a specific composition gap of the product (no generic "expand variety" suggestions).
${evidence}
`
    : '';

  // Per-item table — give the model the real math for each competitor
  // hamper so it can compare value honestly (not just total price). The
  // search step estimates competitor item counts via name/description
  // heuristics; we surface them here together with our exact item count.
  const adlerPriceNum = hasPrice ? firstPriceNumber(productData.price) : null;
  const perItemRows = (competitors || []).slice(0, 6).map(c => {
    const cnt = Number(c._estimated_item_count) || 1;
    const ppi = c.price_numeric ? Math.round(c.price_numeric / cnt) : null;
    return `- ${c.brand || 'Unknown'} "${(c.product_name || '').slice(0, 50)}" — ${c.price || '—'} ÷ ~${cnt} items ≈ ${ppi ? `₹${ppi}` : '—'}/item`;
  });
  const perItemBlock = (adlerPriceNum && itemCount && perItemRows.length)
    ? `\n## Per-Item Math (use this for the pricing verdict)
Adler's: ${productData.price} ÷ ${itemCount} items ≈ ₹${Math.round(adlerPriceNum / itemCount)}/item
${perItemRows.join('\n')}

RULE: the pricing verdict MUST reflect price-per-item, not total hamper price. A hamper that is cheaper in total but carries half the items is NOT competitive. State the math explicitly in the analysis.
`
    : '';

  return `You are analysing this Adler's Den GIFT HAMPER against the Indian premium gifting market.

## Product Being Analysed
Name: ${productData.name}
Price: ${productData.price}
Category: ${productData.category}
Weight: ${productData.weight ? `${productData.weight}g` : 'not specified'}
Item count: ${itemCount != null ? itemCount : 'not specified'}

## Composition Profile
${JSON.stringify(composition, null, 2)}

## Already Present in This Product (DO NOT suggest adding any of these)
${existingAttributes.map(a => `- ${a}`).join('\n')}
${missingBlock}
${competitorSection}
${evidenceBlock}${perItemBlock}
## Your Task — Gift Hamper Analysis
Evaluate this hamper on:
- PRICING: ${hasPrice ? `Use PRICE-PER-ITEM (total price ÷ item count${adlerPriceNum && itemCount ? ` = ₹${Math.round(adlerPriceNum / itemCount)}/item across ${itemCount} items` : ''}) and overall positioning vs competitor hampers at similar price points. COMPANY RULE: do NOT use price-per-gram for hampers and do NOT mention weight data — judge value by item count, content variety, and packaging quality. Is the price justified on those terms?` : 'The exact price is UNAVAILABLE. You MUST set the verdict to exactly "Unavailable" and the analysis to a single sentence explaining the price could not be extracted. Do NOT invent a price range. Set confidence to "low" and recommended_price_range to null.'}
- COMPOSITION: Curation breadth (how many chocolate types/formats), variety of flavours, inclusion of non-chocolate items, packaging quality vs competitors
- IMPROVEMENTS: Concrete additions or changes NOT already present. Each improvement must name (a) the competitor whose strength you are countering, or (b) the specific composition gap you are filling. Do not write recipe-card recommendations.
- MARKET GAPS: A specific gifting segment, occasion, or buyer this exact hamper composition could own — anchored to a real signal in the product (Diwali-specific corporate orders, vegan festive hampers, etc.). Each gap must be defensible from the product's existing strengths.

Competitor framing: Which competitor hampers offer more items, more variety, or better packaging at this price? Where is Adler's Den uniquely positioned? (Compare on items/variety/positioning — never on weight or price-per-gram.)

Respond ONLY with this JSON (fill every field, confidence reflects how much live data you have):
{
  "executive_summary": "2-3 sentences: overall competitive position as a gift hamper, key finding, primary recommendation. Do NOT mention missing weight or any missing data.",
  "overall_confidence": "high | medium | low",
  "pricing_verdict": {
    "verdict": "${hasPrice ? 'Overpriced | Competitive | Underpriced | Fair' : 'Unavailable'}",
    "analysis": "2-3 specific sentences using price-per-item and content/packaging justification (NO weight, NO price-per-gram). Cite at least one competitor's price-per-item from the Per-Item Math block by name.",
    "confidence": "high | medium | low",
    "recommended_price_range": "₹X,XXX–₹X,XXX (always provide this range if price is known, even if Competitive)${hasPrice ? '' : ' — MUST be null when verdict is Unavailable'}",
    "price_per_item":          ${adlerPriceNum && itemCount ? Math.round(adlerPriceNum / itemCount) : 'null'},
    "competitor_price_per_item_range": "₹X–₹Y (the per-item floor and ceiling across the top competitor hampers; null if no per-item data available)"
  },
  "composition_quality": {
    "rating": "Excellent | Good | Average | Below Average",
    "strengths": ["specific strength from actual composition", "strength 2", "strength 3"],
    "weaknesses": ["specific gap 1", "gap 2"],
    "confidence": "high | medium | low",
    "notes": "any additional strategic context about hamper positioning"
  },
  "improvements": [
    {
      "title": "short actionable title",
      "description": "specific recommendation with rationale — must NOT already exist in the product",
      "priority": "high | medium | low",
      "impact": "expected business or product impact",
      "confidence": "high | medium | low"
    }
  ],
  "market_gaps": [
    {
      "gap": "name of the gap/opportunity",
      "opportunity": "specific description of the gifting market opportunity in India",
      "confidence": "high | medium | low"
    }
  ],
  "market_gaps_confidence": "high | medium | low"
}`;
}

// ── E1 + E2 + E3: Single chocolate analysis prompt ─────────

function buildSingleChocolateAnalysisUser(productData, composition, competitors) {
  const existingAttributes = extractExistingAttributes(composition, 'single_chocolate');
  const missingAttributes  = extractMissingAttributes(composition, 'single_chocolate');
  const hasCompetitors     = competitors && competitors.length > 0;
  const validPricesCount   = hasCompetitors ? competitors.filter(c => c.price_numeric > 0).length : 0;
  const hasPrice           = priceIsKnown(productData.price);

  const competitorSection = hasCompetitors
    ? `## Live Competitor Data (from Google Search)\n${JSON.stringify(competitors, null, 2)}\n(Note: Only ${validPricesCount} of these competitors have known numeric prices.)`
    : `## Competitor Data\nNo live search results. Use your knowledge of these Indian premium chocolate brands:\n${KNOWN_BRANDS.join(', ')}`;

  const missingBlock = missingAttributes.length
    ? `\n## Data We Could NOT Extract (DO NOT call these product weaknesses)
The following composition fields were missing from our source data. They describe an extraction failure, NOT a product gap. If you mention any of these as a "weakness" or "area to improve", your output will be rejected.
${missingAttributes.map(a => `- ${a}`).join('\n')}

BAD example (do not write this): "Lack of ${missingAttributes[0]} hinders comparison"
GOOD example (do write this if applicable): mark the relevant insight with confidence "low" and skip it, or note in data_basis that "composition data was incomplete".\n`
    : '';

  const weightHint = productData.weight
    || (Array.isArray(composition.weight_grams) ? composition.weight_grams.map(w => `${w}g`).join(' / ') : composition.weight_grams);

  // Format-aware noun so a rocher/truffle/bark is never framed as a "bar".
  const productNoun = singleProductNoun(composition.format);

  // Fix #3 — real pack prices. If the product sells in multiple packs
  // (e.g. ₹259/65g pouch, ₹389/100g jar), surface them so the analyst
  // prices against what customers actually pay, not just the WC base price.
  const packOptions = Array.isArray(composition.pack_options) ? composition.pack_options.filter(p => p && p.price_numeric) : [];
  const packLine = packOptions.length
    ? `\nPack options (what customers actually pay): ${packOptions.map(p => `₹${p.price_numeric}${p.weight_grams ? ` for ${p.weight_grams}g` : ''}${p.label ? ` (${p.label})` : ''}`).join(', ')}`
    : '';

  const evidence  = buildCompetitorEvidence(competitors);
  const evidenceBlock = evidence
    ? `\n## Evidence Pool (anchor every recommendation to one of these)
Each line lists a competitor and a distinct strength their ${productNoun} (or close equivalent) carries that you should reference when making a recommendation. Improvements/market_gaps MUST cite at least one of these competitors by name OR a specific composition gap of the product (no generic "expand variety" or "introduce new flavour extensions" suggestions).
${evidence}
`
    : '';

  // ── Price-per-gram table ──
  // Compute Adler's ₹/g and each competitor's ₹/g (weight parsed from their
  // title/description when not already provided). This stops the analyst
  // calling the product "higher priced" off raw pack totals when, per gram,
  // it may actually be mid-pack or a value. Only shown when Adler's weight
  // is known AND at least one competitor weight could be determined.
  const adlerWeight = singleWeightGrams(composition, productData);
  const adlerPriceForPpg = (() => {
    if (packOptions.length) {
      const p = packOptions.find(o => o.weight_grams === adlerWeight) || packOptions[0];
      return p.price_numeric;
    }
    return firstPriceNumber(productData.price);
  })();
  // Sanity ceiling: even luxury chocolate stays under ~₹50/g in this market.
  // A ₹/g above 100 means the price or weight parse went wrong — better to
  // omit the per-gram math entirely than to feed the analyst a bad number.
  const adlerPpg = (adlerWeight && adlerPriceForPpg) ? adlerPriceForPpg / adlerWeight : null;
  const ppgSane  = adlerPpg != null && adlerPpg > 0 && adlerPpg <= 100;
  let perGramBlock = '';
  if (hasPrice && ppgSane) {
    const rows = [];
    for (const c of (competitors || []).slice(0, 6)) {
      const w = (Number.isFinite(c.weight_grams) && c.weight_grams) ? c.weight_grams
        : parseWeightGrams(c.weight)
        || parseWeightGrams(c.product_name)
        || parseWeightGrams(c.description);
      if (w && c.price_numeric > 0) {
        rows.push(`- ${c.brand} "${(c.product_name || '').slice(0, 48)}": ₹${c.price_numeric} ÷ ${w}g ≈ ₹${(c.price_numeric / w).toFixed(2)}/g`);
      }
    }
    if (rows.length) {
      perGramBlock = `\n## Price-Per-Gram Math (use THIS for the pricing verdict)
Adler's: ₹${adlerPriceForPpg} ÷ ${adlerWeight}g ≈ ₹${adlerPpg.toFixed(2)}/g
${rows.join('\n')}

RULE: judge price competitiveness on ₹/g, not raw pack totals. A competitor with a lower total price but a much larger pack may be MORE expensive per gram — do not call Adler's "higher priced" unless its ₹/g is genuinely higher. State the ₹/g comparison explicitly.
`;
    }
  }

  return `You are analysing this Adler's Den ${productNoun.toUpperCase()} (a chocolate product) against the Indian premium artisanal chocolate market.

## Product Being Analysed
Name: ${productData.name}
Price: ${productData.price}${packLine}
Category: ${productData.category}
Product format: ${composition.format || 'unspecified'} (compare ONLY against similar ${productNoun} — NOT against plain chocolate bars unless this IS a bar)
Weight: ${weightHint ? (typeof weightHint === 'number' ? `${weightHint}g` : weightHint) : 'not specified'}

## Composition Profile
${JSON.stringify(composition, null, 2)}

## Already Present in This Product (DO NOT suggest adding any of these)
${existingAttributes.map(a => `- ${a}`).join('\n')}
${missingBlock}
${competitorSection}
${evidenceBlock}${perGramBlock}
## Your Task — Analysis of this ${productNoun}
This product is a ${productNoun}. Frame every insight around that format — do not treat it as a plain chocolate bar.
Evaluate this product on:
- PRICING: ${hasPrice ? `${packOptions.length ? 'Use the pack-option prices above (the real prices customers pay) for the verdict. ' : ''}${perGramBlock ? 'Use the Price-Per-Gram Math block above as the basis for the verdict — compare ₹/g, NOT raw pack totals. ' : 'If weight is known, compare price-per-gram vs comparable ${productNoun} with actual numbers; otherwise compare on price-per-pack and positioning — do NOT mention that weight is missing. '}Is this ${productNoun} competitively priced for its quality and ingredients?` : 'The exact price is UNAVAILABLE. You MUST set the verdict to exactly "Unavailable" and the analysis to a single sentence explaining the price could not be extracted. Do NOT invent a price range. Set confidence to "low" and recommended_price_range to null.'}
- COMPOSITION: Ingredient quality, flavour combination, chocolate quality, dietary attributes, and how the ${productNoun} compares to competitor ${productNoun}
- IMPROVEMENTS: Concrete changes NOT already present that make sense for THIS specific ${productNoun}. Each improvement must name (a) the competitor whose strength you are countering (cite by brand), or (b) the specific composition gap you are filling (cite the field/ingredient). Do not write recipe-card recommendations that could apply to any chocolate product.
- MARKET GAPS: A specific niche this exact ${productNoun} composition could defend — anchored to a real signal in the product (a unique ingredient pairing, an unserved dietary segment, a specific occasion the name implies). Each gap must be defensible from a real strength the product already has.

Competitor framing: Which competitor ${productNoun} (or closest equivalent confections) match or exceed this on ingredient quality, flavour, or value? Where does Adler's Den have a defensible edge?

Respond ONLY with this JSON (fill every field, confidence reflects how much live data you have):
{
  "executive_summary": "2-3 sentences: overall competitive position of this ${productNoun}, key finding, primary recommendation. Do NOT mention missing weight or any missing data.",
  "overall_confidence": "high | medium | low",
  "pricing_verdict": {
    "verdict": "${hasPrice ? 'Overpriced | Competitive | Underpriced | Fair' : 'Unavailable'}",
    "analysis": "2-3 specific sentences on price competitiveness.${perGramBlock ? ' Quote the product per-gram price and at least one competitor per-gram price from the Price-Per-Gram Math block, and make the verdict consistent with that comparison.' : ' Use pack-option prices if given; never mention missing weight.'}",
    "confidence": "high | medium | low",
    "recommended_price_range": "₹X,XXX–₹X,XXX (always provide this range if price is known, even if Competitive)${hasPrice ? '' : ' — MUST be null when verdict is Unavailable'}",
    "price_per_gram": ${hasPrice && ppgSane ? adlerPpg.toFixed(2) : 'null'}
  },
  "composition_quality": {
    "rating": "Excellent | Good | Average | Below Average",
    "strengths": ["specific strength from actual composition", "strength 2", "strength 3"],
    "weaknesses": ["specific gap 1", "gap 2"],
    "confidence": "high | medium | low",
    "notes": "any additional strategic context about this ${productNoun}'s positioning"
  },
  "improvements": [
    {
      "title": "short actionable title",
      "description": "specific recommendation with rationale — must NOT already exist in the product",
      "priority": "high | medium | low",
      "impact": "expected business or product impact",
      "confidence": "high | medium | low"
    }
  ],
  "market_gaps": [
    {
      "gap": "name of the gap/opportunity",
      "opportunity": "specific description of the artisanal bar market opportunity in India",
      "confidence": "high | medium | low"
    }
  ],
  "market_gaps_confidence": "high | medium | low"
}`;
}

// ── Route handler ──────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productData, productType, composition, competitors, isConcept } = req.body || {};
  if (!productData || !productType || !composition) {
    return res.status(400).json({ error: 'productData, productType, and composition are required' });
  }

  // E1: Route to the correct prompt builder
  const builtUser = productType === 'hamper'
    ? buildHamperAnalysisUser(productData, composition, competitors || [])
    : buildSingleChocolateAnalysisUser(productData, composition, competitors || []);

  // Concept Product mode — prepend a framing note so recommendations read
  // as "if you launched this" positioning advice rather than commentary on
  // a live SKU. Same JSON shape downstream so the report renders unchanged.
  const userPrompt = isConcept
    ? `## Concept Product (not yet launched)
This product is a CONCEPT that the founder is considering building. Frame every recommendation as positioning advice: "if you launch this, here's what you'd compete with, here's where you'd win, here's what you should change before shipping". Do NOT review the product as if it exists. Composition fields that look thin reflect the brief being early-stage, not a product gap — guide the founder on what to add.

${builtUser}`
    : builtUser;

  try {
    const report = await callAI({
      system:    buildAnalysisSystem(),
      user:      userPrompt,
      maxTokens: 2500,
      label:     `${productType}-analyst`,
    });

    // If the original product price was missing, coerce the verdict — the
    // analyst is instructed to do this but we enforce it server-side so the
    // founder never sees "Fair" / "Competitive" against a missing price.
    const hasPrice = priceIsKnown(productData.price);
    const rawPricing = report.pricing_verdict || {};
    const pricing_verdict = hasPrice
      ? {
          verdict:                 rawPricing.verdict                || 'Competitive',
          analysis:                rawPricing.analysis               || 'Insufficient data for detailed pricing analysis.',
          confidence:              rawPricing.confidence             || 'low',
          recommended_price_range: rawPricing.recommended_price_range || null,
          // Carry through the structured per-unit fields so the UI badge can
          // render them (hamper price-per-item, single-product price-per-gram).
          price_per_item:                  rawPricing.price_per_item ?? null,
          competitor_price_per_item_range: rawPricing.competitor_price_per_item_range ?? null,
          price_per_gram:                  rawPricing.price_per_gram ?? null,
        }
      : {
          verdict:                 'Unavailable',
          analysis:                "The product price could not be extracted from the source page, so a pricing verdict cannot be issued. Re-run after fixing the upstream fetch, or check the product manually on adlersden.com.",
          confidence:              'low',
          recommended_price_range: null,
        };

    // TIER 1 FIX: If we have fewer than 2 valid competitor prices, any "Overpriced" or "Underpriced" verdict is unreliable.
    const validPricesCount = competitors ? competitors.filter(c => c.price_numeric > 0).length : 0;
    if (hasPrice && validPricesCount < 2 && (pricing_verdict.verdict === 'Overpriced' || pricing_verdict.verdict === 'Underpriced')) {
      pricing_verdict.confidence = 'low';
      pricing_verdict.analysis += ' (Note: This verdict is low confidence due to a lack of live competitor pricing data.)';
    }

    // TIER 1 FIX: Clean string "null" or "N/A"
    if (pricing_verdict.recommended_price_range === 'null' || pricing_verdict.recommended_price_range === 'N/A' || pricing_verdict.recommended_price_range === '') {
      pricing_verdict.recommended_price_range = null;
    }

    // TIER 1 FIX: strip "missing data is a weakness" phrasings the model
    // still leaks despite the prompt ban-list. A weakness/note is dropped
    // only when a gap-word (lack/limited/missing/…) sits near a
    // data-word (information/detail/data/clarity/provenance/…) — so genuine
    // weaknesses like "limited chocolate formats" survive, while
    // "limited information on processing methods" is removed.
    const DATA_GAP_RE = /\b(lack|lacks|lacking|absence|absent|limited|missing|no|insufficient|incomplete|unavailable|unclear|unknown|unspecified|not\s+(?:specified|mentioned|provided|disclosed|listed|available|clear))\b[^.]*?\b(information|informations|data|detail|details|detailed|clarity|specifics?|transparency|provenance|percentage|cocoa|origin|processing|ingredient|ingredients|certification|certifications|breakdown)\b/i;
    const isDataGapComplaint = (s) => typeof s === 'string' && DATA_GAP_RE.test(s);
    const cleanBannedPhrases = (arr) =>
      Array.isArray(arr) ? arr.filter(item => !isDataGapComplaint(item)) : [];

    const rawWeaknesses = report.composition_quality?.weaknesses || [];
    const cleanedWeaknesses = cleanBannedPhrases(rawWeaknesses);
    // Notes is a free-text string — blank it if it's primarily a data-gap complaint.
    const rawNotes = report.composition_quality?.notes || '';
    const cleanedNotes = isDataGapComplaint(rawNotes) ? '' : rawNotes;

    // Anchoring pass — drop improvement/market_gap items whose title or
    // body is one of the banned template phrases. The prompt asks the model
    // to anchor everything to a named competitor or composition gap; if a
    // suggestion still reads like a generic recipe-card item we strip it
    // here so the report can never display "Premium Festive Tiers" or
    // "Introduce New Flavour Extensions" as a standalone bullet.
    const TEMPLATE_PHRASE_RE = /\b(corporate\s*bulk\s*orders?|premium\s*festive\s*tiers?|premium\s*packaging\s*options?|new\s*flavou?r\s*extensions?|gifting\s*presentation\s*options?|sourcing\s*upgrades?|dietary[- ]specific\s*(versions?|hampers?|bites?|rochers?)|expand\s*(variety|the\s*chocolate\s*range|product\s*line)|add\s*more\s*chocolate\s*formats?)\b/i;
    const looksTemplatey = (item) => {
      if (!item || typeof item !== 'object') return false;
      const haystack = `${item.title || ''} ${item.description || ''} ${item.gap || ''} ${item.opportunity || ''}`;
      // A template phrase is allowed only if the text also names a specific
      // competitor brand or anchors to a specific composition signal.
      if (!TEMPLATE_PHRASE_RE.test(haystack)) return false;
      const anchored = KNOWN_BRANDS.some(b => haystack.includes(b))
        || /\b\d{2,3}\s*%/.test(haystack)
        || /\b(diwali|valentine|christmas|rakhi|holi|easter|ganesh|mother|father)\b/i.test(haystack);
      return !anchored;
    };

    // Free-text safety net: drop individual sentences that are data-gap
    // complaints from the exec summary / pricing analysis, but only when at
    // least one real sentence remains (never blank the whole field).
    const scrubSentences = (text) => {
      if (typeof text !== 'string' || !text.trim()) return text;
      const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
      const kept = sentences.filter(s => !isDataGapComplaint(s));
      const result = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
      return result.length >= 20 ? result : text; // keep original if scrub gutted it
    };
    pricing_verdict.analysis = scrubSentences(pricing_verdict.analysis);

    // Normalise — ensure all required fields exist with safe defaults
    const normalised = {
      executive_summary:    scrubSentences(report.executive_summary) || 'Analysis complete.',
      overall_confidence:   report.overall_confidence   || 'medium',

      pricing_verdict,

      composition_quality: report.composition_quality ? {
        rating:     report.composition_quality.rating || 'Good',
        strengths:  report.composition_quality.strengths || [],
        weaknesses: cleanedWeaknesses,
        confidence: report.composition_quality.confidence || 'low',
        notes:      cleanedNotes,
      } : {
        rating:     'Good',
        strengths:  [],
        weaknesses: [],
        confidence: 'low',
        notes:      '',
      },

      // E3: improvements array — each item now includes confidence.
      // Template-phrase items are filtered so the founder never sees a
      // generic "Premium Packaging Options" bullet unless it's anchored.
      improvements: Array.isArray(report.improvements)
        ? report.improvements
            .filter(imp => !looksTemplatey(imp))
            .slice(0, 4)
            .map(imp => ({
              title:       imp.title       || '',
              description: imp.description || '',
              priority:    imp.priority    || 'medium',
              impact:      imp.impact      || '',
              confidence:  imp.confidence  || 'medium',  // E3
            }))
        : [],

      market_gaps: Array.isArray(report.market_gaps)
        ? report.market_gaps
            .filter(g => !looksTemplatey(g))
            .slice(0, 3)
        : [],

      // E3: top-level market gaps confidence
      market_gaps_confidence: report.market_gaps_confidence || 'medium',
    };

    return res.status(200).json(normalised);

  } catch (err) {
    console.error('[analyse] Error:', err.message);

    if (err.message.includes('All AI providers failed')) {
      return res.status(503).json({
        error: 'Analysis service is temporarily unavailable. Please try again in a few minutes.',
      });
    }

    return res.status(500).json({ error: err.message });
  }
}
