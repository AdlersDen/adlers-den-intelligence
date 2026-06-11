import React from 'react';
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, IndianRupee } from "lucide-react";

export default function CompetitorTable({ competitors, searchQuality }) {
  if (!competitors?.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
    >
      <Card className="bg-card border-border">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="font-heading text-lg text-foreground">
              Competitor Products Found
            </CardTitle>
            {searchQuality && (
              <Badge variant="outline" className="font-body text-xs text-muted-foreground border-border">
                Search quality: {searchQuality}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {competitors.map((comp, i) => (
              <div
                key={i}
                className="flex items-start gap-4 p-4 rounded-xl bg-background/50 border border-border/50 hover:border-primary/20 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="font-heading text-sm font-bold text-primary">
                    {comp.brand?.[0]?.toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-body text-sm font-semibold text-foreground truncate">
                        {comp.product_name}
                      </h4>
                      <p className="text-xs font-body text-muted-foreground">{comp.brand}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* price comes from backend as a string ("₹1,299") or "N/A";
                          price_numeric is the parsed integer. Prefer numeric, fall
                          back to the formatted string when present. */}
                      {comp.price_numeric > 0 ? (
                        <span className="flex items-center gap-0.5 text-sm font-heading font-semibold text-primary">
                          <IndianRupee className="w-3.5 h-3.5" />
                          {comp.price_numeric.toLocaleString('en-IN')}
                        </span>
                      ) : (comp.price && comp.price !== 'N/A') ? (
                        <span className="text-sm font-heading font-semibold text-primary">
                          {comp.price}
                        </span>
                      ) : null}
                      {comp.url && (
                        <a
                          href={comp.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  {comp.description && (
                    <p className="mt-1.5 text-xs font-body text-muted-foreground/80 line-clamp-2">
                      {comp.description}
                    </p>
                  )}
                  {comp.key_features?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {comp.key_features.slice(0, 3).map((f, j) => (
                        <Badge key={j} variant="outline" className="text-[10px] font-body text-muted-foreground/70 border-border/50">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}