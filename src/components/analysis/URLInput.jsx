import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Sparkles, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";

// Requires /product/, /products/, or /shop/ path — blocks blog/about/contact URLs
const PRODUCT_URL_PATTERN = /^https?:\/\/(www\.)?adlersden\.com\/(product|products|shop)\/[a-z0-9-]+/i;

export default function URLInput({ onAnalyse, isLoading }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const validateUrl = (value) => {
    if (!value.trim()) return 'Please enter a product URL';
    if (!value.includes('adlersden.com')) return "Please enter an Adler's Den URL (adlersden.com)";
    if (!PRODUCT_URL_PATTERN.test(value)) return 'URL must point to a product page — e.g. adlersden.com/product/dark-chocolate-bar';
    return '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationError = validateUrl(url);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    onAnalyse(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="w-full max-w-2xl mx-auto"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/30 via-primary/10 to-primary/30 rounded-2xl blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
          <div className="relative flex items-center gap-3 bg-card border border-border rounded-2xl px-5 py-4 focus-within:border-primary/40 transition-colors">
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <Input
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(''); }}
              placeholder="Paste an Adler's Den product URL..."
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 text-base font-body placeholder:text-muted-foreground/60 px-0"
              disabled={isLoading}
            />
            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="shrink-0 rounded-xl px-6 font-body font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Analyse
            </Button>
          </div>
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-destructive text-sm font-body pl-2"
          >
            {error}
          </motion.p>
        )}

        <p className="text-center text-muted-foreground/60 text-xs font-body flex items-center justify-center gap-1.5">
          <ExternalLink className="w-3 h-3" />
          e.g. https://adlersden.com/product/almond-rochers-in-dark-chocolate/
        </p>
      </form>
    </motion.div>
  );
}