/**
 * @file marketDataService.ts
 * @description Single source of truth for live market data fetching.
 *
 * RESPONSIBILITIES:
 *   - Wraps every external data source (Alpha Vantage, CoinGecko, NewsAPI,
 *     Alpha Vantage FX) behind a small set of typed functions.
 *   - Routes every request through the Supabase Edge Function `market-data`,
 *     which holds the actual API keys server-side. The browser bundle never
 *     sees a vendor key — only the Supabase anon key, which is safe to expose
 *     because Row Level Security gates the underlying tables.
 *   - Provides an in-memory TTL cache to absorb the burst of requests that
 *     happens on first paint (multiple panels asking for the same data within
 *     a few hundred milliseconds).
 *   - Falls back to the static fixtures in `@/data/marketData` and
 *     `@/data/skHynixData` when the network call fails, so the UI is never
 *     completely empty.
 *
 * KNOWN LIMITATIONS (see CODE_REVIEW.md for full discussion):
 *   - The cache is process-wide and unbounded. The right long-term answer is
 *     to delete this layer entirely and call these functions from
 *     `@tanstack/react-query` `useQuery` hooks; React Query is already wired
 *     into App.tsx but currently unused for data fetching.
 *   - All errors are caught and logged as warnings. A misconfigured Supabase
 *     project surfaces to the user as "no data" rather than an actionable
 *     error. The env-var guard at module load (see `assertEnv` below) catches
 *     the most common case — missing VITE_* variables — but transport errors
 *     and 5xx responses still degrade silently.
 *   - Each Alpha Vantage parser inlines the magic field names (`'05. price'`,
 *     `'4. close'`, etc.). If Alpha Vantage versions its response shape, every
 *     call site needs an edit. Extracting `parseAlphaVantageQuote()` and
 *     `parseAlphaVantageDailyEntry()` helpers is the obvious next refactor.
 */

import {
  forexData, commoditiesData, bondsData, cryptoData, macroData,
  type MarketItem, type BondItem, type MacroItem,
} from '@/data/marketData';
import {
  skHynixChartData, skHynixDailyData, skHynixIntradayData, skHynix5DayData,
  skHynixStats, skHynixEvents,
  type ChartDataPoint, type EventMarker,
} from '@/data/skHynixData';

// ─── Environment guard ─────────────────────────────────────────────────────
//
// Fail fast at module load if the Supabase env vars are missing. Without this
// check, `callEdge()` would build a URL like `https://.supabase.co/...` and
// the user would see an opaque DNS error in the console while every panel
// silently fell back to static data — making the misconfiguration almost
// impossible to diagnose.
//
// We throw rather than warn because there is no meaningful recovery: the app
// cannot fetch live data without these values, and surfacing the error
// immediately points the developer at the right fix (copy `.env.example` to
// `.env` and fill in the project ID and anon key).

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function assertEnv(): void {
  const missing: string[] = [];
  if (!SUPABASE_PROJECT_ID) missing.push('VITE_SUPABASE_PROJECT_ID');
  if (!SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (missing.length > 0) {
    throw new Error(
      `[marketDataService] Missing required environment variables: ${missing.join(', ')}. ` +
      `Copy .env.example to .env and fill in the values from your Supabase dashboard ` +
      `(Settings → API).`
    );
  }
}
assertEnv();

// ─── Cache ──────────────────────────────────────────────────────────────────
//
// Module-level Map cache, keyed by a string built from the request parameters.
// TTLs are tuned per data type: quotes refresh every minute (matches Alpha
// Vantage's free-tier pacing), historical series every ten minutes (price
// history rarely changes intraday), news every five (avoid burning through
// the NewsAPI 100-req/day quota on a refresh-happy user).
//
// Limitations: no eviction, no background refresh, no request deduplication
// when two callers race for the same uncached key. See header comment for the
// React Query migration path.

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache = new Map<string, CacheEntry<any>>();

function getCache<T>(key: string, ttlMs: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data as T;
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, ts: Date.now() });
}

