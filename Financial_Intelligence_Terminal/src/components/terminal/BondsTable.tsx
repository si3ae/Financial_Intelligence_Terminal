/**
 * @file BondsTable.tsx
 * @description Displays government bond yields for major economies.
 *
 * DATA SOURCE: Receives a `data` prop typed as BondItem[], populated from
 * the static bondsData array in marketData.ts.
 *
 * WHY STATIC: Bond yield data (Treasury, Bund, JGB, Gilt) is not available
 * on Alpha Vantage's free plan. The GLOBAL_QUOTE endpoint only covers equities
 * and ETFs — fixed income instruments require a separate data provider.
 *
 * LIVE UPGRADE — FRED API (recommended):
 *   FRED (Federal Reserve Economic Data) provides free bond yield data with
 *   a generous limit of 500 requests/day. An API key is free at:
 *   https://fred.stlouisfed.org/docs/api/api_key.html
 *
 *   Series IDs to use:
 *     DGS2    → US 2Y Treasury yield (daily)
 *     DGS10   → US 10Y Treasury yield (daily)
 *     DGS30   → US 30Y Treasury yield (daily)
 *
 *   For non-US bonds, consider:
 *     - ECB Statistical Data Warehouse API (free, no key): sdw-wsrest.ecb.europa.eu
 *       Series: FM.B.U2.EUR.FR.BB.U2_2Y.R.O (2Y Bund equivalent)
 *     - Bank of Japan API: www.stat-search.boj.or.jp
 *     - Bank of England API: www.bankofengland.co.uk/boeapps/database
 *
 *   FRED fetch example (add to market-data Edge Function as action: 'bonds'):
 *   ──────────────────────────────────────────────────────────────────────────
 *   const FRED_KEY = Deno.env.get('FRED_API_KEY');
 *   const series = ['DGS2', 'DGS10', 'DGS30'];
 *   const results = await Promise.all(
 *     series.map(id =>
 *       fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&limit=2&sort_order=desc&api_key=${FRED_KEY}&file_type=json`)
 *         .then(r => r.json())
 *     )
 *   );
 *   // results[i].observations[0].value → latest yield
 *   // results[i].observations[0].value - results[i].observations[1].value → daily change
 *   ──────────────────────────────────────────────────────────────────────────
 *
 * DESIGN NOTES:
 *   - Yield is displayed to 3 decimal places (basis-point precision).
 *   - Change sign coloring: yield increase → red (ticker-negative) as rising
 *     yields indicate falling bond prices (inverse relationship).
 *   - Asset names are localized via translateAsset() for all 8 supported locales.
 */
import { type BondItem } from '@/data/marketData';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateAsset } from '@/i18n/assetNames';
import { motion } from 'framer-motion';

interface BondsTableProps {
  data: BondItem[];
}

const fast = { duration: 0.15, ease: 'easeOut' as const };

const BondsTable = ({ data }: BondsTableProps) => {
  const { locale, t } = useLanguage();

  return (
    <div className="glass-card p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-5">{t.globalBonds}</h3>
      <div className="space-y-3">
        {data.map((item) => (
          <motion.div
            key={item.name}
            className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg border-b border-border/50 last:border-0 cursor-default"
            whileHover={{ scale: 1.01, backgroundColor: 'hsla(var(--glass-bg), 0.6)' }}
            transition={fast}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{translateAsset(locale, item.name)}</p>
              <p className="text-xs text-muted-foreground">{item.maturity}</p>
            </div>
            <div className="text-right ml-4">
              <p className="text-sm num col-value text-foreground">{item.yield.toFixed(3)}%</p>
              {/* Note: rising yield = falling bond price, hence negative change = red */}
              <p className={`text-xs num col-change ${item.change >= 0 ? 'ticker-positive' : 'ticker-negative'}`}>
                {item.change >= 0 ? '+' : ''}{item.change.toFixed(3)}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default BondsTable;
