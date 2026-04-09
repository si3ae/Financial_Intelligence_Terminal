/**
 * @file PortfolioPanel.tsx
 * @description Portfolio tracking panel with multi-currency aggregation.
 *
 * CORE RESPONSIBILITY:
 *   Let the user track positions held in different currencies and see a
 *   single roll-up value + P&L in a base currency of their choice. Each
 *   position stores its native currency (from the stock's exchange at
 *   time of add); the panel fetches FX rates at display time and converts
 *   each position into the current base currency for aggregation.
 *
 * BASE CURRENCY:
 *   Sourced from `useBaseCurrency` (see that hook's header for the
 *   persistence model). The dropdown in this panel's header is the
 *   canonical place to change it. On first load, base currency defaults
 *   to the locale's natural currency; after any explicit selection it
 *   is persisted to localStorage and detached from the locale.
 *
 * FX FETCH STRATEGY:
 *   Every unique (position.currency → baseCurrency) pair is fetched once
 *   via `fetchFxRate`, which is already memoised for 5 minutes in the
 *   service layer. Same-currency pairs (e.g. a KRW position with a KRW
 *   base) short-circuit to rate 1 without a network call. All requests
 *   for a given base currency are stamped with a monotonically increasing
 *   id; if the user changes the base currency while fetches are in
 *   flight, stale responses are dropped on resolution — the same pattern
 *   used in StockSearch.tsx and handlePickDate below.
 *
 * DISPLAY:
 *   - Header: base currency dropdown (replaces the old hardcoded symbol).
 *   - Summary: total value and total P&L, both in the base currency, with
 *     the base currency code shown as a subscript so the user never has
 *     to guess what currency they're looking at.
 *   - Per-row: position name + quantity shown in the position's NATIVE
 *     currency (that's how the user bought it), current total value +
 *     P&L shown in the BASE currency (that's the roll-up currency).
 *     This two-currency-per-row layout is the honest way to show a
 *     multi-currency portfolio: each number is labelled with its own
 *     currency rather than being silently mixed.
 *   - FX loading state: while FX rates are being fetched for the first
 *     time, we show placeholders in the value/P&L columns rather than
 *     pretending native-currency numbers are base-currency numbers.
 *
 * WHAT THIS PANEL DOES NOT DO:
 *   - It does not persist the base currency selection to a user profile
 *     or sync it across devices. That's a Supabase-backed preferences
 *     feature, not a single-file change.
 *   - It does not show the historical value trend. The `usePortfolio`
 *     hook already timestamps positions via `addedAt`, so adding a
 *     localStorage-backed daily snapshot ring buffer would be the
 *     natural next step, but it's an additive feature not a fix.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Briefcase, Plus, Trash2, TrendingUp, TrendingDown,
  CalendarSearch, Loader2, ChevronDown,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/i18n/LanguageContext';
import { useStock } from '@/hooks/useStockContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import {
  useBaseCurrency,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from '@/hooks/useBaseCurrency';
import { usePortfolioSentiment } from '@/hooks/usePortfolioSentiment';
import { fetchQuote, fetchHistoricalPrice, fetchFxRate, fetchPortfolioNews, normaliseCompanyName, type NewsArticle } from '@/services/marketDataService';
import { getSentiment, type Sentiment } from '@/lib/sentimentAnalysis';

/**
 * Formats a number as a currency amount using the currency's decimal rules.
 * Kept outside the component so it's stable across renders and can be used
 * from both the summary and the per-row rendering without re-creation.
 */
function formatMoney(value: number, code: CurrencyCode): string {
  const meta = SUPPORTED_CURRENCIES[code];
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  return `${meta.symbol}${formatted}`;
}