const TTL = {
  search: 5 * 60_000,    // symbol search results — stable, autocomplete pattern
  quote: 60_000,         // live price — matches Alpha Vantage free-tier cadence
  history: 10 * 60_000,  // historical bars — change at most once per trading day
  crypto: 2 * 60_000,    // crypto — volatile but CoinGecko throttles aggressively
  news: 5 * 60_000,      // headlines — preserves NewsAPI daily quota
  fx: 5 * 60_000,        // FX rates — stable enough at retail granularity
};

// ─── Edge function caller ───────────────────────────────────────────────────
//
// Every external request goes through this single function so that the
// Supabase URL pattern, auth headers, and error envelope live in exactly one
// place. The Edge Function on the other side reads `action` from the query
// string and dispatches to the right upstream API.

async function callEdge(params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const url = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/market-data?${query}`;

  const res = await fetch(url, {
    headers: {
      // Both headers are required by Supabase Edge Functions:
      // `apikey` is the project-level identifier, `Authorization` is the
      // bearer token. Using the same anon key for both is correct and
      // intentional — the function itself enforces any additional auth.
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Edge function error [${res.status}]: ${errBody}`);
  }

  return res.json();
}

// ─── Stock Search ───────────────────────────────────────────────────────────
//
// Wraps Alpha Vantage's SYMBOL_SEARCH endpoint. Used by the autocomplete in
// the header search bar. Returns an empty array on failure rather than
// throwing — the search input shows "no results" rather than an error toast,
// which is the right UX for a transient API hiccup during typing.

export interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

export async function searchSymbol(keywords: string): Promise<SearchResult[]> {
  if (!keywords || keywords.length < 1) return [];

  const cacheKey = `search:${keywords}`;
  const cached = getCache<SearchResult[]>(cacheKey, TTL.search);
  if (cached) return cached;

  try {
    const data = await callEdge({ action: 'search', keywords });
    // Alpha Vantage returns matches under `bestMatches` with numbered keys
    // like `'1. symbol'`. The numeric prefix is part of the actual key string.
    const matches = data?.bestMatches || [];
    const results: SearchResult[] = matches.map((m: any) => ({
      symbol: m['1. symbol'],
      name: m['2. name'],
      type: m['3. type'],
      region: m['4. region'],
      currency: m['8. currency'],
    }));
    setCache(cacheKey, results);
    return results;
  } catch (e) {
    console.warn('Search API failed, returning empty', e);
    return [];
  }
}

// ─── Stock Quote ────────────────────────────────────────────────────────────
//
// Single-symbol live quote via Alpha Vantage GLOBAL_QUOTE. Returns null on
// failure or on a malformed response (Alpha Vantage occasionally returns an
// empty object when rate-limited rather than a proper error code).

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: string;
  high: number;
  low: number;
  prevClose: number;
  open: number;
}

export async function fetchQuote(symbol: string): Promise<StockQuote | null> {
  const cacheKey = `quote:${symbol}`;
  const cached = getCache<StockQuote>(cacheKey, TTL.quote);
  if (cached) return cached;

  try {
    const data = await callEdge({ action: 'quote', symbol });
    const q = data?.['Global Quote'];
    // Defensive: a rate-limited Alpha Vantage response is an empty object,
    // not a 4xx. Treat "no price field" as "no data".
    if (!q || !q['05. price']) return null;
    const result: StockQuote = {
      symbol: q['01. symbol'],
      price: parseFloat(q['05. price']),
      change: parseFloat(q['09. change']),
      changePercent: parseFloat(q['10. change percent']?.replace('%', '') || '0'),
      volume: q['06. volume'],
      high: parseFloat(q['03. high']),
      low: parseFloat(q['04. low']),
      prevClose: parseFloat(q['08. previous close']),
      open: parseFloat(q['02. open']),
    };
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('Quote API failed', e);
    return null;
  }
}

// ─── Stock History ──────────────────────────────────────────────────────────
//
// Range-aware historical bar fetcher. Each UI range button maps to a small
// config record (which Edge action to call, what the time-series key in the
// response is, how many bars to slice, and how to format each bar's date
// label for the chart axis). The config table replaces what used to be an
// 8-branch if/else where every branch was structurally identical apart from
// these four values — adding a new range is now a one-line addition to
// RANGE_CONFIG instead of a copy-paste of a 10-line block.
//
// On any failure, falls back to the pre-computed SK hynix fixtures — see
// `getFallbackHistory` below for the rationale.

