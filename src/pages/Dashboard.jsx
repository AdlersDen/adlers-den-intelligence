import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from "framer-motion";
import URLInput from '../components/analysis/URLInput';
import ConceptInput from '../components/analysis/ConceptInput';
import AnalysisProgress from '../components/analysis/AnalysisProgress';
import { runFullAnalysis, runConceptAnalysis, saveAnalysis } from '../lib/analysisService';
import { Sparkles, TrendingUp, FlaskConical, Lightbulb, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: TrendingUp,   title: "Pricing Analysis",    desc: "Benchmark against premium competitors" },
  { icon: FlaskConical, title: "Composition Quality", desc: "Compare ingredients & recipes" },
  { icon: Lightbulb,    title: "Smart Improvements",  desc: "AI-powered product suggestions" },
];

export default function Dashboard() {
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [currentStep, setCurrentStep]  = useState('');
  const [subStep, setSubStep]          = useState('');   // Step J: sub-status
  const [error, setError]              = useState('');
  const [lastUrl, setLastUrl]          = useState('');   // Step I: persists URL for retry
  const [mode, setMode]                = useState('existing'); // 'existing' (URL) or 'concept'
  const navigate = useNavigate();

  // Request browser notification permission on first interaction
  React.useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const notify = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, icon: '/favicon.svg' });
    }
  };

  const handleAnalyse = async (url) => {
    setIsAnalysing(true);
    setError('');
    setSubStep('');
    setLastUrl(url);  // Step I: store for retry
    setCurrentStep('Fetching product data');

    try {
      const result = await runFullAnalysis(
        url,
        setCurrentStep,  // onStep
        setSubStep,      // onSubStep (Step J)
      );

      const id       = crypto.randomUUID();
      const analysis = {
        id,
        product_url:         url,
        product_name:        result.productData.name,
        product_price:       result.productData.price,
        product_category:    result.productData.category,
        product_image:       result.productData.images?.[0] || null,
        product_type:        result.classification.type,
        classification_confidence: result.classification.confidence,
        product_description: result.productData.description,
        composition_profile: result.composition,
        data_completeness:   result.data_completeness,
        competitor_data:     result.competitorData.competitors,
        search_quality:      result.competitorData.search_quality,
        occasion_match:      result.competitorData.occasion_match || null,
        product_class:       result.competitorData.product_class || 'chocolate',
        report:              result.report,
        executive_summary:   result.report.executive_summary,
        overall_confidence:  result.report.overall_confidence,
        status:              'completed',
        created_date:        new Date().toISOString(),
      };

      saveAnalysis(analysis);
      notify('Analysis complete ✓', `${result.productData.name} — report ready`);
      navigate(`/report?id=${id}`);
    } catch (err) {
      console.error('Analysis failed:', err);

      // Step I: show which step failed if tagged
      const stepLabel = err.step
        ? `${err.step} failed`
        : 'Analysis failed';

      setError(`${stepLabel} — ${err.message || 'please try again.'}`);
      notify('Analysis failed', stepLabel);
      setIsAnalysing(false);
      setSubStep('');
    }
  };

  // Concept Product mode — same end shape as handleAnalyse but bypasses
  // /api/fetch-product. Saves with `is_concept: true` so the report renders
  // a "Concept" badge.
  const handleConcept = async (input) => {
    setIsAnalysing(true);
    setError('');
    setSubStep('');
    setCurrentStep('Preparing concept');
    try {
      const result = await runConceptAnalysis(input, setCurrentStep, setSubStep);
      const id = crypto.randomUUID();
      const analysis = {
        id,
        product_url:         null,
        product_name:        result.productData.name,
        product_price:       result.productData.price,
        product_category:    result.productData.category,
        product_image:       null,
        product_type:        result.classification.type,
        classification_confidence: result.classification.confidence,
        product_description: result.productData.description,
        composition_profile: result.composition,
        data_completeness:   result.data_completeness,
        competitor_data:     result.competitorData.competitors,
        search_quality:      result.competitorData.search_quality,
        occasion_match:      result.competitorData.occasion_match || null,
        product_class:       result.competitorData.product_class || 'chocolate',
        report:              result.report,
        executive_summary:   result.report.executive_summary,
        overall_confidence:  result.report.overall_confidence,
        is_concept:          true,
        status:              'completed',
        created_date:        new Date().toISOString(),
      };
      saveAnalysis(analysis);
      notify('Concept analysis complete ✓', `${result.productData.name} — report ready`);
      navigate(`/report?id=${id}`);
    } catch (err) {
      console.error('Concept analysis failed:', err);
      const stepLabel = err.step ? `${err.step} failed` : 'Concept analysis failed';
      setError(`${stepLabel} — ${err.message || 'please try again.'}`);
      notify('Concept analysis failed', stepLabel);
      setIsAnalysing(false);
      setSubStep('');
    }
  };

  // Step I: retry with the last URL without requiring re-paste
  const handleRetry = () => {
    if (lastUrl) handleAnalyse(lastUrl);
  };

  // Import a previously-exported analysis JSON. Validates the shape so a
  // wrong file gives a clear error instead of crashing the report page.
  const fileInputRef = useRef(null);
  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !parsed.report || !parsed.composition_profile) {
        throw new Error('not a valid Adler\'s Den analysis export');
      }
      const id = parsed.id || crypto.randomUUID();
      saveAnalysis({ ...parsed, id });
      navigate(`/report?id=${id}`);
    } catch (err) {
      setError(`Import failed — ${err.message}`);
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative">
      {/* Background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <AnimatePresence mode="wait">
        {isAnalysing ? (
          <AnalysisProgress
            key="progress"
            currentStep={currentStep}
            subStatus={subStep}   // Step J: sub-status line under step 3
          />
        ) : (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-2xl text-center space-y-8"
          >
            {/* Header */}
            <div className="space-y-3">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/20"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span className="font-body text-xs font-medium text-primary">Product Intelligence</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="font-heading text-4xl md:text-5xl font-bold text-foreground"
              >
                Analyse any<br />
                <span className="text-primary">Adler's Den</span> product
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="font-body text-muted-foreground max-w-md mx-auto"
              >
                Paste a product URL to get AI-powered competitive analysis — or sketch a concept you're planning and see how it would land.
              </motion.p>
            </div>

            {/* Mode tabs — existing URL vs concept product */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-card/50 border border-border/50">
              <button
                type="button"
                onClick={() => { setMode('existing'); setError(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-colors ${mode === 'existing' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Analyse existing product
              </button>
              <button
                type="button"
                onClick={() => { setMode('concept'); setError(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-colors ${mode === 'concept' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Plan a concept product
              </button>
            </div>

            {/* Mode-specific input */}
            {mode === 'existing'
              ? <URLInput onAnalyse={handleAnalyse} isLoading={isAnalysing} />
              : <ConceptInput onAnalyse={handleConcept} isLoading={isAnalysing} />
            }

            {/* Import a previously-exported analysis JSON */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              type="button"
              onClick={handleImportClick}
              className="inline-flex items-center gap-1.5 text-xs font-body text-muted-foreground hover:text-foreground transition-colors -mt-2"
            >
              <Upload className="w-3 h-3" />
              Import a previously exported analysis
            </button>

            {/* Step I: Error + Retry */}
            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-destructive text-sm font-body">{error}</p>
                {lastUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    className="font-body text-xs gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </Button>
                )}
              </motion.div>
            )}

            {/* Feature cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8"
            >
              {FEATURES.map((feature, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-2.5 p-5 rounded-2xl bg-card/50 border border-border/50 hover:border-primary/20 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <feature.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-heading text-sm font-semibold text-foreground">{feature.title}</h3>
                  <p className="font-body text-xs text-muted-foreground text-center">{feature.desc}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}