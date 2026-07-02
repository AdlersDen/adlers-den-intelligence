// ──────────────────────────────────────────────────────────
// D2 — POST /api/extract-composition
// Single unified Groq call: classifies + extracts composition
// in one round-trip instead of two (saves ~2s latency)
//
// Response shape is unchanged — downstream analysisService.js
// receives the same { classification, composition } structure
// ──────────────────────────────────────────────────────────

import { callAI } from './_ai.js';

// ── Unified system prompt ──────────────────────────────────

function buildUnifiedSystem() {
  return `You are an expert in Indian premium chocolate and gifting products.
Your task is to:
1. Classify the product as either "hamper" or "single_chocolate"
2. Extract the full detailed composition profile for that product type

A "hamper" is a gift box, hamper, collection, or assortment containing multiple different products.
A "single_chocolate" is a single chocolate bar, truffle box, praline box, or other single-SKU item.

You MUST respond with valid JSON only — no markdown, no explanation outside the JSON.
If the product is a hamper: fill "hamper_composition" and leave "single_composition" null.
If the product is a single chocolate: fill "single_composition" and leave "hamper_composition" null.`;
}

// ── Unified user prompt ────────────────────────────────────

function buildUnifiedUser(productName, category, tags, productText) {
  return `Classify and extract the full composition of this product.

Product Name: ${productName}
Category: ${category}
Tags: ${(tags || []).join(', ') || 'none'}
Description:
${productText}

Respond with EXACTLY this JSON structure. Fill the correct composition branch; leave the other null.
Do NOT guess any field not explicitly mentioned — use null instead.

{
  "classification": {
    "type": "hamper",
    "confidence": "high",
    "reason": "one sentence explanation"
  },

  "hamper_composition": {
    "items": [
      {
        "name": "item name",
        "category": "chocolate_bar | truffle | praline | confectionery | non_chocolate | packaging_item",
        "chocolate_type": "dark | milk | white | ruby | mixed | null",
        "cocoa_percentage": null,
        "quantity": null,
        "weight_grams": null,
        "attributes": [],
        "notes": "any additional relevant detail"
      }
    ],
    "total_weight_grams": null,
    "packaging_quality": "basic | premium | luxury",
    "occasion_fit": ["corporate_gifting", "birthday", "festive", "romantic", "personal"],
    "chocolate_types_present": ["dark", "milk"],
    "has_non_chocolate_items": false,
    "price_per_gram": null,
    "summary": "2-3 sentence description of the hamper composition and positioning"
  },

  "single_composition": {
    "format": "bar | rocher | truffle | praline | bonbon | dragees | barks | coated_nuts | cluster | bites | gianduja | spread | other",
    "chocolate_type": "dark | milk | white | ruby | blended",
    "cocoa_percentage": null,
    "origin_country": null,
    "origin_region": null,
    "is_indian_origin": null,
    "is_bean_to_bar": null,
    "ingredients": [],
    "key_flavour_notes": [],
    "texture": "smooth | grainy | creamy | null",
    "weight_grams": null,
    "pack_options": [
      { "label": "e.g. Standup pouch", "price_numeric": 259, "weight_grams": 65 }
    ],
    "dietary": {
      "vegan": null,
      "gluten_free": null,
      "sugar_free": null,
      "dairy_free": null,
      "soy_free": null
    },
    "certifications": [],
    "processing_method": "stone_ground | conched | null",
    "quality_tier": "mass_market | artisanal | premium | luxury",
    "unique_selling_points": [],
    "summary": "2-3 sentence description of the chocolate's composition, quality markers, and positioning"
  }
}

Rules:
- classification.type must be exactly "hamper" or "single_chocolate"
- If type is "hamper": fill hamper_composition fully, set single_composition to null
- If type is "single_chocolate": fill single_composition fully, set hamper_composition to null
- "format" is the PHYSICAL FORM of the product, inferred from the name and description (e.g. "Cashew Cranberry Rochers" -> "rocher"; "70% Dark Bar" -> "bar"; "Orange Barks" -> "barks"; "Black Currant Squares" -> "bites"). This is NOT the same as chocolate_type. Choose the closest single value; use "other" only if none fit.
- "cocoa_percentage": extract any explicit percentage in the description like "70%", "63% cocoa", "55% dark" — return the integer (e.g. 70). If the description mentions a percentage in passing for an ingredient (e.g. "70% dark chocolate"), use that. Only return null if no percentage appears anywhere.
- "weight_grams": extract any explicit weight mentioned in grams ("65g", "100 gms", "70 grams"). If multiple pack sizes are listed, use the SMALLEST one as weight_grams and put all of them in pack_options.
- "pack_options": if the description lists multiple purchasable pack sizes with prices (e.g. "Standup pouch: Rs. 259 (65gms), 190ml Jar: Rs. 389 (100gms)"), extract each as an object. If there is only one price/size or none stated, return an empty array [].
- "origin_country" / "origin_region": extract from phrases like "Kerala dark chocolate", "South Indian cocoa", "Madagascan beans" — these signal origin. Return null only if no origin info is present.
- Never guess for fields not explicitly stated, but DO extract numeric values that appear in the description text — being too cautious leaves fields null when the data is right there.
- Cross-validation: if chocolate_type is "milk", dietary.vegan and dietary.dairy_free MUST be false/null unless the description explicitly says otherwise (milk chocolate contains dairy by definition)`;
}

