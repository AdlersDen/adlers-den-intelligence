import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { getAnalyses } from '@/lib/analysisService';
import { Menu } from 'lucide-react';

export default function AppLayout() {
  const [analyses, setAnalyses] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const refreshAnalyses = useCallback(() => {
    setAnalyses(getAnalyses());
  }, []);

  // Re-read on every route change (covers: navigate after analysis completes,
  // delete from sidebar, clear-all). sessionStorage is per-tab so a cross-tab
  // `storage` listener wouldn't fire anyway — route change is the sync point.
  useEffect(() => {
    refreshAnalyses();
  }, [location.pathname, location.search, refreshAnalyses]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — always visible on md+ */}
      <Sidebar analyses={analyses} onAnalysesChange={refreshAnalyses} />

      {/* Mobile overlay sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 animate-slide-in-left">
            <Sidebar analyses={analyses} onAnalysesChange={refreshAnalyses} mobile onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        {/* Mobile header bar */}
        <div className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-md md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h2 className="font-heading text-lg font-bold text-foreground">
            Adler's <span className="text-primary">Den</span>
          </h2>
        </div>
        <Outlet />
      </main>
    </div>
  );
}