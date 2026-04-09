/**
 * Index.tsx — Global Financial Terminal (Live Data Edition)
 *
 * This file exports the Index page component used by the router in App.tsx.
 * It does NOT mount its own React root — that happens once in main.tsx via
 * `createRoot(document.getElementById('root')!).render(<App />)`. An earlier
 * version of this file called createRoot at module top-level, which caused
 * the page to be rendered twice (once inside the router's provider tree from
 * App.tsx, and a second time outside it from this module's side effect),
 * detaching any consumer of QueryClient/Tooltip/Router context on the second
 * render. Removed.
 */
import { lazy, Suspense, memo, useMemo } from 'react';
import { LanguageProvider, useLanguage } from '@/i18n/LanguageContext';
import { StockProvider } from '@/hooks/useStockContext';
import { ThemeProvider } from '@/hooks/useTheme';
import { Skeleton } from '@/components/ui/skeleton';
import {
  forexData,
  commoditiesData,
  bondsData,
  macroData,
} from '@/data/marketData';

// ─── Lazy imports ───────────────────────────────────────────────────────────
const TerminalHeader   = lazy(() => import('@/components/terminal/TerminalHeader'));
const StockChart       = lazy(() => import('@/components/terminal/StockChart'));
const MarketTable      = lazy(() => import('@/components/terminal/MarketTable'));
const BondsTable       = lazy(() => import('@/components/terminal/BondsTable'));
const MacroTable       = lazy(() => import('@/components/terminal/MacroTable'));
const MacroInsightCard = lazy(() => import('@/components/terminal/MacroInsightCard'));
const LiveNewsFeed     = lazy(() => import('@/components/terminal/LiveNewsFeed'));
const LiveCryptoTable  = lazy(() => import('@/components/terminal/LiveCryptoTable'));
const EconomicCalendar = lazy(() => import('@/components/terminal/EconomicCalendar'));
const PortfolioPanel   = lazy(() => import('@/components/terminal/PortfolioPanel'));
const AIAssistantPanel = lazy(() => import('@/components/terminal/AIAssistantPanel'));

// ─── Skeleton fallback ──────────────────────────────────────────────────────
const CardSkeleton = memo(() => (
  <div className="glass-card p-6">
    <Skeleton className="h-4 w-1/3 mb-4" />
    <Skeleton className="h-3 w-full mb-2" />
    <Skeleton className="h-3 w-full mb-2" />
    <Skeleton className="h-3 w-2/3" />
  </div>
));
CardSkeleton.displayName = 'CardSkeleton';

const ChartSkeleton = memo(() => (
  <div className="glass-card p-6 col-span-full xl:col-span-2">
    <Skeleton className="h-6 w-1/4 mb-4" />
    <Skeleton className="h-[320px] w-full rounded-lg" />
  </div>
));
ChartSkeleton.displayName = 'ChartSkeleton';

// ─── Main content ───────────────────────────────────────────────────────────
const TerminalContent = memo(() => {
  const { t } = useLanguage();

  const memoForex       = useMemo(() => forexData, []);
  const memoCommodities = useMemo(() => commoditiesData, []);
  const memoBonds       = useMemo(() => bondsData, []);
  const memoMacro       = useMemo(() => macroData, []);

  return (
    <div className="terminal-root min-h-screen p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto">
      <Suspense fallback={<Skeleton className="h-12 w-full mb-6" />}>
        <TerminalHeader />
      </Suspense>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <Suspense fallback={<ChartSkeleton />}>
          <StockChart />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <MacroInsightCard />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <LiveNewsFeed />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <EconomicCalendar />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <MarketTable title={t.currencyPairs} data={memoForex} />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <MarketTable title={t.energyMetals} data={memoCommodities} />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <BondsTable data={memoBonds} />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <LiveCryptoTable />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <PortfolioPanel />
        </Suspense>

        <Suspense fallback={<CardSkeleton />}>
          <MacroTable data={memoMacro} />
        </Suspense>
      </div>

      <footer className="mt-8 text-center text-xs text-muted-foreground pb-6">
        <p className="font-mono opacity-60">
          Live data powered by Alpha Vantage, CoinGecko & NewsAPI · © 2026
        </p>
      </footer>

      {/* Floating AI Assistant */}
      <Suspense fallback={null}>
        <AIAssistantPanel />
      </Suspense>
    </div>
  );
});
TerminalContent.displayName = 'TerminalContent';

// ─── Root ───────────────────────────────────────────────────────────────────
const Index = () => (
  <ThemeProvider>
    <LanguageProvider>
      <StockProvider>
        <TerminalContent />
      </StockProvider>
    </LanguageProvider>
  </ThemeProvider>
);

export default Index;
