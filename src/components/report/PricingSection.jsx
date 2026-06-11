import InsightSection from './InsightSection';
import { IndianRupee, AlertCircle } from "lucide-react";

// data is pricing_verdict: { verdict, analysis, confidence, recommended_price_range }
// "Unavailable" is a special verdict emitted when fetch-product could not find a price.
export default function PricingSection({ data, index }) {
  const isUnavailable = data?.verdict === 'Unavailable';

  // Color the verdict pill based on its semantic meaning rather than just "primary"
  const verdictTone = isUnavailable
    ? 'text-muted-foreground'
    : data?.verdict === 'Overpriced'  ? 'text-red-400'
    : data?.verdict === 'Underpriced' ? 'text-emerald-400'
    : 'text-foreground';

  return (
    <InsightSection title="Pricing Verdict" icon={IndianRupee} data={data} index={index}>
      {/* Verdict pill */}
      {data?.verdict && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/50 border border-border/50">
          {isUnavailable && <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />}
          <span className="text-xs font-body text-muted-foreground">
            {isUnavailable ? 'Verdict unavailable:' : 'Verdict:'}
          </span>
          <span className={`text-sm font-heading font-semibold ${verdictTone}`}>
            {isUnavailable ? 'Price not extracted' : data.verdict}
          </span>
        </div>
      )}

      {/* Analysis paragraph */}
      {data?.analysis && (
        <p className="font-body text-sm text-foreground/75 leading-relaxed">
          {data.analysis}
        </p>
      )}

      {/* Price-per-item — hamper-only, surfaced when analyse computed it */}
      {!isUnavailable && data?.price_per_item != null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg bg-card/60 border border-border/50">
          <span className="text-xs font-body text-muted-foreground">Per-item value:</span>
          <span className="text-xs font-heading font-semibold text-foreground">
            ₹{data.price_per_item}/item
          </span>
          {data.competitor_price_per_item_range && data.competitor_price_per_item_range !== 'null' && (
            <span className="text-xs font-body text-muted-foreground">
              vs competitors {data.competitor_price_per_item_range}
            </span>
          )}
        </div>
      )}

      {/* Price-per-gram — single-product, surfaced when weights resolved */}
      {!isUnavailable && data?.price_per_gram != null && data.price_per_gram !== 'null' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg bg-card/60 border border-border/50">
          <span className="text-xs font-body text-muted-foreground">Per-gram value:</span>
          <span className="text-xs font-heading font-semibold text-foreground">
            ₹{data.price_per_gram}/g
          </span>
          <span className="text-xs font-body text-muted-foreground">
            weight-normalised vs competitors
          </span>
        </div>
      )}

      {/* Recommended price range — hidden in the Unavailable case */}
      {!isUnavailable && data?.recommended_price_range && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
          <span className="text-xs font-body text-muted-foreground">Suggested range:</span>
          <span className="text-xs font-heading font-semibold text-primary">
            {data.recommended_price_range}
          </span>
        </div>
      )}
    </InsightSection>
  );
}