// ── Cross-validation: catch impossible dietary claims ───────
// Milk chocolate contains dairy by definition. If the AI guessed
// vegan or dairy-free on a milk chocolate product, fix it here.
function crossValidateComposition(composition) {
  if (!composition || !composition.dietary) return composition;
  const type = (composition.chocolate_type || '').toLowerCase();
  if (type === 'milk' || type === 'white') {
    if (composition.dietary.vegan === true) {
      console.warn('[extract-composition] Cross-validation: vegan=true on', type, 'chocolate → corrected to null');
      composition.dietary.vegan = null;
    }
    if (composition.dietary.dairy_free === true) {
      console.warn('[extract-composition] Cross-validation: dairy_free=true on', type, 'chocolate → corrected to null');
      composition.dietary.dairy_free = null;
    }
  }
  return composition;
}

// ── Regex-based fallback enrichment ────────────────────────
// The model leaves cocoa_percentage / weight_grams null even when those
// numbers appear plainly in the description (e.g. "63% Kerala dark", "65g").
// This pass scans the raw text and fills them in so downstream scoring and
// the data_completeness number reflect what was genuinely available.
function backfillFromText(composition, productType, productText) {
  if (productType !== 'single_chocolate' || !composition) return composition;
  const text = String(productText || '');

  if (composition.cocoa_percentage == null) {
    // "70%", "63 % cocoa", "55% dark" — capture the leading number.
    const m = text.match(/\b(\d{2,3})\s*%\s*(?:cocoa|dark|cacao)?/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 30 && n <= 100) composition.cocoa_percentage = n;
    }
  }

  if (composition.weight_grams == null) {
    // Prefer pack_options if present — use the smallest pack as the "default" weight.
    const packs = (composition.pack_options || []).filter(p => p && Number.isFinite(p.weight_grams));
    if (packs.length > 0) {
      composition.weight_grams = packs.reduce((min, p) => p.weight_grams < min ? p.weight_grams : min, packs[0].weight_grams);
    } else {
      const m = text.match(/\b(\d{2,4})\s*(?:g|gm|gms|grams?)\b/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 10 && n <= 5000) composition.weight_grams = n;
      }
    }
  }

  // Indian-origin hint — phrases like "Kerala dark chocolate", "South Indian cocoa".
  if (composition.is_indian_origin == null) {
    if (/\b(kerala|karnataka|tamil nadu|andhra|south indian|indian (cocoa|cacao|beans))\b/i.test(text)) {
      composition.is_indian_origin = true;
    }
  }

  // Display consistency — the model echoes source-text casing ("Chilies",
  // "dried guavas") so chips render with mixed capitalisation. Lowercase both
  // ingredient and flavour-note lists.
  if (Array.isArray(composition.ingredients)) {
    composition.ingredients = composition.ingredients.map(i => typeof i === 'string' ? i.toLowerCase() : i);
  }
  if (Array.isArray(composition.key_flavour_notes)) {
    composition.key_flavour_notes = composition.key_flavour_notes.map(i => typeof i === 'string' ? i.toLowerCase() : i);
  }

  return composition;
}