interface RangeConfig {
  /** Edge function action name */
  action: 'intraday' | 'daily' | 'weekly' | 'monthly';
  /** Extra query params to send with the action (e.g. interval, outputsize) */
  params?: Record<string, string>;
  /** Field name in the Alpha Vantage response that holds the OHLC series */
  timeSeriesKey: string;
  /** Number of most-recent bars to keep, or null for "all" */
  sliceCount: number | null;
  /** How to render each bar's date string into the chart x-axis label */
  formatDate: (date: string) => string;
}

const RANGE_CONFIG: Record<string, RangeConfig> = {
  // 1 day at 5-minute granularity = 78 bars (6.5h trading * 12)
  '1D':  { action: 'intraday', params: { interval: '5min'  }, timeSeriesKey: 'Time Series (5min)',  sliceCount: 78,  formatDate: d => d.split(' ')[1]?.slice(0, 5) || d },
  // 5 days at 30-minute granularity = ~65 bars
  '5D':  { action: 'intraday', params: { interval: '30min' }, timeSeriesKey: 'Time Series (30min)', sliceCount: 65,  formatDate: d => d.slice(5, 16) },
  // ~22 trading days in a month
  '1M':  { action: 'daily', params: { outputsize: 'compact' }, timeSeriesKey: 'Time Series (Daily)', sliceCount: 22,  formatDate: d => d.slice(5) },
  '6M':  { action: 'daily', params: { outputsize: 'full'    }, timeSeriesKey: 'Time Series (Daily)', sliceCount: 130, formatDate: d => d.slice(5) },
  // YTD bar count is computed at call time from today's day-of-year, so the
  // chart shows exactly the year-to-date window rather than a fixed
  // approximation. The placeholder 0 here is overwritten in fetchStockHistory.
  'YTD': { action: 'daily', params: { outputsize: 'full'    }, timeSeriesKey: 'Time Series (Daily)', sliceCount: 0,   formatDate: d => d.slice(5) },
  '1Y':  { action: 'daily', params: { outputsize: 'full'    }, timeSeriesKey: 'Time Series (Daily)', sliceCount: 252, formatDate: d => d.slice(5) },
  // 5 years at weekly granularity = 260 bars
  '5Y':  { action: 'weekly',                                    timeSeriesKey: 'Weekly Time Series', sliceCount: 260, formatDate: d => d.slice(0, 7) },
  // 'Max' — monthly bars, no slice limit. Alpha Vantage returns ~20 years.
  'Max': { action: 'monthly',                                   timeSeriesKey: 'Monthly Time Series', sliceCount: null, formatDate: d => d.slice(0, 7) },
};

/** Trading days elapsed in the current calendar year, capped to a sensible max. */
function ytdBarCount(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const daysElapsed = Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000);
  // ~252 trading days per 365 calendar days
  return Math.max(1, Math.min(252, Math.round(daysElapsed * 252 / 365)));
}

export async function fetchStockHistory(symbol: string, range: string): Promise<ChartDataPoint[]> {
  const cacheKey = `history:${symbol}:${range}`;
  const cached = getCache<ChartDataPoint[]>(cacheKey, TTL.history);
  if (cached) return cached;

  const config = RANGE_CONFIG[range] ?? RANGE_CONFIG['Max'];
  // YTD slice count is dynamic — see ytdBarCount() comment.
  const sliceCount = range === 'YTD' ? ytdBarCount() : config.sliceCount;

  try {
    const data = await callEdge({ action: config.action, symbol, ...(config.params ?? {}) });
    const series = data?.[config.timeSeriesKey];
    if (series) {
      const entries = Object.entries(series) as [string, any][];
      const sliced = sliceCount === null ? entries : entries.slice(0, sliceCount);
      const points: ChartDataPoint[] = sliced.reverse().map(([date, vals]) => ({
        date: config.formatDate(date),
        price: parseFloat(vals['4. close']),
      }));
      if (points.length > 0) {
        setCache(cacheKey, points);
        return points;
      }
    }
  } catch (e) {
    console.warn('History API failed, falling back to mock data', e);
  }

  return getFallbackHistory(range);
}

