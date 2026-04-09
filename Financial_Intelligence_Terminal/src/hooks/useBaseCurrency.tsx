/**
 * @file useBaseCurrency.tsx
 * @description User-selectable base currency for portfolio valuation.
 *
 * WHY THIS EXISTS:
 *   The portfolio panel sums positions held in multiple currencies. Without
 *   a declared base currency, the previous implementation simply added the
 *   raw numbers together and labelled the result with the locale's symbol —
 *   so ₩100,000 (Samsung shares) + $150 (AAPL) rendered as "100,150 $",
 *   which is neither a real USD value nor a real KRW value. Any portfolio
 *   that mixes currencies needs an explicit conversion target.
 *
 * DESIGN CHOICE — BASE CURRENCY IS INDEPENDENT OF LOCALE:
 *   The user's UI language and their reporting currency are not the same
 *   preference. A Japanese-speaking user who reports P&L to a US tax filing
 *   may want the UI in Japanese but P&L in USD. A Korean investor on
 *   vacation in Europe may want the UI in English but values in KRW so the
 *   numbers still feel familiar. This hook keeps the two orthogonal.
 *
 *   Default behaviour: on first load, we seed the base currency from the
 *   active locale (so a Korean-locale user starts in KRW, a French-locale
 *   user starts in EUR). After that, any explicit selection is persisted
 *   to localStorage and survives locale changes.
 *
 * PERSISTENCE:
 *   localStorage under the key `terminal-base-currency`. The stored value
 *   is a 3-letter ISO 4217 code. On read, if the stored value is not one
 *   of the supported currencies, we fall back to the locale default — this
 *   handles both corrupted storage and future currency list changes.
 */
import { useState, useEffect, useCallback } from 'react';
import { type Locale } from '@/i18n/translations';

// ─── Supported base currencies ─────────────────────────────────────────────
//
// Intentionally a small set — these are the currencies the terminal already
// knows how to render (symbols, decimal conventions) and for which
// `fetchFxRate` has reliable coverage via Alpha Vantage. Add a new currency
// here only after verifying all three: symbol, decimal handling in
// PortfolioPanel's formatters, and fetchFxRate response shape.

export type CurrencyCode = 'USD' | 'KRW' | 'EUR' | 'JPY' | 'GBP' | 'CNY';

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  /**
   * Whether the currency is typically displayed with sub-unit decimals.
   * JPY, KRW, CNY are shown as rounded integers at portfolio magnitudes
   * because their sub-unit values are noise (one-hundredth of a won).
   */
  decimals: 0 | 2;
  /** Display label for the dropdown. Kept short; the symbol is shown separately. */
  label: string;
}

export const SUPPORTED_CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: 'USD', symbol: '$', decimals: 2, label: 'USD' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, label: 'EUR' },
  GBP: { code: 'GBP', symbol: '£', decimals: 2, label: 'GBP' },
  KRW: { code: 'KRW', symbol: '₩', decimals: 0, label: 'KRW' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, label: 'JPY' },
  CNY: { code: 'CNY', symbol: '¥', decimals: 0, label: 'CNY' },
};

// ─── Locale → default base currency ────────────────────────────────────────
//
// Used only as the first-run seed value before the user has made a choice.
// Once the user selects a currency explicitly, that choice is persisted and
// subsequent locale changes do not touch it.

const localeDefaults: Record<Locale, CurrencyCode> = {
  ko: 'KRW',
  en: 'USD',
  zh: 'CNY',
  ja: 'JPY',
  gb: 'GBP',
  de: 'EUR',
  fr: 'EUR',
  it: 'EUR',
};

const STORAGE_KEY = 'terminal-base-currency';

function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && v in SUPPORTED_CURRENCIES;
}

function loadPersisted(): CurrencyCode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isCurrencyCode(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Returns the user's selected base currency plus a setter.
 *
 * The return value is stable across renders (setter is memoised), safe to
 * include in dependency arrays.
 *
 * @param locale Current UI locale. Used only to seed the default on first
 *               load when nothing has been persisted yet.
 */
export function useBaseCurrency(locale: Locale) {
  const [baseCurrency, setBaseCurrencyState] = useState<CurrencyCode>(() => {
    return loadPersisted() ?? localeDefaults[locale];
  });

  // On locale change, if the user has NOT explicitly persisted a choice,
  // follow the new locale's default. This handles the common case of a user
  // toggling languages for UI readability without caring about the reporting
  // currency — they shouldn't have to re-select base currency every time.
  useEffect(() => {
    const persisted = loadPersisted();
    if (!persisted) {
      setBaseCurrencyState(localeDefaults[locale]);
    }
  }, [locale]);

  const setBaseCurrency = useCallback((code: CurrencyCode) => {
    setBaseCurrencyState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Storage quota / private browsing — silently ignore, selection still
      // applies for the current session.
    }
  }, []);

  return {
    baseCurrency,
    baseMeta: SUPPORTED_CURRENCIES[baseCurrency],
    setBaseCurrency,
  };
}
