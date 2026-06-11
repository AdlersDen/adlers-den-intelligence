import React from 'react';
import InsightSection from './InsightSection';
import ConfidenceBadge from './ConfidenceBadge';
import { Telescope } from "lucide-react";

// data is a flat array: [{ gap, opportunity, confidence }]
// sectionConfidence is the top-level market_gaps_confidence from the report (E3)
export default function MarketGapsSection({ data, sectionConfidence, index }) {
  const gaps = Array.isArray(data) ? data : [];

  return (
    // Pass { confidence: sectionConfidence } so InsightSection shows the section-level badge (E3)
    <InsightSection
      title="Market Gaps & Opportunities"
      icon={Telescope}
      data={{ confidence: sectionConfidence }}
      index={index}
    >
      {gaps.length > 0 && (
        <div className="space-y-3">
          {gaps.map((gap, i) => (
            <div
              key={i}
              className="p-3.5 rounded-xl bg-background/50 border border-border/50"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                {/* field was gap.title — API returns gap.gap */}
                <h4 className="font-body text-sm font-semibold text-foreground">
                  {gap.gap}
                </h4>
                {gap.confidence && (
                  <ConfidenceBadge level={gap.confidence} />
                )}
              </div>

              {/* field was gap.description — API returns gap.opportunity */}
              <p className="font-body text-xs text-muted-foreground leading-relaxed">
                {gap.opportunity}
              </p>
            </div>
          ))}
        </div>
      )}

      {gaps.length === 0 && (
        <p className="font-body text-sm text-muted-foreground/60">
          No market gaps identified.
        </p>
      )}
    </InsightSection>
  );
}