/**
 * Fallback chart data, used when the live request fails OR returns nothing.
 *
 * Returns SK hynix fixtures regardless of the symbol the user actually
 * requested — this is intentional. The purpose of the fallback is "show the
 * chart something so the page doesn't look broken", not "approximate the
 * requested stock". The chart legend and price label come from a separate
 * source, so the user sees the right name even with placeholder bars.
 */
function getFallbackHistory(range: string): ChartDataPoint[] {
  switch (range) {
    case '1D': return skHynixIntradayData;
    case '5D': return skHynix5DayData;
    case '1M': return skHynixDailyData.slice(-22);
    case '6M': return skHynixDailyData;
    default: return skHynixChartData;
  }
}

// ─── Historical price for a specific date ──────────────────────────────────
//
// Used by PortfolioPanel's "Pick Historical Price" feature: the user picks a
// past date and the form auto-fills the close price for that day. Uses
// daily_adjusted so the price reflects splits and dividends.
//
// Robustness: if the exact date isn't in the series (weekend, holiday, or a
// gap in Alpha Vantage's history), walks backward to the nearest earlier
// trading day. If daily_adjusted itself fails, falls back to the unadjusted
// daily endpoint as a last resort.

export async function fetchHistoricalPrice(symbol: string, date: string): Promise<{ open: number; close: number } | null> {
  const cacheKey = `histprice:${symbol}:${date}`;
  const cached = getCache<{ open: number; close: number }>(cacheKey, TTL.history);
  if (cached) return cached;

  try {
    const data = await callEdge({ action: 'daily_adjusted', symbol, outputsize: 'full' });
    const series = data?.['Time Series (Daily)'];
    if (series && series[date]) {
      const result = {
        open: parseFloat(series[date]['1. open']),
        close: parseFloat(series[date]['5. adjusted close'] || series[date]['4. close']),
      };
      setCache(cacheKey, result);
      return result;
    }
    // Exact date not found — walk back to the nearest earlier trading day.
    const dates = Object.keys(series || {}).sort().reverse();
    const nearest = dates.find(d => d <= date);
    if (nearest && series[nearest]) {
      const result = {
        open: parseFloat(series[nearest]['1. open']),
        close: parseFloat(series[nearest]['5. adjusted close'] || series[nearest]['4. close']),
      };
      setCache(cacheKey, result);
      return result;
    }
  } catch (e) {
    console.warn('Historical price fetch failed, trying regular daily', e);
    // Last-resort fallback to unadjusted daily endpoint. Loses split/dividend
    // adjustment but is better than nothing for the form auto-fill UX.
    try {
      const data = await callEdge({ action: 'daily', symbol, outputsize: 'full' });
      const series = data?.['Time Series (Daily)'];
      const dates = Object.keys(series || {}).sort().reverse();
      const target = dates.find(d => d <= date);
      if (target && series[target]) {
        const result = {
          open: parseFloat(series[target]['1. open']),
          close: parseFloat(series[target]['4. close']),
        };
        setCache(cacheKey, result);
        return result;
      }
    } catch {
      // Both endpoints failed. Return null and let the caller surface the
      // empty state. We don't want to throw because this is invoked from a
      // form submit handler that already shows a loading spinner.
    }
  }
  return null;
}

// ─── Crypto (CoinGecko) ────────────────────────────────────────────────────
//
// Single batch call for the four tracked coins. CoinGecko's free tier allows
// this comma-separated form so we get all four prices in one HTTP round trip.
// On failure, returns the static cryptoData fixture so the panel always
// renders something — see CODE_REVIEW.md §3.2 for the design rationale.

