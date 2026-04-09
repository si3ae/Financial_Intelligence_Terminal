/**
 * @file MarketTable.tsx
 * @description Generic market data table used for indices, forex, and commodities.
 *
 * DATA SOURCE: Receives a `data` prop typed as MarketItem[], populated from
 * the static arrays in marketData.ts (indicesData, forexData, commoditiesData).
 *
 * WHY STATIC: Alpha Vantage free tier (5 req/min, 25 req/day) cannot support
 * live quotes for all symbols rendered across the three table instances on this
 * page without exhausting the daily quota on first load. See marketData.ts for
 * the full rationale and upgrade options.
 *
 * LIVE UPGRADE (when quota allows):
 *   The parent component can selectively inject live quotes by merging fetchQuote()
 *   results into the static data array before passing it as the `data` prop.
 *   This component requires no changes — it is intentionally data-agnostic.
 *
 * DESIGN NOTES:
 *   - Hover animation is handled by framer-motion (scale + background tint).
 *   - Asset names are localized via translateAsset() to support all 8 locales.
 *   - Color coding: positive change → green (ticker-positive), negative → red (ticker-negative).
 */
import { type MarketItem } from '@/data/marketData';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateAsset } from '@/i18n/assetNames';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

interface MarketTableProps {
  title: string;
  data: MarketItem[];
}

const fast = { duration: 0.15, ease: 'easeOut' as const };

const MarketTable = ({ title, data }: MarketTableProps) => {
  const { locale } = useLanguage();

  return (
    <div className="glass-card p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-5">{title}</h3>
      <div className="space-y-3">
        {data.map((item) => (
          <motion.div
            key={item.ticker}
            className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg border-b border-border/50 last:border-0 cursor-default"
            whileHover={{ scale: 1.01, backgroundColor: 'hsla(var(--glass-bg), 0.6)' }}
            transition={fast}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{translateAsset(locale, item.name)}</p>
              <p className="text-xs text-muted-foreground font-mono">{item.ticker}</p>
            </div>
            <div className="text-right ml-4">
              <p className="text-sm num col-value text-foreground">{item.price}</p>
              <div className={`flex items-center justify-end gap-1 text-xs num col-change ${item.changePercent >= 0 ? 'ticker-positive' : 'ticker-negative'}`}>
                {item.changePercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span>{item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default MarketTable;
