import React from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, Circle } from "lucide-react";

// Step J: step 2 label updated from "Classifying & extracting composition"
// to "Extracting composition" — reflects the merged single-call architecture (Step D)
const STEPS = [
  { id: 1, label: "Fetching product data" },
  { id: 2, label: "Extracting composition" },
  { id: 3, label: "Searching competitors" },
  { id: 4, label: "Running comparative analysis" },
  { id: 5, label: "Analysis complete" },
];

// Step J: updated key to match new onStep() string from analysisService.js
const STEP_MAP = {
  "fetching product data":        0,
  "extracting composition":       1,  // was "classifying product type"
  "searching competitors":        2,
  "running comparative analysis": 3,
  "analysis complete":            4,
};

function getStepStatus(stepIndex, currentStep) {
  const activeIndex = STEP_MAP[currentStep.toLowerCase()] ?? -1;
  if (activeIndex === -1) return 'pending';
  if (stepIndex < activeIndex)  return 'completed';
  if (stepIndex === activeIndex) return 'active';
  return 'pending';
}

// subStatus: optional sub-step text shown under step 3 (competitor enrichment progress)
export default function AnalysisProgress({ currentStep, subStatus }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full max-w-lg mx-auto py-12"
    >
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-4">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
          <span className="text-sm font-body font-medium text-primary">Analysing</span>
        </div>
        <p className="text-muted-foreground font-body text-sm">
          This typically takes 30–60 seconds
        </p>
      </div>

      <div className="space-y-1">
        {STEPS.map((step, index) => {
          const status = getStepStatus(index, currentStep);
          // Step J: only show subStatus under the "Searching competitors" step (index 2)
          const showSub = subStatus && status === 'active' && index === 2;

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: step.id * 0.08 }}
              className="flex items-start gap-4 py-3 px-4 rounded-xl transition-colors"
              style={{
                backgroundColor: status === 'active' ? 'hsl(var(--primary) / 0.05)' : 'transparent'
              }}
            >
              <div className="shrink-0 mt-0.5">
                <AnimatePresence mode="wait">
                  {status === 'completed' ? (
                    <motion.div
                      key="done"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center"
                    >
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                    </motion.div>
                  ) : status === 'active' ? (
                    <motion.div
                      key="active"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center"
                    >
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    </motion.div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                      <Circle className="w-3 h-3 text-muted-foreground/40" />
                    </div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex-1 min-w-0">
                <span className={`font-body text-sm transition-colors ${
                  status === 'completed' ? 'text-primary' :
                  status === 'active'    ? 'text-foreground font-medium' :
                  'text-muted-foreground/50'
                }`}>
                  {step.label}
                </span>

                {/* Step J: sub-status line under active competitor search step */}
                <AnimatePresence>
                  {showSub && (
                    <motion.p
                      key="substatus"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="font-body text-xs text-muted-foreground/60 mt-0.5"
                    >
                      {subStatus}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}