import React from 'react';
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ConfidenceBadge from './ConfidenceBadge';
import { Package, Layers } from "lucide-react";

// Field names mirror extract-composition.js output schema exactly.
// hamper:  items[{ name, category, chocolate_type, cocoa_percentage, quantity, weight_grams, attributes, notes }]
//          packaging_quality, occasion_fit[], chocolate_types_present[], has_non_chocolate_items, summary
// single:  chocolate_type, cocoa_percentage, origin_country, origin_region, is_indian_origin, is_bean_to_bar,
//          ingredients[], key_flavour_notes[], texture, weight_grams, dietary{...},
//          certifications[], processing_method, quality_tier, unique_selling_points[], summary
export default function CompositionProfile({ composition, productType, classificationConfidence, dataCompleteness }) {
  if (!composition) return null;

  const isHamper = productType === 'hamper';

  // Use data completeness level when available; fall back to classification confidence
  const confidenceLevel = dataCompleteness?.level || classificationConfidence || 'medium';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
    >
      <Card className="bg-card border-border">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="font-heading text-lg text-foreground">
                  Composition Profile
                </CardTitle>
                <p className="text-xs font-body text-muted-foreground mt-0.5">
                  {isHamper ? 'Hamper contents breakdown' : 'Chocolate composition details'}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <ConfidenceBadge level={confidenceLevel} />
              {dataCompleteness && (
                Array.isArray(dataCompleteness.missing) && dataCompleteness.missing.length > 0 ? (
                  <details className="text-right">
                    <summary className="text-[10px] font-body text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground w-fit ml-auto">
                      {dataCompleteness.filled}/{dataCompleteness.total} fields extracted ▾
                    </summary>
                    <p className="text-[10px] font-body text-muted-foreground/50 mt-1 max-w-[240px]">
                      Not on the source page: {dataCompleteness.missing.join(', ')}
                    </p>
                  </details>
                ) : (
                  <span className="text-[10px] font-body text-muted-foreground/60">
                    {dataCompleteness.filled}/{dataCompleteness.total} fields extracted
                  </span>
                )
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isHamper ? (
            <div className="space-y-4">
              {/* Hamper summary line — total items, packaging, types present */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-body text-muted-foreground">
                {composition.items?.length > 0 && (
                  <span>Items: <span className="text-foreground font-medium">{composition.items.length}</span></span>
                )}
                {composition.total_weight_grams && (
                  <span>· Total weight: <span className="text-foreground font-medium">{composition.total_weight_grams}g</span></span>
                )}
                {composition.packaging_quality && (
                  <Badge variant="outline" className="text-[10px] font-body text-primary/70 border-primary/20 capitalize">
                    {composition.packaging_quality} packaging
                  </Badge>
                )}
              </div>

              {/* Items grid */}
              {composition.items?.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {composition.items.map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-background/50 border border-border/50">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Package className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-body text-sm font-medium text-foreground truncate">{item.name}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {item.quantity && (
                            <Badge variant="outline" className="text-[10px] font-body text-muted-foreground border-border/50">
                              Qty: {item.quantity}
                            </Badge>
                          )}
                          {item.weight_grams && (
                            <Badge variant="outline" className="text-[10px] font-body text-muted-foreground border-border/50">
                              {item.weight_grams}g
                            </Badge>
                          )}
                          {item.category && (
                            <Badge variant="outline" className="text-[10px] font-body text-primary/70 border-primary/20">
                              {item.category.replace(/_/g, ' ')}
                            </Badge>
                          )}
                          {item.chocolate_type && (
                            <Badge variant="outline" className="text-[10px] font-body text-foreground/70 border-border capitalize">
                              {item.chocolate_type}
                            </Badge>
                          )}
                          {item.cocoa_percentage && (
                            <Badge variant="outline" className="text-[10px] font-body text-foreground/70 border-border">
                              {item.cocoa_percentage}%
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Hamper-level tags */}
              {composition.chocolate_types_present?.length > 0 && (
                <div>
                  <p className="text-xs font-body text-muted-foreground mb-2">Chocolate Types</p>
                  <div className="flex flex-wrap gap-1.5">
                    {composition.chocolate_types_present.map((t, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-body text-foreground/70 border-border capitalize">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {composition.occasion_fit?.length > 0 && (
                <div>
                  <p className="text-xs font-body text-muted-foreground mb-2">Occasion Fit</p>
                  <div className="flex flex-wrap gap-1.5">
                    {composition.occasion_fit.map((o, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-body text-foreground/70 border-border">
                        {o.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {composition.summary && (
                <p className="font-body text-xs text-muted-foreground/70 italic border-t border-border/30 pt-3">
                  {composition.summary}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {composition.format && (
                  <div>
                    <p className="text-xs font-body text-muted-foreground mb-1">Format</p>
                    <p className="font-body text-sm font-medium text-foreground capitalize">{composition.format.replace(/_/g, ' ')}</p>
                  </div>
                )}
                {composition.chocolate_type && (
                  <div>
                    <p className="text-xs font-body text-muted-foreground mb-1">Chocolate Type</p>
                    <p className="font-body text-sm font-medium text-foreground capitalize">{composition.chocolate_type}</p>
                  </div>
                )}
                {composition.cocoa_percentage && (
                  <div>
                    <p className="text-xs font-body text-muted-foreground mb-1">Cocoa</p>
                    <p className="font-body text-sm font-medium text-foreground">{composition.cocoa_percentage}%</p>
                  </div>
                )}
                {(composition.origin_region || composition.origin_country) && (
                  <div>
                    <p className="text-xs font-body text-muted-foreground mb-1">Origin</p>
                    <p className="font-body text-sm font-medium text-foreground">
                      {[composition.origin_region, composition.origin_country].filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
                {composition.weight_grams && (
                  <div>
                    <p className="text-xs font-body text-muted-foreground mb-1">Weight</p>
                    <p className="font-body text-sm font-medium text-foreground">
                      {Array.isArray(composition.weight_grams)
                        ? composition.weight_grams.map(w => `${w}g`).join(' / ')
                        : `${composition.weight_grams}g`}
                    </p>
                  </div>
                )}
                {composition.processing_method && (
                  <div>
                    <p className="text-xs font-body text-muted-foreground mb-1">Processing</p>
                    <p className="font-body text-sm font-medium text-foreground capitalize">
                      {composition.processing_method.replace(/_/g, ' ')}
                    </p>
                  </div>
                )}
                {composition.quality_tier && (
                  <div>
                    <p className="text-xs font-body text-muted-foreground mb-1">Quality Tier</p>
                    <p className="font-body text-sm font-medium text-foreground capitalize">
                      {composition.quality_tier.replace(/_/g, ' ')}
                    </p>
                  </div>
                )}
              </div>

              {/* Credential row */}
              {(composition.is_bean_to_bar || composition.is_indian_origin) && (
                <div className="flex flex-wrap gap-1.5">
                  {composition.is_bean_to_bar && (
                    <Badge variant="outline" className="text-xs font-body bg-primary/10 text-primary border-primary/20">
                      Bean-to-bar
                    </Badge>
                  )}
                  {composition.is_indian_origin && (
                    <Badge variant="outline" className="text-xs font-body bg-primary/10 text-primary border-primary/20">
                      Indian origin
                    </Badge>
                  )}
                </div>
              )}

              {/* Pack options — the real purchasable sizes/prices from the
                  product description (e.g. ₹259/65g pouch, ₹389/100g jar) */}
              {composition.pack_options?.length > 0 && (
                <div>
                  <p className="text-xs font-body text-muted-foreground mb-2">Available Packs</p>
                  <div className="flex flex-wrap gap-1.5">
                    {composition.pack_options.map((pack, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-body text-foreground/80 border-border">
                        {(() => {
                          const detail = [
                            pack.price_numeric ? `₹${pack.price_numeric}` : null,
                            pack.weight_grams ? `${pack.weight_grams}g` : null,
                          ].filter(Boolean).join(' · ');
                          if (!detail) return pack.label || '—';
                          return pack.label ? `${pack.label}: ${detail}` : detail;
                        })()}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Flavour notes — API field: key_flavour_notes[] */}
              {composition.key_flavour_notes?.length > 0 && (
                <div>
                  <p className="text-xs font-body text-muted-foreground mb-2">Flavour Notes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {composition.key_flavour_notes.map((note, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-body text-foreground/70 border-border">
                        {note}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Ingredients — API field: ingredients[] */}
              {composition.ingredients?.length > 0 && (
                <div>
                  <p className="text-xs font-body text-muted-foreground mb-2">Ingredients</p>
                  <div className="flex flex-wrap gap-1.5">
                    {composition.ingredients.map((ing, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-body text-foreground/70 border-border">
                        {ing}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Dietary attributes (object: vegan/gluten_free/sugar_free/dairy_free/soy_free) */}
              {composition.dietary && Object.values(composition.dietary).some(Boolean) && (
                <div>
                  <p className="text-xs font-body text-muted-foreground mb-2">Dietary</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(composition.dietary)
                      .filter(([, v]) => v === true)
                      .map(([k]) => (
                        <Badge variant="outline" key={k} className="text-xs font-body bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                          {k.replace(/_/g, '-')}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}

              {composition.certifications?.length > 0 && (
                <div>
                  <p className="text-xs font-body text-muted-foreground mb-2">Certifications</p>
                  <div className="flex flex-wrap gap-1.5">
                    {composition.certifications.map((cert, i) => (
                      <Badge variant="outline" key={i} className="text-xs font-body bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                        {cert}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {composition.summary && (
                <p className="font-body text-xs text-muted-foreground/70 italic border-t border-border/30 pt-3">
                  {composition.summary}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}