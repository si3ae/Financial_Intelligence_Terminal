/**
 * @file usePortfolioSentiment.tsx
 * @description Aggregates news sentiment for each portfolio position.
 *
 * WHY:
 *   A portfolio panel that shows numbers without context tells the user
 *   "you're up $400" but not "you're up $400 and there are three bearish
 *   headlines on your biggest position today". This hook bridges the two
 *   halves of the terminal — the sentiment classifier and the portfolio
 *   tracker — so the user can spot a position worth paying attention to
 *   at a glance.
 *
 * STRATEGY:
 *   For each unique position symbol (up to a cap — see TOP_N_SYMBOLS
 *   below), fetch a locale-appropriate news query using the position's
 *   company name, classify each headline with the existing
 *   sentimentAnalysis.getSentiment() rule engine, and return a per-symbol
 *   roll-up of (bullish, bearish, neutral) counts.
 *
 *   The query string is deliberately the same shape that LiveNewsFeed
 *   uses (`position.name`) so that both hit the same cache key in
 *   marketDataService's 5-minute news cache. If the user has a position
 *   in the stock currently displayed in the chart, LiveNewsFeed will
 *   have already populated that cache entry and this hook's fetch will
 *   resolve instantly from memory.
 *
 * QUOTA CONSTRAINT:
 *   NewsAPI free tier is 100 requests/day. A portfolio with ten positions
 *   that refreshes on every add/remove would burn through that in a few
 *   sessions. We cap the number of symbols we fetch news for to
 *   TOP_N_SYMBOLS (5), ordered by notional value (largest positions
 *   first — those are the ones the user cares about most). Smaller
 *   positions get `null` sentiment and the renderer shows no badge.
 *
 *   See WHAT_IF_NO_LIMITS at the bottom for the paid-tier approach that
 *   would cover every position.
 *
 * RE-FETCH BEHAVIOUR:
 *   The hook re-fetches when the set of top symbols changes (user adds,
 *   removes, or the value reshuffles crossing the top-N boundary) or
 *   when the locale changes. It does NOT re-fetch on every re-render or
 *   on price ticks — only on meaningful input changes.
 *
 *   Out-of-order responses are guarded by a request-id ref, same pattern
 *   as StockSearch.tsx and PortfolioPanel.tsx's FX fetching.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchNews } from '@/services/marketDataService';
import { getSentiment, type Sentiment } from '@/lib/sentimentAnalysis';
import { type Locale } from '@/i18n/translations';
import { type PortfolioPosition } from '@/hooks/usePortfolio';

/** How many top-value positions get sentiment fetched for them. */
const TOP_N_SYMBOLS = 5;

/** How many headlines per symbol to classify. NewsAPI typically returns 10–20. */
const HEADLINES_PER_SYMBOL = 10;

export interface SymbolSentiment {
  bullish: number;
  bearish: number;
  neutral: number;
  /** The dominant sentiment (highest count); neutral on tie. */
  dominant: Sentiment;
  /** Total headlines classified. Useful for "N headlines analysed" tooltips. */
  total: number;
}

export type PortfolioSentimentMap = Record<string, SymbolSentiment>;

/**
 * Returns a map of symbol → sentiment roll-up for the top N positions by
 * value, plus a loading flag. Missing symbols (either outside the top N,
 * or whose fetch failed) simply don't appear in the map — callers should
 * treat an absent key as "no sentiment data available".
 *
 * @param positions    Current portfolio positions
 * @param livePrices   Symbol → current price map (used only to rank positions
 *                     by current notional value)
 * @param locale       Active UI locale, passed through to fetchNews
 */
