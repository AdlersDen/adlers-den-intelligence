// Temporary test page to seed sessionStorage and verify the sidebar.
// Run this at: http://localhost:5173/test-seed.html (or 3000 under `vercel dev`)
// After visiting, open / in the SAME tab — sessionStorage is per-tab.

const fakeAnalyses = [
  {
    id: "test-id-001",
    product_name: "Premium Dark Chocolate Hamper",
    product_type: "hamper",
    product_price: "₹2,499",
    product_category: "Gift Hampers",
    status: "completed",
    created_date: new Date().toISOString(),
    composition_profile: { chocolates: ["70% Dark", "Hazelnut Praline"] },
    competitor_data: [
      { brand: "Smoor", product_name: "Luxury Gift Box", price: "₹2,200", url: "https://smoor.com" }
    ],
    report: {
      executive_summary: "This hamper positions well in the ₹2,000–₹2,800 range.",
      overall_confidence: "high",
      pricing_verdict: { verdict: "Competitive", analysis: "Priced appropriately vs Smoor", confidence: "high" },
      composition_quality: { rating: "Premium", notes: "High cocoa content", confidence: "medium" },
      improvements: [{ title: "Add gift card", description: "Include a personalized note option", priority: "medium" }],
      market_gaps: [{ gap: "Vegan options", opportunity: "Growing vegan market segment", confidence: "high" }]
    }
  },
  {
    id: "test-id-002",
    product_name: "Single Origin 70% Dark",
    product_type: "single_chocolate",
    product_price: "₹599",
    product_category: "Dark Chocolate",
    status: "completed",
    created_date: new Date(Date.now() - 86400000).toISOString(),
    composition_profile: { cocoa_percentage: 70, origin: "Kerala" },
    competitor_data: [],
    report: { executive_summary: "Strong single-origin story.", overall_confidence: "medium" }
  }
];

// analysisService reads/writes sessionStorage (per-tab) under this same key.
sessionStorage.setItem('adlers_den_analyses', JSON.stringify(fakeAnalyses));

document.body.innerHTML = `
  <div style="font-family: sans-serif; padding: 40px; background: #111; color: #eee; min-height: 100vh;">
    <h2 style="color: #d4a843;">✅ Test data seeded!</h2>
    <p>2 fake analyses written to sessionStorage (this tab only).</p>
    <p style="margin-top: 20px;">
      <a href="/" style="color: #d4a843;">→ Go to Dashboard to see sidebar history</a>
    </p>
    <pre style="margin-top: 20px; font-size: 12px; color: #888; background: #222; padding: 16px; border-radius: 8px;">${JSON.stringify(fakeAnalyses, null, 2)}</pre>
  </div>
`;