// CoinGecko returns ONLY a percent-change field (`usd_24h_change`), not an
// absolute-dollar change. The previous version stored that percent value in
// both `change` and `changePercent`, which made the "change" column display
// a percent number masquerading as a dollar delta. We now compute the
// absolute change from price * pct/100 so each column shows the right thing.
//
// Coin list lives in one array so adding/removing a coin is one line, not
// four parallel edits across the items array.
const COINS: Array<{ id: string; name: string; ticker: string }> = [
  { id: 'bitcoin',  name: 'Bitcoin',  ticker: 'BTC' },
  { id: 'ethereum', name: 'Ethereum', ticker: 'ETH' },
  { id: 'solana',   name: 'Solana',   ticker: 'SOL' },
  { id: 'ripple',   name: 'XRP',      ticker: 'XRP' },
];

export async function fetchCryptoLive(): Promise<MarketItem[]> {
  const cacheKey = 'crypto:live';
  const cached = getCache<MarketItem[]>(cacheKey, TTL.crypto);
  if (cached) return cached;

  try {
    const ids = COINS.map(c => c.id).join(',');
    const data = await callEdge({ action: 'crypto', ids, vs: 'usd' });
    const items: MarketItem[] = COINS.map(({ id, name, ticker }) => {
      const price = data?.[id]?.usd ?? 0;
      const pct   = data?.[id]?.usd_24h_change ?? 0;
      // Absolute 24h delta in USD = current_price * (pct / (100 + pct))
      // Derived from: price - prev_price where prev_price = price / (1 + pct/100)
      const absChange = price > 0 ? price - price / (1 + pct / 100) : 0;
      return {
        name,
        ticker,
        price: formatNum(price),
        change: absChange,
        changePercent: pct,
      };
    });
    setCache(cacheKey, items);
    return items;
  } catch (e) {
    console.warn('Crypto API failed, using fallback', e);
    return cryptoData;
  }
}

/**
 * WHAT_IF_NO_LIMITS — crypto coverage
 *
 * The current implementation is hardcoded to the same four coins because
 * CoinGecko's free tier rate-limits aggressively (10–30 req/min) and a wider
 * watchlist would burn through that quota in seconds during the auto-refresh
 * loop. With a paid CoinGecko plan or a dedicated WebSocket feed (e.g.
 * Binance, Coinbase Pro), this function would:
 *
 *   1. Accept a `tickers: string[]` parameter instead of being hardcoded.
 *   2. Open a single WebSocket connection on first mount and push updates
 *      into a shared store (Zustand or Jotai), so every panel that needs
 *      crypto prices reads from the same live stream.
 *   3. Drop the in-memory cache for crypto entirely — the WebSocket message
 *      stream IS the cache, and it's always fresh.
 *   4. Expose a `subscribeCrypto(ticker, callback)` API instead of a
 *      polling fetch, so the UI updates on every tick rather than every
 *      two minutes.
 */