export function usePortfolioSentiment(
  positions: PortfolioPosition[],
  livePrices: Record<string, number>,
  locale: Locale,
): { sentimentMap: PortfolioSentimentMap; loading: boolean } {
  const [sentimentMap, setSentimentMap] = useState<PortfolioSentimentMap>({});
  const [loading, setLoading] = useState(false);
  const latestRequestId = useRef(0);

  // Rank positions by current notional value (live price × quantity, falling
  // back to buy price × quantity while quotes load), take the top N unique
  // symbols, and return a STABLE string key so useEffect only re-runs when
  // the set actually changes. Without the stable key, every render would
  // allocate a new array and the useEffect below would refetch endlessly.
  const topSymbolsKey = useMemo(() => {
    if (positions.length === 0) return '';
    const seen = new Set<string>();
    const ranked = [...positions]
      .map(p => ({
        symbol: p.symbol,
        name: p.name,
        value: (livePrices[p.symbol] ?? p.buyPrice) * p.quantity,
      }))
      .sort((a, b) => b.value - a.value);
    const top: Array<{ symbol: string; name: string }> = [];
    for (const r of ranked) {
      if (seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      top.push({ symbol: r.symbol, name: r.name });
      if (top.length >= TOP_N_SYMBOLS) break;
    }
    // Serialised form — symbols plus names, joined. Acts as both the
    // useEffect dependency and the input plan for the fetch. We parse it
    // back inside the effect to avoid holding the array reference.
    return top.map(t => `${t.symbol}|${t.name}`).join('\n');
  }, [positions, livePrices]);

  useEffect(() => {
    if (!topSymbolsKey) {
      setSentimentMap({});
      setLoading(false);
      return;
    }

    const entries = topSymbolsKey.split('\n').map(line => {
      const [symbol, name] = line.split('|');
      return { symbol, name };
    });

    const myId = ++latestRequestId.current;
    setLoading(true);

    Promise.all(
      entries.map(async ({ symbol, name }) => {
        try {
          // Query by company name, matching LiveNewsFeed's query shape so
          // both hit the same 5-minute cache entry in marketDataService.
          const articles = await fetchNews(name, locale);
          const sliced = articles.slice(0, HEADLINES_PER_SYMBOL);

          let bullish = 0, bearish = 0, neutral = 0;
          for (const a of sliced) {
            const s = getSentiment(a.headline);
            if (s === 'bullish') bullish++;
            else if (s === 'bearish') bearish++;
            else neutral++;
          }

          let dominant: Sentiment = 'neutral';
          if (bullish > bearish && bullish > neutral) dominant = 'bullish';
          else if (bearish > bullish && bearish > neutral) dominant = 'bearish';

          return [
            symbol,
            {
              bullish,
              bearish,
              neutral,
              dominant,
              total: sliced.length,
            } as SymbolSentiment,
          ] as const;
        } catch {
          // One failed fetch doesn't abort the batch — just omit this
          // symbol from the resulting map.
          return null;
        }
      })
    ).then(results => {
      if (myId !== latestRequestId.current) return;
      const next: PortfolioSentimentMap = {};
      for (const r of results) {
        if (r) next[r[0]] = r[1];
      }
      setSentimentMap(next);
      setLoading(false);
    }).catch(() => {
      if (myId !== latestRequestId.current) return;
      setLoading(false);
    });
  }, [topSymbolsKey, locale]);

  return { sentimentMap, loading };
}

/**
 * WHAT_IF_NO_LIMITS — portfolio-wide sentiment
 *
 * The current hook fetches news for the top N positions only, because
 * NewsAPI's 100-req/day free tier would not survive a portfolio with
 * twenty positions refreshing on every page load. With either of the
 * following upgrades, the TOP_N_SYMBOLS cap would be removed:
 *
 * OPTION A — paid NewsAPI tier (or equivalent vendor):
 *   100k req/day is the first paid rung. A user with 30 positions
 *   refreshing every 5 minutes is 360 req/hour, well under the cap.
 *   Swap the `ranked.slice(0, TOP_N_SYMBOLS)` gate in this file for
 *   the full ranked list and we're done — no architectural change.
 *
 * OPTION B — server-side batching via the ai-assistant Edge Function:
 *   Add a new action `ai-assistant?task=batch-sentiment` that takes a
 *   JSON body of `{ positions: [{ symbol, name }], locale }`, fetches
 *   news on the server side (where the NewsAPI key already lives and
 *   can be hit without a per-client quota concern), classifies each
 *   headline, and returns the rolled-up `PortfolioSentimentMap`
 *   directly. The client-side fetch collapses from N calls to 1:
 *
 *   ```ts
 *   const { data } = useQuery({
 *     queryKey: ['portfolio-sentiment', topSymbolsKey, locale],
 *     queryFn: () => fetchBatchSentiment(
 *       entries.map(e => ({ symbol: e.symbol, name: e.name })),
 *       locale,
 *     ),
 *     staleTime: 5 * 60_000,
 *   });
 *   ```
 *
 *   This also lets us swap the rule-based classifier for something
 *   better on the server side without touching the client — e.g. a
 *   small Claude prompt that scores each headline bullish/bearish/neutral
 *   with reasoning, or a FinBERT endpoint. Client shape is unchanged.
 *
 * RECOMMENDED PATH:
 *   Option B. The server-side batch collapses N client requests into
 *   one, avoids exposing the news quota consumption to client-side
 *   visibility, and positions us to upgrade the classifier without
 *   another client rewrite.
 */