// ── Data completeness scoring ──────────────────────────────
// Counts how many key fields the AI was able to fill vs total.
// Returns { filled, total, ratio, level } where level is the
// human-readable confidence equivalent.
const SINGLE_FIELDS = [
  'format', 'chocolate_type', 'cocoa_percentage', 'origin_country', 'origin_region',
  'is_bean_to_bar', 'ingredients', 'key_flavour_notes', 'weight_grams',
  'processing_method', 'quality_tier', 'summary',
];
const HAMPER_FIELDS = [
  'items', 'total_weight_grams', 'packaging_quality', 'occasion_fit',
  'chocolate_types_present', 'summary',
];

function computeDataCompleteness(composition, productType) {
  const fields = productType === 'hamper' ? HAMPER_FIELDS : SINGLE_FIELDS;
  let filled = 0;
  for (const f of fields) {
    const v = composition[f];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    filled++;
  }
  const total = fields.length;
  const ratio = total > 0 ? filled / total : 0;
  const level = ratio >= 0.7 ? 'high' : ratio >= 0.4 ? 'medium' : 'low';
  return { filled, total, ratio: Math.round(ratio * 100), level };
}

// ── Route handler ──────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productText, productName, category, tags } = req.body || {};
  if (!productText || !productName) {
    return res.status(400).json({ error: 'productText and productName are required' });
  }

  try {
    // Single unified call — replaces the old 2-call (classify then extract) pattern
    const raw = await callAI({
      system:    buildUnifiedSystem(),
      user:      buildUnifiedUser(productName, category, tags, productText),
      maxTokens: 2000,
      label:     'classify-and-extract',
    });

    // Normalise classification
    const productType = raw.classification?.type === 'hamper' ? 'hamper' : 'single_chocolate';
    const classification = {
      type:       productType,
      confidence: raw.classification?.confidence || 'medium',
      reason:     raw.classification?.reason     || '',
    };

    // Pick the correct composition branch
    const composition = productType === 'hamper'
      ? raw.hamper_composition
      : raw.single_composition;

    if (!composition) {
      // Groq returned the wrong branch or null — non-fatal fallback
      console.warn('[extract-composition] Groq returned null for composition branch — returning empty');
      return res.status(200).json({
        classification,
        composition: { summary: 'Composition data unavailable — description may be too brief.' },
        data_completeness: { filled: 0, total: 1, ratio: 0, level: 'low' },
      });
    }

    // Post-extraction: cross-validate dietary claims, backfill any fields
    // the model left null but that appear in the raw text, then score
    // completeness from the FINAL composition (so weight pulled from
    // pack_options counts toward the score).
    const validated  = crossValidateComposition(composition);
    const backfilled = backfillFromText(validated, productType, productText);
    const data_completeness = computeDataCompleteness(backfilled, productType);
    console.log('[extract-composition] Data completeness:', data_completeness);

    return res.status(200).json({ classification, composition: backfilled, data_completeness });

  } catch (err) {
    console.error('[extract-composition] Error:', err.message);

    if (err.message.includes('All AI providers failed')) {
      return res.status(503).json({
        error: 'Analysis service is temporarily unavailable. Please try again in a few minutes.',
      });
    }

    return res.status(500).json({ error: err.message });
  }
}
