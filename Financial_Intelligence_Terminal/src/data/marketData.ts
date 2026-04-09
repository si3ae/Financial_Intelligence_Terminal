/**
 * @file marketData.ts
 * @description Static fallback data for market tables.
 *
 * WHY IS THIS STATIC?
 * Alpha Vantage's free tier enforces a hard limit of 5 requests/minute and
 * 25 requests/day. Fetching live quotes for all symbols displayed in the UI
 * (8 indices + 6 forex pairs + 6 commodities + 6 bonds = 26 symbols) would
 * exhaust the daily quota on the very first page load, causing cascading 429
 * errors across every table.
 *
 * UPGRADE PATH — pick whichever fits your plan:
 *
 * Option A · Alpha Vantage paid tier (75+ req/min)
 *   Activate the commented-out fetchQuote calls in the parent page component.
 *   Batch with Promise.all and rate-limit to ≤ 5 concurrent requests.
 *
 * Option B · Selective live quotes (free tier friendly)
 *   Pick ≤ 5 high-priority symbols (e.g. SPY, QQQ, USD/KRW, BTC, 000660.KS)
 *   and call fetchQuote only for those. Keep the rest static.
 *
 *   Example (place in the parent component that renders MarketTable):
 *   ─────────────────────────────────────────────────────────────────
 *   import { fetchQuote } from '@/services/marketDataService';
 *   import { indicesData } from '@/data/marketData';
 *
 *   const PRIORITY_SYMBOLS = ['SPY', 'QQQ', '000660.KS'];
 *
 *   useEffect(() => {
 *     Promise.all(PRIORITY_SYMBOLS.map(sym => fetchQuote(sym)))
 *       .then(quotes => {
 *         const live = quotes.filter(Boolean);
 *         // merge live quotes into indicesData by ticker
 *         setData(prev => prev.map(item => {
 *           const q = live.find(q => q?.symbol === item.ticker);
 *           if (!q) return item;
 *           return {
 *             ...item,
 *             price: q.price.toLocaleString(),
 *             change: q.change,
 *             changePercent: q.changePercent,
 *           };
 *         }));
 *       });
 *   }, []);
 *   ─────────────────────────────────────────────────────────────────
 *
 * Option C · Replace with a more generous free API
 *   - Polygon.io  : unlimited free tier for end-of-day data
 *   - Tiingo      : 50 req/hour free, supports most global tickers
 *   - Yahoo Finance (unofficial): no key required, CORS-safe via proxy
 *     endpoint: https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
 *
 * BONDS NOTE:
 *   Bond yield data is not available on Alpha Vantage's free plan at all.
 *   To go live, integrate FRED (Federal Reserve Economic Data):
 *     - Free API key, 500 req/day limit
 *     - Series IDs: DGS2 · DGS10 · DGS30 (US Treasuries)
 *     - Endpoint: https://api.stlouisfed.org/fred/series/observations
 *   See BondsTable.tsx for the full migration note.
 *
 * MACRO NOTE:
 *   GDP, inflation, and unemployment figures are released quarterly/monthly
 *   by national statistics agencies. They do not change intraday, so static
 *   data is acceptable here. Manual updates after major data releases are
 *   sufficient. For automated updates, consider the World Bank or IMF APIs.
 *
 * DATA FRESHNESS:
 *   Last updated: March 2026. Please refresh figures after major central bank
 *   meetings (FOMC, ECB, BoK, BoJ) or significant macro data releases.
 */

export interface MarketItem {
  name: string;
  ticker: string;
  /** Pre-formatted price string (e.g. "5,998.74") — replace with live data if upgrading */
  price: string;
  change: number;
  changePercent: number;
}

export interface BondItem {
  name: string;
  /** Yield in percent (e.g. 4.235 = 4.235%) */
  yield: number;
  /** Daily change in yield, in percentage points */
  change: number;
  maturity: string;
}

export interface MacroItem {
  country: string;
  flag: string;
  /** GDP growth rate YoY (%) */
  gdp: number;
  /** CPI inflation YoY (%) */
  inflation: number;
  /** Unemployment rate (%) */
  unemployment: number;
  /** Central bank policy rate (%) */
  rate: number;
  centralBank: string;
}

// ─── Global Indices ───────────────────────────────────────────────────────────
// Static — live upgrade: use fetchQuote with tickers below (Option B above).
// Alpha Vantage tickers for reference: SPY (S&P proxy), QQQ, DIA, 105190.KS (KOSPI ETF),
// EWJ (Nikkei proxy), ASHR (Shanghai proxy), EWG (DAX proxy), EWU (FTSE proxy).
export const indicesData: MarketItem[] = [
  { name: 'S&P 500',    ticker: 'SPX',   price: '5,998.74',  change: 18.43,   changePercent: 0.31  },
  { name: 'NASDAQ',     ticker: 'IXIC',  price: '19,572.60', change: -42.28,  changePercent: -0.22 },
  { name: 'Dow Jones',  ticker: 'DJI',   price: '43,840.91', change: 123.45,  changePercent: 0.28  },
  { name: 'KOSPI',      ticker: 'KS11',  price: '2,687.45',  change: -12.30,  changePercent: -0.46 },
  { name: 'Nikkei 225', ticker: 'N225',  price: '38,451.46', change: 285.32,  changePercent: 0.75  },
  { name: 'Shanghai',   ticker: 'SSEC',  price: '3,267.80',  change: 8.92,    changePercent: 0.27  },
  { name: 'DAX',        ticker: 'GDAXI', price: '22,156.32', change: 145.67,  changePercent: 0.66  },
  { name: 'FTSE 100',   ticker: 'FTSE',  price: '8,712.45',  change: -23.18,  changePercent: -0.27 },
];

