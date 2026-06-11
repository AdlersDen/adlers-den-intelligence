import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus, History, X, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { deleteAnalysis, clearAnalyses } from '@/lib/analysisService';

export default function Sidebar({ analyses = [], onAnalysesChange, mobile = false, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleDelete = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    deleteAnalysis(id);
    // Notify AppLayout to re-read localStorage
    onAnalysesChange?.();
    // If we're currently viewing the deleted report, go home
    if (location.search.includes(id)) {
      navigate('/');
    }
  };

  const handleClearAll = () => {
    clearAnalyses();
    onAnalysesChange?.();
    navigate('/');
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  };

  return (
    <aside className={`w-72 border-r border-border bg-card/50 flex flex-col h-screen shrink-0 ${mobile ? 'flex' : 'hidden md:flex'}`}>
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <Link to="/" className="block">
            <h2 className="font-heading text-xl font-bold text-foreground">
              Adler's <span className="text-primary">Den</span>
            </h2>
            <p className="font-body text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
              Product Intelligence
            </p>
          </Link>
          {mobile && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* New Analysis */}
      <div className="p-4">
        <Link
          to="/"
          className="flex items-center gap-2.5 w-full px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 text-primary font-body text-sm font-medium hover:bg-primary/15 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Analysis
        </Link>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex items-center justify-between px-2 py-2 mb-2">
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span className="font-body text-xs text-muted-foreground/60 uppercase tracking-wider">
              Recent
            </span>
          </div>
          {analyses.length > 0 && (
            <button
              onClick={handleClearAll}
              title="Clear all history"
              className="p-1 rounded text-muted-foreground/30 hover:text-destructive/60 hover:bg-destructive/5 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="space-y-0.5">
          <AnimatePresence initial={false}>
            {analyses.map((analysis) => {
              const isActive = location.search.includes(analysis.id);
              return (
                <motion.div
                  key={analysis.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <Link
                    to={`/report?id=${analysis.id}`}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg font-body text-xs transition-colors group ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {analysis.product_name || 'Untitled'}
                      </span>
                      <span className="block text-[10px] text-muted-foreground/50 mt-0.5">
                        {analysis.product_type === 'hamper'
                          ? 'Hamper'
                          : analysis.product_class === 'snack'
                          ? 'Snack'
                          : analysis.is_concept
                          ? 'Concept'
                          : 'Chocolate'} · {formatDate(analysis.created_date)}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, analysis.id)}
                      className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive/70 hover:bg-destructive/10 transition-all"
                      title="Remove from history"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {analyses.length === 0 && (
            <p className="px-3 py-6 text-xs font-body text-muted-foreground/40 text-center">
              No analyses yet
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border/50">
        <p className="font-body text-[10px] text-muted-foreground/25 text-center">
          Internal use only
        </p>
      </div>
    </aside>
  );
}