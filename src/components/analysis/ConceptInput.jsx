import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';
import { Sparkles, FlaskConical, Type } from 'lucide-react';

// Concept Product input — two modes:
//   "free"     : single textarea, AI extracts composition (matches existing pipeline)
//   "structured": typed fields (name, price, format, ingredients...) so we skip
//                 extraction entirely and feed a hand-built composition forward.
// On submit, hands the parent { mode, ...payload } and lets analysisService.js
// pick the right pipeline (runConceptAnalysisFree vs runConceptAnalysisStructured).
const FORMATS = [
  'bar', 'rocher', 'truffle', 'praline', 'bonbon', 'dragees',
  'barks', 'coated_nuts', 'cluster', 'bites', 'gianduja', 'spread', 'other',
];
const CHOCOLATE_TYPES = ['dark', 'milk', 'white', 'ruby', 'blended'];
const OCCASIONS = ['none', 'diwali', 'christmas', 'valentine', 'rakhi', 'mother', 'father', 'birthday', 'easter', 'holi', 'ganesh', 'corporate', 'newyear'];
const OCCASION_LABELS = {
  none: 'None', diwali: 'Diwali', christmas: 'Christmas', valentine: "Valentine's Day",
  rakhi: 'Rakhi', mother: "Mother's Day", father: "Father's Day", birthday: 'Birthday',
  easter: 'Easter', holi: 'Holi', ganesh: 'Ganesh Chaturthi', corporate: 'Corporate',
  newyear: 'New Year',
};

export default function ConceptInput({ onAnalyse, isLoading }) {
  const [mode, setMode] = useState('structured');

  // Structured-mode fields
  const [name, setName]               = useState('');
  const [price, setPrice]             = useState('');
  const [format, setFormat]           = useState('bar');
  const [chocoType, setChocoType]     = useState('dark');
  const [cocoaPct, setCocoaPct]       = useState('');
  const [weightG, setWeightG]         = useState('');
  const [ingredients, setIngredients] = useState('');
  const [occasion, setOccasion]       = useState('none');
  const [positioning, setPositioning] = useState('');

  // Free-text mode
  const [freeText, setFreeText] = useState('');

  const [error, setError] = useState('');

  const submitStructured = () => {
    if (!name.trim() || !price.trim()) {
      setError('Name and target price are required.');
      return;
    }
    const ingList = ingredients
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    onAnalyse({
      mode: 'concept_structured',
      name: name.trim(),
      price: price.trim().startsWith('₹') ? price.trim() : `₹${price.trim()}`,
      format,
      chocolate_type: chocoType,
      cocoa_percentage: cocoaPct ? parseInt(cocoaPct, 10) : null,
      weight_grams:     weightG  ? parseInt(weightG, 10)  : null,
      ingredients: ingList,
      occasion: occasion === 'none' ? null : occasion,
      positioning: positioning.trim(),
    });
  };

  const submitFree = () => {
    if (!freeText.trim() || freeText.trim().length < 30) {
      setError('Please write at least a sentence or two describing the concept.');
      return;
    }
    onAnalyse({ mode: 'concept_free', text: freeText.trim() });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'structured') submitStructured();
    else submitFree();
  };

  const tabBase   = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body font-medium transition-colors';
  const tabActive = 'bg-primary/10 text-primary border border-primary/20';
  const tabIdle   = 'text-muted-foreground hover:text-foreground border border-transparent';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-2xl mx-auto"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Mode tabs */}
        <div className="flex items-center gap-2 justify-center">
          <button type="button" onClick={() => setMode('structured')} className={`${tabBase} ${mode === 'structured' ? tabActive : tabIdle}`}>
            <FlaskConical className="w-3.5 h-3.5" />
            Structured form
          </button>
          <button type="button" onClick={() => setMode('free')} className={`${tabBase} ${mode === 'free' ? tabActive : tabIdle}`}>
            <Type className="w-3.5 h-3.5" />
            Free-text brief
          </button>
        </div>

        {mode === 'structured' ? (
          <div className="bg-card border border-border rounded-2xl px-5 py-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Concept name *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 70% Dark Sea-Salt Cardamom Bar" disabled={isLoading} />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Target price (₹) *</label>
                <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="320" inputMode="numeric" disabled={isLoading} />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Format</label>
                <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={isLoading} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-body text-foreground [&>option]:bg-card [&>option]:text-foreground">
                  {FORMATS.map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Chocolate type</label>
                <select value={chocoType} onChange={(e) => setChocoType(e.target.value)} disabled={isLoading} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-body text-foreground [&>option]:bg-card [&>option]:text-foreground">
                  {CHOCOLATE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Cocoa %</label>
                <Input value={cocoaPct} onChange={(e) => setCocoaPct(e.target.value)} placeholder="70" inputMode="numeric" disabled={isLoading} />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Weight (g)</label>
                <Input value={weightG} onChange={(e) => setWeightG(e.target.value)} placeholder="65" inputMode="numeric" disabled={isLoading} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-body text-muted-foreground mb-1 block">Key ingredients (comma-separated)</label>
                <Input value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder="sea salt, cardamom, almond" disabled={isLoading} />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Occasion</label>
                <select value={occasion} onChange={(e) => setOccasion(e.target.value)} disabled={isLoading} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-body text-foreground [&>option]:bg-card [&>option]:text-foreground">
                  {OCCASIONS.map(o => <option key={o} value={o}>{OCCASION_LABELS[o] || o}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-body text-muted-foreground mb-1 block">Positioning notes (optional)</label>
                <textarea
                  value={positioning}
                  onChange={(e) => setPositioning(e.target.value)}
                  placeholder="Who is this for, why now?"
                  disabled={isLoading}
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-body resize-y"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl px-5 py-4">
            <label className="text-xs font-body text-muted-foreground mb-1 block">Describe the concept</label>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="e.g. Thinking about a 70% dark sea-salt bar with cardamom at ₹320, 65g, targeting the festive gifting segment."
              disabled={isLoading}
              rows={6}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-body resize-y"
            />
          </div>
        )}

        <div className="flex justify-center">
          <Button type="submit" disabled={isLoading} className="rounded-xl px-6 font-body font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
            <Sparkles className="w-4 h-4 mr-2" />
            Run concept analysis
          </Button>
        </div>

        {error && (
          <p className="text-destructive text-sm font-body text-center">{error}</p>
        )}
      </form>
    </motion.div>
  );
}
