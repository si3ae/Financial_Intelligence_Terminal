/**
 * @file currencyConversion.ts
 * @description Locale-aware currency conversion utilities for the terminal.
 *
 * All prices in the SK hynix chart and portfolio panel are stored internally
 * in KRW (South Korean Won). This module converts those values to the
 * display currency for the active locale.
 *
 * STATIC EXCHANGE RATES:
 *   The rates in `currencyMap` are hardcoded approximations as of early 2026.
 *   They are used only for display formatting — not for financial calculations.
 *   The portfolio P&L and chart prices are informational, not trading data.
 *
 *   WHY STATIC: Fetching live FX rates for every locale on every page load
 *   would cost 8 Alpha Vantage API calls (one per locale currency pair),
 *   consuming a third of the free daily quota before any stock data is fetched.
 *
 *   LIVE UPGRADE: Use `fetchFxRate(from, to)` from marketDataService.ts,
 *   which calls the Alpha Vantage CURRENCY_EXCHANGE_RATE endpoint via the
 *   Supabase Edge Function. Call once per locale change and cache the result.
 *   Example (in a context provider or useEffect):
 *   ────────────────────────────────────────────────────────────────
 *   const rate = await fetchFxRate('KRW', currency.code);
 *   if (rate) setCurrencyRate(rate);
 *   ────────────────────────────────────────────────────────────────
 *
 *   UPDATE CADENCE (if keeping static): refresh after major FX moves or
 *   at least quarterly. Key pairs to watch: USD/KRW, EUR/KRW, JPY/KRW.
 */
import { type Locale } from '@/i18n/translations';

export interface CurrencyInfo {
  symbol: string;
  code: string;
  /** Approximate KRW per 1 unit of this currency (e.g. 1 USD ≈ 1,450 KRW) */
  rate: number;
}

// Static FX rates vs KRW — approximate values as of Q1 2026.
// EUR is shared across de, fr, it locales (same currency, same rate).
const currencyMap: Record<Locale, CurrencyInfo> = {
  ko: { symbol: '₩', code: 'KRW', rate: 1     },
  en: { symbol: '$', code: 'USD', rate: 1450   },
  zh: { symbol: '¥', code: 'CNY', rate: 200    },
  ja: { symbol: '¥', code: 'JPY', rate: 9.5    },
  gb: { symbol: '£', code: 'GBP', rate: 1830   },
  de: { symbol: '€', code: 'EUR', rate: 1570   },
  fr: { symbol: '€', code: 'EUR', rate: 1570   },
  it: { symbol: '€', code: 'EUR', rate: 1570   },
};

// ─── Legacy locale-keyed API (kept for StockChart and MacroInsightCard) ──────

/** Returns the CurrencyInfo for the given locale. */
export function getCurrencyInfo(locale: Locale): CurrencyInfo {
  return currencyMap[locale];
}

/** Converts a KRW amount to the locale's display currency. */
export function convertFromKRW(krwAmount: number, locale: Locale): number {
  const { rate } = currencyMap[locale];
  return rate === 1 ? krwAmount : krwAmount / rate;
}

/**
 * Formats a KRW price for display in the locale's currency.
 * JPY and CNY are shown as rounded integers (no decimal places) since
 * their sub-unit values are negligible at typical stock price magnitudes.
 */
export function formatPrice(krwAmount: number, locale: Locale): string {
  const { symbol, rate } = currencyMap[locale];
  if (rate === 1) return `${symbol}${krwAmount.toLocaleString()}`;
  const converted = krwAmount / rate;
  if (locale === 'ja' || locale === 'zh') {
    return `${symbol}${Math.round(converted).toLocaleString()}`;
  }
  return `${symbol}${converted.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Formats a large KRW market cap value with T/B/M suffix in the locale currency.
 * Example: 227.4T KRW → "$156.8B" for en locale.
 */
export function formatMarketCap(krwValue: number, locale: Locale): string {
  const { symbol, rate } = currencyMap[locale];
  if (rate === 1) return `${symbol}${(krwValue / 1e12).toFixed(1)}T`;
  const converted = krwValue / rate;
  if (converted >= 1e12) return `${symbol}${(converted / 1e12).toFixed(1)}T`;
  if (converted >= 1e9)  return `${symbol}${(converted / 1e9).toFixed(1)}B`;
  return `${symbol}${(converted / 1e6).toFixed(1)}M`;
}

/**
 * NOTE ON LIVE FX:
 *
 * The `rate` values above are hand-maintained approximations, used only by
 * the chart and market-cap formatters that render prices in the active
 * locale's currency. The portfolio panel does NOT use these static rates —
 * it calls `fetchFxRate` from marketDataService.ts at display time so its
 * cross-currency totals reflect real mid-market rates (see
 * `PortfolioPanel.tsx` and `useBaseCurrency.tsx`).
 *
 * Why keep the static rates at all:
 *   - The chart formatters need a synchronous function (they're called
 *     inside render callbacks) and can tolerate a quarterly refresh
 *     because they're display-only, not aggregated across positions.
 *   - Fetching live FX for every locale on every page load would cost
 *     ~6 Alpha Vantage requests just to render the first chart tick,
 *     consuming a meaningful chunk of the free-tier daily budget.
 *
 * If the chart ever needs tighter accuracy (e.g. showing foreign-exchange
 * P&L on a specific trade date), swap `currencyMap[locale].rate` for a
 * result from `fetchFxRate('KRW', currency.code)` cached via React Query.
 */