const PortfolioPanel = () => {
  const { locale, t } = useLanguage();
  const { stock } = useStock();
  const { positions, addPosition, removePosition } = usePortfolio();
  const { baseCurrency, baseMeta, setBaseCurrency } = useBaseCurrency(locale);

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [fxLoading, setFxLoading] = useState(false);

  // Portfolio-wide news. Fetched once per (positions list) change using
  // fetchPortfolioNews, which joins all position names into a single
  // OR-query to conserve NewsAPI quota. See that function's header for
  // the rationale.
  const [portfolioNews, setPortfolioNews] = useState<NewsArticle[]>([]);

  // News-sentiment roll-up for the top portfolio positions. See the hook's
  // header for the quota reasoning and the TOP_N cap. We pass livePrices
  // so the ranking by notional value uses live quotes when available.
  const { sentimentMap } = usePortfolioSentiment(positions, livePrices, locale);

  const [buyPrice, setBuyPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [pickDate, setPickDate] = useState('');
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false);

  // Request-id guards for out-of-order responses. See StockSearch.tsx's
  // header comment for the rationale behind this pattern — same idea, same
  // reason (user can change the underlying inputs while a fetch is in flight,
  // and we need to drop responses that arrive after a newer request).
  const latestHistoricalRequestId = useRef(0);
  const latestFxRequestId = useRef(0);
  const latestNewsRequestId = useRef(0);

  // ─── Live quote fetching ────────────────────────────────────────────────
  //
  // Batch the live-quote fetches with Promise.all so every quote lands in a
  // single setState call. Using `forEach(async ...)` here would fire one
  // setState per resolved request, causing one re-render per position and a
  // visible "prices filling in one at a time" flicker.
  useEffect(() => {
    if (positions.length === 0) return;
    const symbols = [...new Set(positions.map(p => p.symbol))];
    Promise.all(symbols.map(sym => fetchQuote(sym))).then(quotes => {
      const updated: Record<string, number> = {};
      quotes.forEach((q, i) => {
        if (q) updated[symbols[i]] = q.price;
      });
      setLivePrices(prev => ({ ...prev, ...updated }));
    });
  }, [positions]);

  // ─── FX rate fetching ───────────────────────────────────────────────────
  //
  // Collect every unique (position.currency → baseCurrency) pair currently
  // needed, skip the trivial same-currency pairs (rate 1), and fetch the
  // rest in parallel. The `fetchFxRate` service function caches for 5
  // minutes, so this is cheap on re-renders and on locale/base-currency
  // toggles that hit the cache.
  //
  // The request-id guard protects against out-of-order resolution if the
  // user toggles between base currencies faster than the network round-trip.
  useEffect(() => {
    if (positions.length === 0) {
      setFxRates({});
      setFxLoading(false);
      return;
    }
    const neededPairs = [...new Set(
      positions
        .map(p => p.currency)
        .filter((c): c is string => !!c && c !== baseCurrency)
    )];

    if (neededPairs.length === 0) {
      // Every position is already in the base currency — no network needed.
      setFxRates({});
      setFxLoading(false);
      return;
    }

    const myId = ++latestFxRequestId.current;
    setFxLoading(true);
    Promise.all(
      neededPairs.map(async (from) => {
        const rate = await fetchFxRate(from, baseCurrency);
        return [from, rate] as const;
      })
    ).then(results => {
      if (myId !== latestFxRequestId.current) return;
      const next: Record<string, number> = {};
      for (const [from, rate] of results) {
        if (rate !== null) next[from] = rate;
      }
      setFxRates(next);
      setFxLoading(false);
    }).catch(() => {
      if (myId !== latestFxRequestId.current) return;
      setFxLoading(false);
    });
  }, [positions, baseCurrency]);

  // ─── Portfolio news fetch ───────────────────────────────────────────────
  //
  // One batched fetch covering every held position. The query is built on
  // the service side from normalised position names (legal-entity suffixes
  // stripped). Results are cached in the service layer for 5 minutes, so
  // flipping positions in and out quickly doesn't hammer the NewsAPI quota.
  //
  // We re-run whenever the set of symbols changes. Using the position
  // objects directly as a dep would re-fetch on every price update (since
  // the positions array is replaced on any setPositions call, but the
  // relevant identity here is just the symbol set). We derive a stable
  // join string for the dep instead.
  const symbolsJoined = useMemo(
    () => positions.map(p => p.symbol).sort().join('|'),
    [positions]
  );

  useEffect(() => {
    if (positions.length === 0) {
      setPortfolioNews([]);
      return;
    }
    const myId = ++latestNewsRequestId.current;
    fetchPortfolioNews(positions.map(p => p.name), locale)
      .then(articles => {
        if (myId !== latestNewsRequestId.current) return;
        setPortfolioNews(articles);
      })
      .catch(() => {
        if (myId !== latestNewsRequestId.current) return;
        setPortfolioNews([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsJoined, locale]);

  // ─── Per-position sentiment aggregation ─────────────────────────────────
  //
  // For each position, find the headlines in `portfolioNews` that mention
  // the (normalised) company name and tally bullish/bearish/neutral counts
  // using the rule-based classifier in `lib/sentimentAnalysis.ts`. The
  // "dominant" sentiment (strict majority of non-neutral hits) drives the
  // per-row badge; positions with no matched articles show no badge.
  //
  // Matching is case-insensitive substring against the normalised name.
  // That's deliberately generous — the news-query side already OR-joined
  // the same normalised names, so any article that came back is known to
  // mention at least one of them, and we want to credit the right one(s).
  const positionSentiment = useMemo(() => {
    const result: Record<string, { dominant: Sentiment | null; bullish: number; bearish: number; neutral: number; total: number }> = {};
    for (const p of positions) {
      const needle = normaliseCompanyName(p.name).toLowerCase();
      if (!needle) {
        result[p.id] = { dominant: null, bullish: 0, bearish: 0, neutral: 0, total: 0 };
        continue;
      }
      let bullish = 0, bearish = 0, neutral = 0;
      for (const article of portfolioNews) {
        if (!article.headline.toLowerCase().includes(needle)) continue;
        const s = getSentiment(article.headline);
        if      (s === 'bullish') bullish++;
        else if (s === 'bearish') bearish++;
        else                      neutral++;
      }
      const total = bullish + bearish + neutral;
      let dominant: Sentiment | null = null;
      if (total > 0) {
        if      (bullish > bearish && bullish > neutral) dominant = 'bullish';
        else if (bearish > bullish && bearish > neutral) dominant = 'bearish';
        else                                             dominant = 'neutral';
      }
      result[p.id] = { dominant, bullish, bearish, neutral, total };
    }
    return result;
  }, [positions, portfolioNews]);

  // Portfolio-wide alert counters for the header banner.
  const alertCounts = useMemo(() => {
    let bullishPositions = 0, bearishPositions = 0;
    for (const p of positions) {
      const s = positionSentiment[p.id]?.dominant;
      if      (s === 'bullish') bullishPositions++;
      else if (s === 'bearish') bearishPositions++;
    }
    return { bullish: bullishPositions, bearish: bearishPositions };
  }, [positions, positionSentiment]);

  // ─── Per-position conversion ────────────────────────────────────────────
  //
  // Each position gets its current value and P&L computed in BOTH its
  // native currency (for the per-row "you bought N shares at X" text) and
  // the base currency (for the summary roll-up and the per-row value
  // column). A position whose FX rate is missing (failed fetch or still
  // loading) is flagged with `converted: null` so the renderer can show a
  // placeholder rather than lying with an unconverted number.
  const convertedPositions = useMemo(() => {
    return positions.map(p => {
      const nativeCurrency = (p.currency || 'USD') as string;
      const currentPrice = livePrices[p.symbol] ?? p.buyPrice;
      const nativeValue = currentPrice * p.quantity;
      const nativeCost = p.buyPrice * p.quantity;
      const nativePL = nativeValue - nativeCost;
      const nativePLPct = nativeCost > 0 ? (nativePL / nativeCost) * 100 : 0;

      // Determine the conversion factor from native to base currency.
      // Same currency → 1. Different currency → fxRates[native] if loaded,
      // otherwise null (display as placeholder).
      let factor: number | null;
      if (nativeCurrency === baseCurrency) {
        factor = 1;
      } else if (fxRates[nativeCurrency] !== undefined) {
        factor = fxRates[nativeCurrency];
      } else {
        factor = null;
      }

      return {
        position: p,
        currentPrice,
        nativeCurrency,
        nativeValue,
        nativePL,
        nativePLPct,
        converted: factor !== null
          ? {
              value: nativeValue * factor,
              cost:  nativeCost  * factor,
              pl:    nativePL    * factor,
              plPct: nativePLPct, // percent is unit-less, unchanged by FX
            }
          : null,
      };
    });
  }, [positions, livePrices, fxRates, baseCurrency]);

  // ─── Summary totals ─────────────────────────────────────────────────────
  //
  // Roll up into the base currency. Positions whose FX rate failed to load
  // are EXCLUDED from the summary rather than being counted at their native
  // value — the alternative would silently understate or overstate the
  // total depending on which direction the missing pair would have
  // converted. Instead we track how many positions were skipped and show
  // a small warning if any were.
  const { totalValue, totalCost, skippedCount } = useMemo(() => {
    let v = 0, c = 0, skipped = 0;
    for (const cp of convertedPositions) {
      if (cp.converted) {
        v += cp.converted.value;
        c += cp.converted.cost;
      } else {
        skipped++;
      }
    }
    return { totalValue: v, totalCost: c, skippedCount: skipped };
  }, [convertedPositions]);

  const totalPL = totalValue - totalCost;
  const totalPLPercent = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;

  // Count how many of the tracked positions currently have a dominant
  // bearish news reading. This surfaces as a small alert badge in the
  // header so the user notices before digging into individual rows.
  // Positions outside the sentiment hook's top-N cap contribute zero here
  // by definition (they simply don't appear in the map).
  const bearishAlertCount = useMemo(() => {
    let count = 0;
    for (const symbol of Object.keys(sentimentMap)) {
      if (sentimentMap[symbol].dominant === 'bearish') count++;
    }
    return count;
  }, [sentimentMap]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleAdd = () => {
    const bp = parseFloat(buyPrice);
    const qty = parseFloat(quantity);
    if (!bp || !qty || bp <= 0 || qty <= 0) return;
    addPosition({
      symbol: stock.symbol,
      name: stock.name,
      buyPrice: bp,
      quantity: qty,
      // Record the stock's native currency at time of add. This is the
      // currency the buyPrice is denominated in, and it's what drives FX
      // conversion in every subsequent render of this panel.
      currency: stock.currency || 'USD',
    });
    setBuyPrice('');
    setQuantity('');
    setShowForm(false);
    setShowDatePicker(false);
    setPickDate('');
  };

  const handlePickDate = async () => {
    if (!pickDate) return;
    const myId = ++latestHistoricalRequestId.current;
    setLoadingPrice(true);
    try {
      const result = await fetchHistoricalPrice(stock.symbol, pickDate);
      if (myId !== latestHistoricalRequestId.current) return;
      if (result) setBuyPrice(result.close.toFixed(2));
    } catch (err) {
      if (myId !== latestHistoricalRequestId.current) return;
      console.warn('Failed to fetch historical price', err);
    } finally {
      if (myId === latestHistoricalRequestId.current) setLoadingPrice(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="glass-card p-6">
      {/* Header with title + bearish alert + base currency selector */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <Briefcase className="w-3.5 h-3.5" />
          {t.portfolioTitle}
          {bearishAlertCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20 text-[9px] font-medium normal-case tracking-normal"
              title={`${bearishAlertCount} position${bearishAlertCount > 1 ? 's' : ''} with predominantly bearish news`}
            >
              ▼ {bearishAlertCount}
            </span>
          )}
        </h3>
        <div className="relative">
          <button
            onClick={() => setCurrencyMenuOpen(v => !v)}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground bg-muted/30 rounded px-2 py-1 transition-colors"
            aria-label="Base currency"
          >
            <span className="text-foreground">{baseMeta.symbol}</span>
            <span>{baseMeta.label}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {currencyMenuOpen && (
            <div className="absolute right-0 mt-1 z-50 glass-card p-1 min-w-[90px] shadow-xl">
              {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map(code => {
                const m = SUPPORTED_CURRENCIES[code];
                return (
                  <button
                    key={code}
                    onClick={() => { setBaseCurrency(code); setCurrencyMenuOpen(false); }}
                    className={`w-full text-left px-2 py-1 text-[10px] rounded flex items-center gap-2 transition-colors ${
                      code === baseCurrency
                        ? 'bg-accent/10 text-accent'
                        : 'hover:bg-muted/50 text-foreground'
                    }`}
                  >
                    <span className="font-mono w-3">{m.symbol}</span>
                    <span className="font-mono">{m.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Summary roll-up — values are in baseCurrency */}
      {positions.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-muted/30 rounded-lg px-3 py-2">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              {t.portfolioTotalValue}
              <span className="text-[9px] font-mono opacity-60">{baseMeta.label}</span>
            </p>
            <p className="num text-sm text-foreground">
              {fxLoading && skippedCount === positions.length
                ? <span className="opacity-50">···</span>
                : formatMoney(totalValue, baseCurrency)}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg px-3 py-2">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              {t.portfolioTotalPL}
              <span className="text-[9px] font-mono opacity-60">{baseMeta.label}</span>
            </p>
            <p className={`num text-sm flex items-center gap-1 ${totalPL >= 0 ? 'ticker-positive' : 'ticker-negative'}`}>
              {totalPL >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {totalPL >= 0 ? '+' : ''}{formatMoney(totalPL, baseCurrency)}
              <span className="text-[10px] opacity-80">({totalPLPercent.toFixed(2)}%)</span>
            </p>
          </div>
        </div>
      )}

      {/* Sentiment alert banner — shown only when at least one position has
          dominantly bearish or bullish coverage in the recent news digest.
          The banner is cosmetic, not a recommendation — it just tells the
          user "there's news about N of your positions that you probably
          want to look at". Bearish is prioritised because a holder cares
          more about downside news than confirmation of upside. */}
      {positions.length > 0 && (alertCounts.bearish > 0 || alertCounts.bullish > 0) && (
        <div className="mb-3 flex items-center gap-3 px-2 py-1.5 text-[10px] rounded border border-border/40 bg-muted/20">
          {alertCounts.bearish > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <TrendingDown className="w-3 h-3" />
              {alertCounts.bearish} bearish
            </span>
          )}
          {alertCounts.bullish > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <TrendingUp className="w-3 h-3" />
              {alertCounts.bullish} bullish
            </span>
          )}
          <span className="text-muted-foreground opacity-70">
            · based on {portfolioNews.length} recent headlines
          </span>
        </div>
      )}

      {/* Warning when some positions couldn't be converted — shows so the
          user understands why the summary may look smaller than expected. */}
      {skippedCount > 0 && (
        <div className="mb-3 px-2 py-1.5 text-[10px] text-warning bg-warning/10 border border-warning/20 rounded">
          {skippedCount === 1
            ? '1 position excluded from totals — FX rate unavailable'
            : `${skippedCount} positions excluded from totals — FX rates unavailable`}
        </div>
      )}

      <ScrollArea className="h-[150px] mb-3">
        {positions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Briefcase className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-[11px] text-muted-foreground">{t.portfolioEmpty}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {convertedPositions.map(cp => {
              const { position: p, nativeCurrency, converted } = cp;
              const nativeMeta = (SUPPORTED_CURRENCIES as Record<string, typeof SUPPORTED_CURRENCIES.USD>)[nativeCurrency];
              // `nativeMeta` may be undefined if a position was stored with
              // a currency code we don't have metadata for (shouldn't happen
              // via the add flow, but possible from stale localStorage).
              // Fall back to a bare code prefix with no symbol.
              const nativeSymbol = nativeMeta?.symbol ?? '';
              const nativeDecimals = nativeMeta?.decimals ?? 2;

              const sentiment = positionSentiment[p.id];
              const sentimentBadge = sentiment?.dominant ? {
                bullish: { char: '▲', cls: 'text-green-400' },
                bearish: { char: '▼', cls: 'text-red-400' },
                neutral: { char: '●', cls: 'text-muted-foreground' },
              }[sentiment.dominant] : null;
              const sentimentTooltip = sentiment && sentiment.total > 0
                ? `${sentiment.total} recent headline${sentiment.total === 1 ? '' : 's'}: ${sentiment.bullish}▲ ${sentiment.bearish}▼ ${sentiment.neutral}●`
                : undefined;

              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/30 transition-colors text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate flex items-center gap-1.5">
                      <span className="truncate">{p.name}</span>
                      {sentimentBadge && (
                        <span
                          className={`text-[10px] shrink-0 ${sentimentBadge.cls}`}
                          title={sentimentTooltip}
                        >
                          {sentimentBadge.char}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground num">
                      {p.quantity} × {nativeSymbol}{p.buyPrice.toLocaleString(undefined, {
                        minimumFractionDigits: nativeDecimals,
                        maximumFractionDigits: nativeDecimals,
                      })}
                      {nativeCurrency !== baseCurrency && (
                        <span className="ml-1 opacity-60">{nativeCurrency}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      {converted ? (
                        <>
                          <p className="num text-foreground">
                            {formatMoney(converted.value, baseCurrency)}
                          </p>
                          <p className={`num text-[10px] ${converted.pl >= 0 ? 'ticker-positive' : 'ticker-negative'}`}>
                            {converted.pl >= 0 ? '+' : ''}{formatMoney(converted.pl, baseCurrency)}
                            {' '}({converted.plPct.toFixed(1)}%)
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="num text-muted-foreground/50 text-[11px]">
                            {fxLoading ? '···' : 'FX n/a'}
                          </p>
                          <p className="num text-[10px] text-muted-foreground/40">
                            {nativeCurrency}
                          </p>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => removePosition(p.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {showForm ? (
        <div className="border-t border-border/50 pt-3 space-y-2">
          <p className="text-[10px] text-muted-foreground font-medium">
            {stock.name} ({stock.symbol})
            {stock.currency && (
              <span className="ml-1 opacity-60 font-mono">· {stock.currency}</span>
            )}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="flex items-center gap-1 text-[10px] text-accent hover:underline transition-colors"
            >
              <CalendarSearch className="w-3 h-3" />
              {t.portfolioPickDate}
            </button>
          </div>
          {showDatePicker && (
            <div className="flex gap-1.5 items-center">
              <input
                type="date"
                value={pickDate}
                onChange={e => setPickDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="flex-1 bg-muted/30 border border-border/50 rounded-lg px-2 py-1 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent num"
              />
              <button
                onClick={handlePickDate}
                disabled={loadingPrice || !pickDate}
                className="px-2 py-1 bg-accent/20 text-accent rounded text-[10px] font-medium hover:bg-accent/30 transition-colors disabled:opacity-40"
              >
                {loadingPrice ? <Loader2 className="w-3 h-3 animate-spin" /> : t.portfolioApply}
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="number"
              placeholder={t.portfolioBuyPrice}
              value={buyPrice}
              onChange={e => setBuyPrice(e.target.value)}
              className="flex-1 bg-muted/30 border border-border/50 rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent num"
            />
            <input
              type="number"
              placeholder={t.portfolioQty}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="w-20 bg-muted/30 border border-border/50 rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent num"
            />
            <button
              onClick={handleAdd}
              className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
            >
              OK
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border/50 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t.portfolioAddStock}
        </button>
      )}
    </div>
  );
};

export default PortfolioPanel;
