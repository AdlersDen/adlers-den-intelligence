// One-shot pipeline runner — calls each endpoint in sequence,
// chains the outputs, persists each step's response, and prints
// a clean per-step summary. Used to evaluate the report quality
// end-to-end without going through the UI.
import { readFile, writeFile } from 'node:fs/promises';

const BASE = 'http://localhost:3000';
const URL_TO_TEST = process.argv[2] || 'https://adlersden.com/product/valentines-day-sinful-love-chocolate-box/';

async function call(route, body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw text */ }
  return { status: res.status, elapsed, json, text };
}

function prune(obj) {
  // remove null / empty array / empty string fields one level deep, recursively
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    const out = obj.map(prune).filter(v => v !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const pv = prune(v);
      if (pv === undefined) continue;
      if (typeof pv === 'string' && pv.trim() === '') continue;
      out[k] = pv;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return obj;
}

function hr(label) { console.log(`\n══════ ${label} ══════`); }

(async () => {
  // Step 1 — fetch-product
  hr('1. /api/fetch-product');
  console.log(`URL: ${URL_TO_TEST}`);
  const r1 = await call('/api/fetch-product', { url: URL_TO_TEST });
  if (!r1.json) { console.log(`HTTP ${r1.status} non-json:`, r1.text.slice(0, 300)); process.exit(1); }
  const product = r1.json;
  await writeFile('fetch-product.out.json', JSON.stringify(product, null, 2));
  console.log(`HTTP ${r1.status}   ${r1.elapsed}s`);
  console.log(`source: ${product._source}   price: ${product.price}   weight: ${product.weight}`);
  console.log(`name:   ${product.name}`);
  console.log(`category: ${product.category}   tags: ${(product.tags||[]).join(', ')}`);
  console.log(`desc:   ${(product.description || '').slice(0, 240)}…`);

  // Step 2 — extract-composition
  hr('2. /api/extract-composition');
  const r2 = await call('/api/extract-composition', {
    productText: product.description,
    productName: product.name,
    category:    product.category,
    tags:        product.tags,
  });
  await writeFile('extract-composition.out.json', JSON.stringify(r2.json, null, 2));
  console.log(`HTTP ${r2.status}   ${r2.elapsed}s`);
  if (!r2.json) { console.log('non-json:', r2.text.slice(0, 300)); process.exit(1); }
  console.log('classification:', r2.json.classification);
  console.log('data_completeness:', r2.json.data_completeness);
  console.log('composition (non-empty fields):');
  console.log(JSON.stringify(prune(r2.json.composition), null, 2));

  const productType = r2.json.classification.type;
  const composition = r2.json.composition;

  // Step 3 — search-competitors
  hr('3. /api/search-competitors');
  const r3 = await call('/api/search-competitors', {
    composition,
    productType,
    productPrice: product.price,
  });
  await writeFile('search-competitors.out.json', JSON.stringify(r3.json, null, 2));
  console.log(`HTTP ${r3.status}   ${r3.elapsed}s`);
  if (!r3.json) { console.log('non-json:', r3.text.slice(0, 300)); process.exit(1); }
  console.log(`query_used:     ${r3.json.query_used}`);
  console.log(`search_quality: ${r3.json.search_quality}`);
  console.log(`competitors:    ${(r3.json.competitors || []).length}`);
  for (const c of (r3.json.competitors || [])) {
    console.log(`  • [${c.brand}] ${c.product_name}  ${c.price ?? 'no-price'}  src=${c._enriched_source || 'snippet-only'}`);
    console.log(`    ${(c.description || '').slice(0, 140)}`);
  }

  // Step 4 — analyse
  hr('4. /api/analyse');
  const r4 = await call('/api/analyse', {
    productData: product,
    productType,
    composition,
    competitors: r3.json.competitors || [],
  });
  await writeFile('analyse.out.json', JSON.stringify(r4.json, null, 2));
  console.log(`HTTP ${r4.status}   ${r4.elapsed}s`);
  if (!r4.json) { console.log('non-json:', r4.text.slice(0, 300)); process.exit(1); }
  const rep = r4.json;
  console.log(`overall_confidence: ${rep.overall_confidence}`);
  console.log(`executive_summary:\n  ${rep.executive_summary}`);
  console.log(`\npricing_verdict (${rep.pricing_verdict?.confidence}):  ${rep.pricing_verdict?.verdict}`);
  console.log(`  ${rep.pricing_verdict?.analysis}`);
  console.log(`  range: ${rep.pricing_verdict?.recommended_price_range ?? '—'}`);
  console.log(`\ncomposition_quality (${rep.composition_quality?.confidence}):  ${rep.composition_quality?.rating}`);
  for (const s of rep.composition_quality?.strengths || [])  console.log(`  + ${s}`);
  for (const w of rep.composition_quality?.weaknesses || []) console.log(`  − ${w}`);
  if (rep.composition_quality?.notes) console.log(`  notes: ${rep.composition_quality.notes}`);
  console.log(`\nimprovements (${(rep.improvements || []).length}):`);
  for (const i of rep.improvements || []) {
    console.log(`  • [${i.priority}/${i.confidence}] ${i.title}`);
    console.log(`    ${i.description}`);
    console.log(`    impact: ${i.impact}`);
  }
  console.log(`\nmarket_gaps (${(rep.market_gaps || []).length}, section confidence: ${rep.market_gaps_confidence}):`);
  for (const g of rep.market_gaps || []) {
    console.log(`  • [${g.confidence}] ${g.gap}`);
    console.log(`    ${g.opportunity}`);
  }
})();
