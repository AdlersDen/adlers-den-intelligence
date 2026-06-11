import React from 'react';
import InsightSection from './InsightSection';
import ConfidenceBadge from './ConfidenceBadge';
import { Badge } from "@/components/ui/badge";
import { Lightbulb } from "lucide-react";

const priorityStyles = {
  high:   "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

// data is a flat array: [{ title, description, priority, impact, confidence }]
// Step B fix: was reading data.suggestions — data IS the array
export default function ImprovementsSection({ data, index }) {
  const items = Array.isArray(data) ? data : [];

  return (
    // Pass empty object so InsightSection renders the card shell without a section-level badge
    // Each improvement card shows its own confidence badge instead (E3)
    <InsightSection title="Recommended Improvements" icon={Lightbulb} data={{}} index={index}>
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="p-3.5 rounded-xl bg-background/50 border border-border/50"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h4 className="font-body text-sm font-semibold text-foreground">
                  {item.title}
                </h4>
                <div className="flex items-center gap-1.5 shrink-0">
                  {item.priority && (
                    <Badge variant="outline" className={`text-[10px] font-body ${priorityStyles[item.priority]}`}>
                      {item.priority} priority
                    </Badge>
                  )}
                </div>
              </div>

              <p className="font-body text-xs text-muted-foreground leading-relaxed mb-2">
                {item.description}
              </p>

              {item.impact && (
                <p className="font-body text-xs text-foreground/50 italic mb-2">
                  Impact: {item.impact}
                </p>
              )}

              {item.confidence && (
                <ConfidenceBadge level={item.confidence} />
              )}
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <p className="font-body text-sm text-muted-foreground/60">
          No improvement suggestions available.
        </p>
      )}
    </InsightSection>
  );
}