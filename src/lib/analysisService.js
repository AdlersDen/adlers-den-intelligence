// ──────────────────────────────────────────────
// Adler's Den — Analysis Service
// All AI calls go through Vercel serverless routes (/api/*)
// No Base44 dependencies
// ──────────────────────────────────────────────

// Derive a clean product name from a free-text concept brief. Founders
// write "Dark Chocolate Mango Crunch Bites – Premium snack featuring…" so
// the lead phrase before the first separator (– — - : .) is the name.
// Strips a leading price/qualifier, caps length, and falls back to the
// AI summary slice only when nothing usable comes out.
function deriveConceptName(text, summaryFallback) {
  if (text && typeof text === 'string') {
    const lead = text
      .trim()
      .split(/\s[–—-]\s|:|\.(?:\s|$)/)[0]   // first separator: dash, colon, period
      .replace(/^₹\s?[\d,]+\s*/, '')         // drop a leading price if present
      .trim();
    // A real product name is short-ish and not a full sentence.
    if (lead && lead.length >= 3 && lead.length <= 70 && lead.split(/\s+/).length <= 10) {
      return lead;
    }
  }
  const s = (summaryFallback || '').trim();
  if (s) return s.length <= 60 ? s : s.slice(0, 57).trim() + '…';
  return '(concept product)';
}

// ── API helper with step-tagged errors ─────────
// Step I: errors carry err.step so Dashboard can show which step failed
// Timeout: 90s — prevents indefinite spinner if serverless function hangs
async function apiFetch(route, body, stepName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  let res;
  try {
    res = await fetch(route, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    const error = new Error(
      fetchErr.name === 'AbortError'
        ? 'Request timed out after 90 seconds — the server may be overloaded. Please try again.'
        : fetchErr.message || 'Network error'
    );
    error.step = stepName;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || `API error: ${res.status}`);
    error.step = stepName; // Step I: tag with which step failed
    throw error;
  }
  return res.json();
}

// ── Analysis pipeline ────────────────────────────
// onStep:    (stepLabel: string) => void  — updates progress indicator
// onSubStep: (subLabel: string) => void   — updates sub-status under step 3 (Step J)
export async function runFullAnalysis(url, onStep, onSubStep) {
  const subStep = onSubStep || (() => {});

  // Step 1: Fetch product data
  onStep('Fetching product data');
  const productData = await apiFetch('/api/fetch-product', { url }, 'fetch-product');

  // Step 2: Classify + extract composition (single merged call — Step D)
  onStep('Extracting composition');
  const { classification, composition, data_completeness } = await apiFetch('/api/extract-composition', {
    productText: productData.description,
    productName: productData.name,
    category:    productData.category,
    tags:        productData.tags,
  }, 'extract-composition');

  // Step 3: Search competitors
  onStep('Searching competitors');
  subStep('Searching for competitors…');
  const { competitors, search_quality, occasion_match, product_class } = await apiFetch('/api/search-competitors', {
    composition,
    productType:     classification.type,
    productPrice:    productData.price,
    productName:     productData.name,
    productCategory: productData.category,
  }, 'search-competitors');

  // Step J: sub-status after search returns
  const competitorCount = competitors?.length || 0;
  subStep(
    competitorCount > 0
      ? `Found ${competitorCount} competitor${competitorCount !== 1 ? 's' : ''} — enriching data…`
      : 'No live competitors found — using brand knowledge…'
  );

  // Step 4: Comparative analysis
  onStep('Running comparative analysis');
  subStep('');
  const report = await apiFetch('/api/analyse', {
    productData,
    productType: classification.type,
    composition,
    competitors,
  }, 'analyse');

  onStep('Analysis complete');

  return {
    productData,
    classification,
    composition,
    data_completeness: data_completeness || null,
    competitorData: { competitors, search_quality, occasion_match, product_class: product_class || 'chocolate' },
    report,
  };
}

