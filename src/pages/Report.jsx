import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, AlertCircle, Info } from "lucide-react";
import { Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { getAnalysisById } from '@/lib/analysisService';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import ExecutiveSummary from '../components/report/ExecutiveSummary';
import PricingSection from '../components/report/PricingSection';
import CompositionSection from '../components/report/CompositionSection';
import ImprovementsSection from '../components/report/ImprovementsSection';
import MarketGapsSection from '../components/report/MarketGapsSection';
import CompetitorTable from '../components/report/CompetitorTable';
import CompositionProfile from '../components/report/CompositionProfile';

export default function Report() {
  const [searchParams] = useSearchParams();
  const analysisId = searchParams.get('id');

  // Hooks must run unconditionally on every render — keep this above the
  // early returns below (React rules-of-hooks).
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  // Read directly from localStorage — no async needed
  const analysis = analysisId ? getAnalysisById(analysisId) : null;

  if (!analysis) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-muted-foreground/40" />
        <p className="font-body text-muted-foreground">Analysis not found</p>
        <Link to="/">
          <Button variant="outline" className="font-body">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  if (analysis.status === 'processing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="font-body text-muted-foreground">Analysis is still processing…</p>
      </div>
    );
  }

  const report = analysis.report;
  const productData = {
    name: analysis.product_name,
    price: analysis.product_price,
    category: analysis.product_category,
    image: analysis.product_image,
  };

  // PRD §9.5 — Missing-data behaviour. Show a "directional insights" banner
  // when the analysis is built on thin inputs, so the founder reads the
  // report with the right caveat instead of taking it as authoritative.
  const dc = analysis.data_completeness;
  const competitorCount = Array.isArray(analysis.competitor_data) ? analysis.competitor_data.length : 0;
  const isLowData =
    (dc && typeof dc.ratio === 'number' && dc.ratio < 50) ||
    report?.overall_confidence === 'low' ||
    competitorCount <= 1;
  const lowDataReasons = [];
  if (dc && typeof dc.ratio === 'number' && dc.ratio < 50) lowDataReasons.push(`only ${dc.filled}/${dc.total} composition fields were extracted`);
  if (competitorCount <= 1) lowDataReasons.push(`${competitorCount === 0 ? 'no' : 'only one'} live competitor${competitorCount === 1 ? '' : 's'} found`);
  if (report?.overall_confidence === 'low') lowDataReasons.push('overall model confidence is low');

  const handleDownloadPDF = async () => {
    const element = document.getElementById('report-content');
    if (!element) return;

    setIsPdfLoading(true);
    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Adlers-Den-Report-${productData.name.replace(/\s+/g, '-')}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF', err);
    } finally {
      setIsPdfLoading(false);
    }
  };

  // Export the full analysis as JSON so a sales rep can email it or
  // re-import it on another machine. Matches the localStorage shape so
  // Dashboard's "Import" can round-trip it.
  const handleExportJSON = () => {
    const slug = (productData.name || 'analysis').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adlers-den-analysis-${slug}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen py-8 px-6 md:px-12 max-w-4xl mx-auto">
      {/* Header with Back and PDF Export */}
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-8 flex justify-between items-center"
      >
        <Link to="/">
          <Button variant="ghost" className="font-body text-muted-foreground hover:text-foreground gap-2 -ml-3">
            <ArrowLeft className="w-4 h-4" />
            New Analysis
          </Button>
        </Link>
        <div className="flex gap-2">
          <Button onClick={handleExportJSON} variant="ghost" className="font-body gap-2 text-muted-foreground hover:text-foreground">
            Export JSON
          </Button>
          <Button onClick={handleDownloadPDF} variant="outline" className="font-body gap-2" disabled={isPdfLoading}>
            {isPdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isPdfLoading ? 'Generating…' : 'Download PDF'}
          </Button>
        </div>
      </motion.div>

      <div id="report-content" className="space-y-6 bg-background p-4 -m-4 rounded-xl">
        {/* Concept-mode badge — this is positioning advice, not commentary
            on a live SKU. Renders above all banners so it sets the frame. */}
        {analysis.is_concept && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 w-fit"
          >
            <span className="text-xs font-body font-medium text-primary">Concept analysis</span>
            <span className="text-xs font-body text-muted-foreground">positioning advice for a product not yet launched</span>
          </motion.div>
        )}

        {/* PRD §9.5 — directional-insights banner for thin data */}
        {isLowData && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
          >
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-body text-sm font-medium text-amber-300">
                Limited product data available — insights below are directional.
              </p>
              {lowDataReasons.length > 0 && (
                <p className="font-body text-xs text-amber-300/70 mt-0.5">
                  {lowDataReasons.join(' · ')}. Treat verdicts as guidance, not final figures.
                </p>
              )}
              {Array.isArray(dc?.missing) && dc.missing.length > 0 && (
                <details className="mt-1.5">
                  <summary className="font-body text-xs text-amber-300/80 cursor-pointer select-none hover:text-amber-200 w-fit">
                    Show the {dc.missing.length} field{dc.missing.length !== 1 ? 's' : ''} we could not extract
                  </summary>
                  <p className="font-body text-xs text-amber-300/60 mt-1">
                    {dc.missing.join(' · ')} — the source page does not state these, so they are omitted from the analysis rather than guessed.
                  </p>
                </details>
              )}
            </div>
          </motion.div>
        )}

        {/* Occasion-mismatch banner — tool detected an occasion (Diwali,
            Valentine, etc.) but the competitor catalogs don't stock enough
            matching SKUs, so some comparators below are generic fillers. */}
        {analysis.occasion_match && !analysis.occasion_match.sufficient && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
          >
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-body text-sm font-medium text-amber-300">
                Limited direct {analysis.occasion_match.detected.charAt(0).toUpperCase() + analysis.occasion_match.detected.slice(1)} matches available.
              </p>
              <p className="font-body text-xs text-amber-300/70 mt-0.5">
                Only {analysis.occasion_match.found_count} competitor{analysis.occasion_match.found_count === 1 ? '' : 's'} in the candidate brands sell an explicitly {analysis.occasion_match.detected}-themed product. Remaining comparators below are the closest generic alternatives from the same brands — treat occasion-specific framing with care.
              </p>
            </div>
          </motion.div>
        )}

        {/* Executive Summary */}
        <ExecutiveSummary
          productData={productData}
          classification={{ type: analysis.product_type }}
          report={report}
        />

        {/* Composition Profile */}
        <CompositionProfile
          composition={analysis.composition_profile}
          productType={analysis.product_type}
          classificationConfidence={analysis.classification_confidence}
          dataCompleteness={analysis.data_completeness}
        />

        {/* 4 Insight Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PricingSection data={report?.pricing_verdict} index={0} />
          <CompositionSection data={report?.composition_quality} index={1} />
          <ImprovementsSection data={report?.improvements} index={2} />
          <MarketGapsSection data={report?.market_gaps} sectionConfidence={report?.market_gaps_confidence} index={3} />
        </div>

        {/* Competitor Table */}
        <CompetitorTable
          competitors={analysis.competitor_data}
          searchQuality={analysis.search_quality}
        />
      </div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="text-center py-12 mt-8 border-t border-border/50"
      >
        <p className="font-body text-xs text-muted-foreground/40">
          Generated by Adler's Den Product Intelligence Tool · {new Date(analysis.created_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </motion.div>
    </div>
  );
}