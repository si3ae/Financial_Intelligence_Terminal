/**
 * @file MacroTable.tsx
 * @description Full-width table displaying macroeconomic indicators for major economies.
 *
 * DATA SOURCE: Receives a `data` prop typed as MacroItem[], populated from
 * the static macroData array in marketData.ts.
 *
 * WHY STATIC: Macroeconomic figures (GDP, CPI, unemployment, policy rate) are
 * published on a quarterly or monthly cadence by national statistics agencies
 * and central banks. They do not change intraday, making real-time polling
 * unnecessary and wasteful of API quota.
 *
 * UPDATE CADENCE (manual refresh recommended after):
 *   - GDP growth   → quarterly (BEA, Eurostat, NBS, Cabinet Office, BOK, ONS)
 *   - CPI inflation → monthly (BLS, Eurostat, NBS, MIC, KOSTAT, ONS)
 *   - Unemployment → monthly (BLS, Eurostat, NBS, MIC, KOSTAT, ONS)
 *   - Policy rate  → each central bank meeting (FOMC, ECB, PBoC, BoJ, BoK, BoE)
 *
 * AUTOMATED ALTERNATIVE:
 *   - World Bank API (free, no auth): api.worldbank.org/v2/country/{iso}/indicator/{code}
 *     Indicator codes: NY.GDP.MKTP.KD.ZG (GDP growth), FP.CPI.TOTL.ZG (CPI),
 *                      SL.UEM.TOTL.ZS (unemployment)
 *   - IMF Data API (free): imf.org/external/datamapper/api
 *   - OECD Data API (free): data.oecd.org
 *   Note: All three lag by 1–4 quarters. For policy rates, parse central bank
 *   press release pages or use a financial data vendor.
 *
 * COLOR CODING LOGIC:
 *   - GDP ≥ 2%     → green  (healthy growth threshold, loosely OECD-aligned)
 *   - Inflation > 3% → red  (above most central bank comfort zones of 2–3%)
 *   Unemployment and policy rate are neutral (no color threshold applied) as
 *   their ideal values are highly context-dependent per economy.
 *
 * LAYOUT NOTES:
 *   - Uses `table-layout: fixed` with a wider first column (240px) to prevent
 *     country name overflow from disturbing numeric column alignment.
 *   - `col-span-full` ensures this table always spans the full grid width
 *     regardless of the parent grid column count.
 *   - Asset names (country names) are localized via translateAsset() to support
 *     all 8 locales (ko, en, zh, ja, gb, de, fr, it).
 */
import { type MacroItem } from '@/data/marketData';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateAsset } from '@/i18n/assetNames';

interface MacroTableProps {
  data: MacroItem[];
}

const MacroTable = ({ data }: MacroTableProps) => {
  const { locale, t } = useLanguage();

  return (
    <div className="glass-card p-6 col-span-full">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-5">{t.economicIndicators}</h3>
      <div className="overflow-x-auto">
        {/* table-layout: fixed keeps numeric columns stable regardless of content width */}
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 240 }} />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 pr-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">{t.centralBank}</th>
              <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">{t.gdpGrowth}</th>
              <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">{t.inflation}</th>
              <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">{t.unemployment}</th>
              <th className="text-right py-3 pl-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">{t.interestRate}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.country} className="border-b border-border/30 last:border-0">
                <td className="py-3 pr-4 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="text-lg shrink-0">{item.flag}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{translateAsset(locale, item.country)}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.centralBank}</p>
                    </div>
                  </div>
                </td>
                {/* GDP ≥ 2% → green as a loose healthy-growth signal */}
                <td className={`text-right py-3 px-3 num ${item.gdp >= 2 ? 'ticker-positive' : 'text-foreground'}`}>
                  {item.gdp.toFixed(1)}%
                </td>
                {/* Inflation > 3% → red, above most central bank comfort zones */}
                <td className={`text-right py-3 px-3 num ${item.inflation > 3 ? 'ticker-negative' : 'text-foreground'}`}>
                  {item.inflation.toFixed(1)}%
                </td>
                <td className="text-right py-3 px-3 num text-foreground">{item.unemployment.toFixed(1)}%</td>
                <td className="text-right py-3 pl-3 num text-foreground">{item.rate.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MacroTable;