// ── Concept Product analysis ──────────────────────
// Skips /api/fetch-product (there's nothing to fetch for an unlaunched
// product) and routes through extract → search → analyse. Two flavours:
//   • free       — paragraph of prose, AI extracts composition
//   • structured — fielded form, we build the composition directly
// Both paths set `is_concept: true` on the returned analysis so the
// Report banner can flag it for the founder.
export async function runConceptAnalysis(input, onStep, onSubStep) {
  const subStep = onSubStep || (() => {});

  let productData;
  let classification;
  let composition;
  let data_completeness;

  if (input.mode === 'concept_free') {
    onStep('Extracting composition from brief');
    productData = {
      name:        '(concept product)',
      price:       'Price not set',
      category:    'Concept',
      description: input.text,
      tags:        [],
      images:      [],
    };
    const extracted = await apiFetch('/api/extract-composition', {
      productText: input.text,
      productName: '(concept product)',
      category:    'Concept',
      tags:        [],
    }, 'extract-composition');
    classification    = extracted.classification;
    composition       = extracted.composition;
    data_completeness = extracted.data_completeness;
    // Pull a clean price out of the brief — end the match on a digit so we
    // don't capture a trailing comma ("₹349, targeting" → "₹349").
    const m = input.text.match(/₹\s?[\d,]*\d/);
    if (m) productData.price = m[0].replace(/\s/, '');
    // Derive a clean product NAME rather than a chopped summary sentence.
    // Briefs are usually written "<Name> – <description>" or "<Name>: …" or
    // "<Name>. …" — take the lead phrase before the first separator. Fall
    // back to the summary slice only if that yields nothing sensible.
    productData.name = deriveConceptName(input.text, composition.summary);
  } else {
    // Structured: build composition directly, skip AI extraction.
    onStep('Preparing concept');
    productData = {
      name:        input.name,
      price:       input.price,
      category:    'Concept',
      description: input.positioning || `Concept ${input.format} (${input.chocolate_type})`,
      tags:        input.occasion ? [input.occasion] : [],
      images:      [],
    };
    classification = { type: 'single_chocolate', confidence: 'high', reason: 'concept structured form' };
    composition = {
      format:           input.format,
      chocolate_type:   input.chocolate_type,
      cocoa_percentage: input.cocoa_percentage,
      weight_grams:     input.weight_grams,
      ingredients:      input.ingredients || [],
      key_flavour_notes: [],
      pack_options:     [],
      dietary:          { vegan: null, gluten_free: null, sugar_free: null, dairy_free: null, soy_free: null },
      certifications:   [],
      quality_tier:     'artisanal',
      unique_selling_points: [],
      summary:          input.positioning || `${input.name} — a planned ${input.chocolate_type} ${input.format}.`,
    };
    data_completeness = { filled: 6, total: 12, ratio: 50, level: 'medium' };
  }

  onStep('Searching competitors');
  subStep('Searching for competitors…');
  const { competitors, search_quality, occasion_match } = await apiFetch('/api/search-competitors', {
    composition,
    productType:     classification.type,
    productPrice:    productData.price,
    productName:     productData.name,
    productCategory: input.occasion || 'Concept',
  }, 'search-competitors');

  onStep('Running concept analysis');
  subStep('');
  const report = await apiFetch('/api/analyse', {
    productData,
    productType: classification.type,
    composition,
    competitors,
    isConcept:   true,
  }, 'analyse');

  onStep('Analysis complete');

  return {
    productData,
    classification,
    composition,
    data_completeness: data_completeness || null,
    competitorData: { competitors, search_quality, occasion_match },
    report,
    is_concept: true,
  };
}

// ── localStorage helpers ────────────────────────
// Analyses survive browser restart so the sales team can revisit prior
// work. Capped at 20 entries to stay well under the ~5MB localStorage
// budget. If a machine is shared, the sidebar's recent list is the
// gate — calling clearAnalyses() wipes everything.
const STORAGE_KEY = 'adlers_den_analyses';

export function saveAnalysis(data) {
  const existing = getAnalyses();
  const updated  = [data, ...existing].slice(0, 20);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    console.warn('localStorage write failed — storage may be full');
  }
}

export function getAnalyses() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function getAnalysisById(id) {
  return getAnalyses().find(a => a.id === id) || null;
}

export function deleteAnalysis(id) {
  const updated = getAnalyses().filter(a => a.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    console.warn('localStorage write failed');
  }
}

export function clearAnalyses() {
  localStorage.removeItem(STORAGE_KEY);
}