// ─── Forex Pairs ──────────────────────────────────────────────────────────────
// Static — live upgrade: use fetchFxRate(from, to) per pair from marketDataService.
// Note: each pair requires one separate API call (Alpha Vantage CURRENCY_EXCHANGE_RATE).
// With 6 pairs that's 6 calls — feasible on free tier if spread across intervals.
export const forexData: MarketItem[] = [
  { name: 'EUR/USD', ticker: 'EURUSD', price: '1.0842',    change: 0.0012,  changePercent: 0.11  },
  { name: 'USD/JPY', ticker: 'USDJPY', price: '149.82',    change: -0.45,   changePercent: -0.30 },
  { name: 'GBP/USD', ticker: 'GBPUSD', price: '1.2654',    change: 0.0028,  changePercent: 0.22  },
  { name: 'USD/KRW', ticker: 'USDKRW', price: '1,342.50',  change: 3.20,    changePercent: 0.24  },
  { name: 'USD/CNY', ticker: 'USDCNY', price: '7.2415',    change: -0.0082, changePercent: -0.11 },
  { name: 'EUR/GBP', ticker: 'EURGBP', price: '0.8568',    change: -0.0015, changePercent: -0.18 },
];

// ─── Commodities ──────────────────────────────────────────────────────────────
// Static — Alpha Vantage free plan has limited support for commodity tickers.
// Live alternative: use Commodities API (commodities-api.com) or QUANDL/Nasdaq Data Link.
// CoinGecko covers crypto only and cannot substitute here.
export const commoditiesData: MarketItem[] = [
  { name: 'Gold',           ticker: 'XAU', price: '2,935.40', change: 18.20,  changePercent: 0.62  },
  { name: 'Silver',         ticker: 'XAG', price: '32.84',    change: 0.42,   changePercent: 1.30  },
  { name: 'Crude Oil (WTI)', ticker: 'CL', price: '71.24',    change: -0.86,  changePercent: -1.19 },
  { name: 'Brent Crude',    ticker: 'BZ',  price: '75.18',    change: -0.72,  changePercent: -0.95 },
  { name: 'Natural Gas',    ticker: 'NG',  price: '3.842',    change: 0.124,  changePercent: 3.34  },
  { name: 'Copper',         ticker: 'HG',  price: '4.5120',   change: 0.0340, changePercent: 0.76  },
];

// ─── Bond Yields ──────────────────────────────────────────────────────────────
// Static — bond yield data is not supported on Alpha Vantage's free plan.
// Live upgrade: integrate FRED API (see BondsTable.tsx for full migration notes).
export const bondsData: BondItem[] = [
  { name: 'US 2Y Treasury',   yield: 4.235, change: -0.018, maturity: '2Y'  },
  { name: 'US 10Y Treasury',  yield: 4.498, change: 0.032,  maturity: '10Y' },
  { name: 'US 30Y Treasury',  yield: 4.682, change: 0.015,  maturity: '30Y' },
  { name: 'German 10Y Bund',  yield: 2.845, change: -0.022, maturity: '10Y' },
  { name: 'Japan 10Y JGB',    yield: 1.425, change: 0.045,  maturity: '10Y' },
  { name: 'UK 10Y Gilt',      yield: 4.612, change: 0.008,  maturity: '10Y' },
];

// ─── Crypto ───────────────────────────────────────────────────────────────────
// Used as initial state / SSR fallback only.
// LiveCryptoTable replaces this with real-time CoinGecko data on mount.
export const cryptoData: MarketItem[] = [
  { name: 'Bitcoin',  ticker: 'BTC', price: '96,482.30', change: 1245.80, changePercent: 1.31  },
  { name: 'Ethereum', ticker: 'ETH', price: '2,714.56',  change: -38.42,  changePercent: -1.40 },
  { name: 'Solana',   ticker: 'SOL', price: '172.84',    change: 5.62,    changePercent: 3.36  },
  { name: 'XRP',      ticker: 'XRP', price: '2.6842',    change: 0.0845,  changePercent: 3.25  },
];

// ─── Macro Indicators ─────────────────────────────────────────────────────────
// Static — these figures are published quarterly or monthly by national agencies.
// They do not change intraday, so real-time polling is unnecessary.
// Suggested update cadence: after each major central bank meeting or CPI/GDP release.
// Automated alternative: World Bank API (api.worldbank.org) or IMF Data API.
export const macroData: MacroItem[] = [
  { country: 'United States', flag: '🇺🇸', gdp: 2.5, inflation: 2.9, unemployment: 4.0, rate: 4.50, centralBank: 'Fed'   },
  { country: 'Eurozone',      flag: '🇪🇺', gdp: 0.9, inflation: 2.4, unemployment: 6.3, rate: 2.90, centralBank: 'ECB'   },
  { country: 'China',         flag: '🇨🇳', gdp: 5.0, inflation: 0.5, unemployment: 5.1, rate: 3.10, centralBank: 'PBoC'  },
  { country: 'Japan',         flag: '🇯🇵', gdp: 1.2, inflation: 3.2, unemployment: 2.5, rate: 0.50, centralBank: 'BoJ'   },
  { country: 'South Korea',   flag: '🇰🇷', gdp: 2.0, inflation: 2.0, unemployment: 2.8, rate: 2.75, centralBank: 'BoK'   },
  { country: 'United Kingdom',flag: '🇬🇧', gdp: 1.1, inflation: 3.0, unemployment: 4.4, rate: 4.50, centralBank: 'BoE'   },
];
