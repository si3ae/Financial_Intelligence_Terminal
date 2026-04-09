/**
 * @file technicalIndicators.ts
 * @description Pure functions that compute moving averages, RSI, and MACD
 * for chart overlays. No I/O, no React, safe to import from anywhere.
 *
 * DESIGN NOTES:
 *   - Every indicator returns `(number | undefined)[]` aligned 1:1 with the
 *     input price array. The undefined values mark the warm-up window where
 *     the indicator is not yet defined (e.g. the first 49 points have no
 *     50-period SMA). Renderers should treat undefined as "skip this point",
 *     which yields a clean line that starts where the indicator becomes
 *     mathematically valid rather than a distorted line that hugs the price
 *     during warm-up.
 *
 *   - The MA period is no longer clamped to a fraction of the input length.
 *     Earlier versions silently reduced "MA50" to a 24-period MA on short
 *     histories so a line would always render — but the chart legend still
 *     said "MA50", which was misleading. The honest behaviour is: if the
 *     history is too short for the requested period, the indicator simply
 *     does not appear. The user can switch to a longer range to see it.
 */

export interface IndicatorPoint {
  date: string;
  price: number;
  ma50?: number;
  ma200?: number;
  rsi?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHist?: number;
}

/**
 * Simple moving average. Returns undefined for the first `period - 1`
 * positions where the window isn't yet full.
 */
function sma(data: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(undefined);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

/**
 * Exponential moving average.
 *
 * Standard textbook construction: seed with the SMA of the first `period`
 * points, then apply the recurrence  EMA[i] = price[i] * k + EMA[i-1] * (1-k)
 * with k = 2 / (period + 1).
 *
 * The first `period - 1` positions have no defined EMA. The previous version
 * filled them with the raw price, which made chart overlays jump abruptly
 * from "tracks the price exactly" to "real EMA" at index `period - 1`. We
 * now return the seed value at index `period - 1` and rely on the caller to
 * mask off the warm-up positions when constructing chart-ready output.
 *
 * This function still returns `number[]` (not `(number | undefined)[]`) so
 * that the MACD computation downstream can do plain arithmetic without
 * undefined-guards on every step. The masking happens in `calculateIndicators`
 * where it's visually adjacent to the MACD slicing logic.
 */
function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(data.length);
  // Seed with the SMA of the first `period` values.
  const seed = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Warm-up positions: caller masks these to undefined for chart output.
  // We fill with the seed so any accidental read returns a sensible number
  // rather than NaN.
  for (let i = 0; i < period - 1; i++) result[i] = seed;
  result[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

export function calculateIndicators(
  data: { date: string; price: number }[],
  options: { ma50?: boolean; ma200?: boolean; rsi?: boolean; macd?: boolean }
): IndicatorPoint[] {
  const prices = data.map(d => d.price);

  // SMAs use their full requested period — no silent clamping. If `prices` is
  // shorter than the period, every entry is undefined and the indicator
  // simply does not render, which is the correct behaviour. The user sees no
  // line rather than a mislabelled line.
  const ma50Vals  = options.ma50  ? sma(prices, 50)  : [];
  const ma200Vals = options.ma200 ? sma(prices, 200) : [];

  // RSI (14-period, Wilder's smoothing)
  let rsiVals: (number | undefined)[] = [];
  if (options.rsi && prices.length >= 15) {
    const period = 14;
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    rsiVals.push(undefined); // first price has no preceding diff
    for (let i = 0; i < gains.length; i++) {
      if (i < period - 1) {
        rsiVals.push(undefined);
      } else if (i === period - 1) {
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiVals.push(100 - 100 / (1 + rs));
      } else {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiVals.push(100 - 100 / (1 + rs));
      }
    }
  }

  // MACD (12, 26, 9). Needs at least 26 + 9 = 35 points for the full signal
  // line; we keep a 27-point gate so the macdLine renders as soon as ema26
  // becomes valid, matching common charting conventions where the histogram
  // appears later than the line. The signal/histogram are explicitly masked
  // off during their own 9-period warm-up below so the chart never shows
  // the seed-flat segment that the old implementation produced.
  let macdLines:   (number | undefined)[] = [];
  let macdSignals: (number | undefined)[] = [];
  let macdHists:   (number | undefined)[] = [];
  if (options.macd && prices.length >= 27) {
    const ema12 = ema(prices, 12);
    const ema26 = ema(prices, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    // Signal line is a 9-period EMA of macdLine, but only of the portion
    // where macdLine is mathematically defined (index 25 onwards, which is
    // ema26's first valid index).
    const signal = ema(macdLine.slice(25), 9);
    // Index in the original prices array where the signal line becomes
    // mathematically valid: 25 (start of macdLine) + 8 (signal warm-up of
    // length period - 1 = 8) = 33.
    const signalValidFrom = 25 + 8;
    for (let i = 0; i < prices.length; i++) {
      if (i < 25) {
        // macdLine itself is in EMA warm-up — mask the entire MACD trio.
        macdLines.push(undefined);
        macdSignals.push(undefined);
        macdHists.push(undefined);
      } else if (i < signalValidFrom) {
        // macdLine is valid but signal is still warming up. Show the line
        // alone; suppress signal and histogram so the chart doesn't draw a
        // flat seed segment.
        macdLines.push(macdLine[i]);
        macdSignals.push(undefined);
        macdHists.push(undefined);
      } else {
        const ml = macdLine[i];
        const si = signal[i - 25];
        macdLines.push(ml);
        macdSignals.push(si);
        macdHists.push(ml - si);
      }
    }
  }

  return data.map((d, i) => ({
    date: d.date,
    price: d.price,
    ...(options.ma50  && ma50Vals[i]    !== undefined ? { ma50:       ma50Vals[i] }    : {}),
    ...(options.ma200 && ma200Vals[i]   !== undefined ? { ma200:      ma200Vals[i] }   : {}),
    ...(options.rsi   && rsiVals[i]     !== undefined ? { rsi:        rsiVals[i] }     : {}),
    ...(options.macd  && macdLines[i]   !== undefined ? { macdLine:   macdLines[i] }   : {}),
    ...(options.macd  && macdSignals[i] !== undefined ? { macdSignal: macdSignals[i] } : {}),
    ...(options.macd  && macdHists[i]   !== undefined ? { macdHist:   macdHists[i] }   : {}),
  }));
}
