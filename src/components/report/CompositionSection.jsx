import React from 'react';
import InsightSection from './InsightSection';
import { FlaskConical } from "lucide-react";

// data is composition_quality: { rating, strengths, weaknesses, confidence, notes }
// data.confidence is used by InsightSection for the section-level ConfidenceBadge ✅
export default function CompositionSection({ data, index }) {
  const ratingColors = {
    'Excellent':     'text-emerald-400',
    'Good':          'text-primary',
    'Average':       'text-amber-400',
    'Below Average': 'text-red-400',
  };

  return (
    <InsightSection title="Composition Quality" icon={FlaskConical} data={data} index={index}>
      {/* Rating badge */}
      {data?.rating && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/50 border border-border/50">
          <span className="text-xs font-body text-muted-foreground">Rating:</span>
          <span className={`text-sm font-heading font-semibold ${ratingColors[data.rating] || 'text-foreground'}`}>
            {data.rating}
          </span>
        </div>
      )}

      {/* Strengths — API returns strengths[], was reading details[] */}
      {data?.strengths?.length > 0 && (
        <div>
          <p className="font-body text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Strengths
          </p>
          <ul className="space-y-1.5">
            {data.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm font-body text-foreground/75">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weaknesses */}
      {data?.weaknesses?.length > 0 && (
        <div>
          <p className="font-body text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Areas to Improve
          </p>
          <ul className="space-y-1.5">
            {data.weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm font-body text-foreground/75">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes — API returns notes, not finding */}
      {data?.notes && (
        <p className="font-body text-xs text-muted-foreground/70 italic border-t border-border/30 pt-3">
          {data.notes}
        </p>
      )}
    </InsightSection>
  );
}