function formatNum(n: number | undefined): string {
  if (!n) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ─── News (NewsAPI) ─────────────────────────────────────────────────────────
//
// Three-tier fallback strategy for headlines, designed to maximise the chance
// of returning *something* relevant within the user's locale before falling
// back to global English news. Each tier uses a different NewsAPI mode:
//
//   Tier 1 — top-headlines + country code:
//     Cleanest results, but only available for ~60 countries and only returns
//     general-interest news (not all of which is financial).
//
//   Tier 2 — everything endpoint with locale-aware query string:
//     Wider coverage, financial-keyword filtered, but no country guarantee.
//
//   Tier 3 — English global financial news:
//     Last resort for non-English locales. Better than an empty feed.
//
// The cache key intentionally omits the language code because the country
// already implies it for tier 1, and a user switching languages within the
// same country session benefits from the cached result.

export interface NewsArticle {
  time: string;
  headline: string;
  source: string;
  url: string;
}

const localeToLang: Record<string, string> = {
  ko: 'ko', en: 'en', zh: 'zh', ja: 'ja', gb: 'en', de: 'de', fr: 'fr', it: 'it',
};

const localeToCountry: Record<string, string> = {
  ko: 'kr', en: 'us', zh: 'cn', ja: 'jp', gb: 'gb', de: 'de', fr: 'fr', it: 'it',
};

export async function fetchNews(query: string, locale: string): Promise<NewsArticle[]> {
  const country = localeToCountry[locale] || 'us';
  const lang = localeToLang[locale] || 'en';
  const cacheKey = `news:${query}:${country}`;
  const cached = getCache<NewsArticle[]>(cacheKey, TTL.news);
  if (cached) return cached;

  // Local helper — keeps the three tiers below from repeating the same
  // filter+map. NewsAPI marks deleted articles with title '[Removed]', which
  // we drop along with anything missing a title outright.
  const parseArticles = (data: any): NewsArticle[] =>
    (data?.articles || [])
      .filter((a: any) => a.title && a.title !== '[Removed]')
      .map((a: any) => ({
        time: a.publishedAt || '',
        headline: a.title,
        source: a.source?.name || '',
        url: a.url,
      }));

  try {
    // Tier 1: top-headlines with country code.
    const data = await callEdge({ action: 'news', country, language: lang, pageSize: '10', mode: 'headlines' });
    let articles = parseArticles(data);
    if (articles.length > 0) {
      setCache(cacheKey, articles);
      return articles;
    }
    // Tier 2: everything endpoint with locale-aware query.
    const fallback = await callEdge({ action: 'news', q: query, language: lang, pageSize: '10', mode: 'everything' });
    articles = parseArticles(fallback);
    if (articles.length > 0) {
      setCache(cacheKey, articles);
      return articles;
    }
    // Tier 3: English global financial news. Only attempted for non-English
    // locales — if the user's locale is already English, tier 2 already tried
    // the broadest possible query and there's nothing more to do.
    if (lang !== 'en') {
      const globalFallback = await callEdge({ action: 'news', q: 'stock market finance', language: 'en', pageSize: '10', mode: 'everything' });
      articles = parseArticles(globalFallback);
      setCache(cacheKey, articles);
      return articles;
    }
  } catch (e) {
    console.warn('News API failed', e);
  }
  return [];
}

/**
 * WHAT_IF_NO_LIMITS — news pipeline
 *
 * The current three-tier fallback exists because NewsAPI's free Developer tier
 * caps at 100 requests per day and only returns articles up to a month old.
 * That quota is shared across every visitor of the deployed site, so the
 * cache TTL had to be set conservatively (5 min) and the tier strategy had to
 * stretch each request as far as possible.
 *
 * With a paid NewsAPI Business tier (or a switch to a financial-news-specific
 * provider like Benzinga, Polygon.io news, or Refinitiv), this function would:
 *
 *   1. Drop the three-tier fallback and just call top-headlines per locale.
 *   2. Stream new articles via WebSocket (Polygon supports this) so the feed
 *      updates without polling.
 *   3. Replace the rule-based sentiment classifier in `lib/sentimentAnalysis.ts`
 *      with the provider's own pre-classified sentiment scores, which are
 *      trained on financial text rather than guessed from keyword matching.
 *   4. Add per-article entity tagging so the LiveNewsFeed could highlight
 *      headlines that mention the currently selected stock.
 */

// ─── Portfolio news ─────────────────────────────────────────────────────────
//
// Given a list of position names (e.g. ["NVIDIA Corp", "Apple Inc"]), returns
// a single flattened list of recent news articles that mention any of them.
// Used by the portfolio panel to compute per-position sentiment badges and
// the portfolio-wide bearish/bullish alert counter.
//
// RATIONALE for one combined query instead of N per-symbol queries:
//   NewsAPI's free Developer tier allows 100 requests per day across all
//   visitors. A naive "one fetch per position" design would burn 5-10
//   requests per page load on a typical portfolio, exhausting the quota
//   within the first few dozen page views. Instead we build a single
//   OR-joined query ("NVIDIA OR Apple OR Tesla") and fetch once. NewsAPI's
//   /everything endpoint supports this syntax natively.
//
// NAME NORMALISATION:
//   Position names as stored include legal-entity suffixes ("NVIDIA Corp",
//   "Apple Inc", "SK hynix Inc") that hurt news-query recall because
//   journalists almost never write them. We strip a short list of common
//   suffixes before joining. The resulting tokens are quoted individually
//   in the query so multi-word company names ("SK hynix") stay intact.

const COMPANY_SUFFIX_RE = /\s*\b(Corp|Corporation|Inc|Incorporated|Ltd|Limited|Co|Company|PLC|AG|SA|NV|KK|KGaA|LLC)\.?\s*$/i;

export function normaliseCompanyName(name: string): string {
  return name.replace(COMPANY_SUFFIX_RE, '').trim();
}

export async function fetchPortfolioNews(
  names: string[],
  locale: string,
): Promise<NewsArticle[]> {
  if (names.length === 0) return [];

  // De-duplicate (a user holding two lots of the same stock appears twice)
  // and normalise before building the query, then sort for a stable cache key.
  const normalised = [...new Set(names.map(normaliseCompanyName))]
    .filter(n => n.length > 0)
    .sort();
  if (normalised.length === 0) return [];

  // Cap the number of OR clauses. NewsAPI's /everything endpoint has a
  // practical query length limit around 500 characters; ten name clauses
  // fits comfortably. A larger portfolio will have its tail trimmed — the
  // panel's sentiment badges for trimmed positions will simply be absent.
  const capped = normalised.slice(0, 10);
  const query = capped.map(n => `"${n}"`).join(' OR ');

  const cacheKey = `portfolio-news:${capped.join('|')}:${locale}`;
  const cached = getCache<NewsArticle[]>(cacheKey, TTL.news);
  if (cached) return cached;

  const lang = localeToLang[locale] || 'en';
  try {
    // Straight to the /everything endpoint — top-headlines ignores `q`,
    // which is the whole point of this function.
    const data = await callEdge({
      action: 'news',
      q: query,
      language: lang,
      pageSize: '30',
      mode: 'everything',
    });
    const articles: NewsArticle[] = (data?.articles || [])
      .filter((a: any) => a.title && a.title !== '[Removed]')
      .map((a: any) => ({
        time: a.publishedAt || '',
        headline: a.title,
        source: a.source?.name || '',
        url: a.url,
      }));
    setCache(cacheKey, articles);
    return articles;
  } catch (e) {
    console.warn('Portfolio news fetch failed', e);
    return [];
  }
}

// ─── FX Rate ────────────────────────────────────────────────────────────────
//
// Single currency-pair lookup via Alpha Vantage CURRENCY_EXCHANGE_RATE.
// Used by the portfolio P/L conversion and any panel that needs to render a
// foreign-currency price in the user's home currency. Returns null on failure;
// callers fall back to the static `forexData` fixture or skip the conversion.

export async function fetchFxRate(from: string, to: string): Promise<number | null> {
  const cacheKey = `fx:${from}:${to}`;
  const cached = getCache<number>(cacheKey, TTL.fx);
  if (cached) return cached;

  try {
    const data = await callEdge({ action: 'fx', from, to });
    const rate = parseFloat(data?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate'] || '0');
    if (rate > 0) {
      setCache(cacheKey, rate);
      return rate;
    }
  } catch (e) {
    console.warn('FX API failed', e);
  }
  return null;
}

// ─── Static fallbacks and re-exports ────────────────────────────────────────
//
// Re-exported here so consumers can import everything market-data-related from
// a single module. The static fixtures are the same ones used by the fallback
// paths above; consumers that want "live or fixture, whichever works" should
// call the fetch functions, while consumers that explicitly want the static
// data (e.g. the macro indicators table that has no live source) import these.

export { forexData, commoditiesData, bondsData, cryptoData, macroData };
export { skHynixStats, skHynixEvents };
export type { ChartDataPoint, EventMarker, MarketItem, BondItem, MacroItem };

/**
 * Refresh intervals used by the components that own the polling loops.
 * Centralised here so the cadence is visible alongside the cache TTLs above —
 * a refresh interval shorter than its corresponding TTL is wasted work.
 */
export const REFRESH_INTERVALS = {
  stockPrice: 60_000,
  marketData: 120_000,
  news: 300_000,
  crypto: 120_000,
} as const;
