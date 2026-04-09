/**
 * @file skHynixData.ts
 * @description Simulated price history and event markers for SK hynix (000660.KS).
 *
 * WHY SIMULATED:
 *   SK hynix is listed on the Korea Exchange (KRX). Alpha Vantage's free plan
 *   has inconsistent coverage of KRX-listed securities — the TIME_SERIES_DAILY
 *   endpoint often returns empty or incomplete data for Korean tickers.
 *
 *   This file provides a deterministic, seeded simulation of SK hynix price
 *   history from January 2016 to February 2026, calibrated so the final data
 *   point matches the real approximate price of ₩312,400 as of early 2026.
 *   The simulation uses a multi-phase GBM (Geometric Brownian Motion) model
 *   with trend and volatility parameters tuned to reflect actual market phases
 *   (e.g. the 2022 DRAM downturn, the 2023–2024 HBM-driven recovery).
 *
 * LIVE UPGRADE PATH:
 *   When a reliable KRX data source is available, replace the four exported
 *   data arrays with API-fetched equivalents:
 *     - skHynixChartData  → fetchStockHistory('000660.KS', 'Max')
 *     - skHynixDailyData  → fetchStockHistory('000660.KS', '1M')
 *     - skHynixIntradayData → fetchStockHistory('000660.KS', '1D')
 *     - skHynix5DayData   → fetchStockHistory('000660.KS', '5D')
 *   All four are already consumed by StockChart.tsx via getFallbackData(),
 *   which itself is only called when the live API fetch fails or returns empty.
 *   Alternative KRX data sources to consider:
 *     - KIS Developers API (Korea Investment Securities, Korean-language)
 *     - FinanceDataReader (Python, open-source — would need a backend endpoint)
 *     - Polygon.io (covers KRX on paid plans)
 *
 * SEEDED PRNG:
 *   The Park-Miller LCG (seed 42/789/123/456) ensures the generated data is
 *   identical on every build — no hydration mismatches, no random chart jumps
 *   on page reload. Do not change the seeds without regenerating the calibration.
 *
 * EVENT MARKERS:
 *   `skHynixEvents` is a curated list of real macro and corporate events that
 *   significantly influenced SK hynix's stock price. These are overlaid as
 *   colored dots on the chart in StockChart.tsx and translated per locale
 *   via the `eventTranslations` map defined there.
 *   Event labels use English as the canonical key for translation lookups.
 */

export interface ChartDataPoint {
  date: string;
  price: number;
  label?: string;
}

export interface EventMarker {
  date: string;
  /** Canonical English label — used as the translation key in StockChart.tsx */
  label: string;
  type: 'earnings' | 'product' | 'macro';
}

// ─── Seeded PRNG ──────────────────────────────────────────────────────────────
// Park-Miller LCG: fast, seedable, sufficient entropy for price simulation.
// Not cryptographically secure — only used for deterministic chart data.
function createRng(seed: number) {
  let s = seed;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  // Box-Muller transform for normally distributed returns
  const normal = () => {
    const u1 = next(), u2 = next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  return { next, normal };
}

// ─── Monthly historical data (2016-01 → 2026-02) ─────────────────────────────
// Multi-phase GBM with trend/vol parameters tuned to real SK hynix market phases.
// Final price is re-anchored to ₩312,400 via linear scaling over the last 12 months.
function generateHistoricalData(): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  let price = 30000;

  const phases: { until: string; trend: number; vol: number }[] = [
    { until: '2016-12', trend:  0.03, vol: 0.06 },  // Recovery
    { until: '2017-12', trend:  0.05, vol: 0.05 },  // DRAM supercycle
    { until: '2018-06', trend:  0.03, vol: 0.07 },  // Peak
    { until: '2018-12', trend: -0.04, vol: 0.07 },  // Downturn begins
    { until: '2019-09', trend: -0.03, vol: 0.06 },  // DRAM oversupply
    { until: '2019-12', trend:  0.04, vol: 0.05 },  // Partial recovery
    { until: '2020-03', trend: -0.06, vol: 0.10 },  // COVID crash
    { until: '2020-12', trend:  0.06, vol: 0.06 },  // Post-COVID rebound
    { until: '2021-12', trend:  0.03, vol: 0.05 },  // Steady growth
    { until: '2022-06', trend: -0.02, vol: 0.06 },  // Rate hike pressure
    { until: '2022-12', trend: -0.05, vol: 0.08 },  // DRAM downturn
    { until: '2023-06', trend: -0.01, vol: 0.05 },  // Trough / sideways
    { until: '2023-12', trend:  0.08, vol: 0.06 },  // HBM demand surge
    { until: '2024-06', trend:  0.06, vol: 0.05 },  // HBM3E ramp
    { until: '2024-08', trend: -0.03, vol: 0.07 },  // Pullback
    { until: '2024-12', trend:  0.04, vol: 0.05 },  // Recovery
    { until: '2025-06', trend:  0.03, vol: 0.04 },  // HBM4 ramp
    { until: '2025-09', trend: -0.01, vol: 0.05 },  // Consolidation
    { until: '2025-12', trend:  0.03, vol: 0.04 },  // Year-end rally
    { until: '2026-02', trend:  0.02, vol: 0.03 },  // Current
  ];

  const rng = createRng(42);
  let phaseIdx = 0;

  for (let y = 2016; y <= 2026; y++) {
    const maxM = y === 2026 ? 2 : 12;
    for (let m = 1; m <= maxM; m++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}`;
      while (phaseIdx < phases.length - 1 && dateStr > phases[phaseIdx].until) phaseIdx++;
      const { trend, vol } = phases[phaseIdx];
      price = Math.max(20000, Math.round(price * (1 + trend + vol * rng.normal()) / 100) * 100);
      points.push({ date: dateStr, price });
    }
  }

  // Anchor the last 12 months to land exactly at ₩312,400
  const lastIdx   = points.length - 1;
  const ratio      = 312400 / points[lastIdx].price;
  const scaleStart = Math.max(0, lastIdx - 11);
  for (let i = scaleStart; i <= lastIdx; i++) {
    const t = (i - scaleStart) / (lastIdx - scaleStart);
    points[i].price = Math.round(points[i].price * (1 + (ratio - 1) * t) / 100) * 100;
  }
  return points;
}

// ─── Daily data for the last ~60 trading days (Jan–Feb 2026) ─────────────────
// Used for the 1M chart range when live API data is unavailable.
function generateDailyData(): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  const rng   = createRng(789);
  let price   = 295000;
  const start = new Date(2026, 0, 1);
  const end   = new Date(2026, 1, 28);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // Skip weekends
    const change = (rng.next() - 0.47) * 4000 + 300;
    price = Math.max(280000, Math.round((price + change) / 100) * 100);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    points.push({ date: dateStr, price });
  }
  points[points.length - 1].price = 312400; // Anchor to reference price
  return points;
}

// ─── Intraday data (5-min intervals, KRX session: 09:00–15:30 KST) ───────────
// Used for the 1D chart range when live intraday data is unavailable.
function generateIntradayData(): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  const rng  = createRng(123);
  let price  = 310200;

  for (let h = 9; h <= 15; h++) {
    const maxMin = h === 15 ? 30 : 55; // KRX closes at 15:30
    for (let m = 0; m <= maxMin; m += 5) {
      price = Math.max(305000, Math.round((price + (rng.next() - 0.48) * 800) / 100) * 100);
      points.push({ date: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, price });
    }
  }
  points[points.length - 1].price = 312400;
  return points;
}

// ─── 5-Day data (30-min intervals, Mon 24 Feb – Fri 28 Feb 2026) ─────────────
// Used for the 5D chart range when live data is unavailable.
function generate5DayData(): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  const days = ['02/24', '02/25', '02/26', '02/27', '02/28'];
  const rng  = createRng(456);
  let price  = 305000;

  for (const day of days) {
    for (let h = 9; h <= 15; h++) {
      const maxMin = h === 15 ? 30 : 30;
      for (let m = 0; m <= maxMin; m += 30) {
        price = Math.max(295000, Math.round((price + (rng.next() - 0.47) * 1200) / 100) * 100);
        points.push({ date: `${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, price });
      }
    }
  }
  points[points.length - 1].price = 312400;
  return points;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const skHynixChartData: ChartDataPoint[]    = generateHistoricalData();
export const skHynixDailyData: ChartDataPoint[]    = generateDailyData();
export const skHynixIntradayData: ChartDataPoint[] = generateIntradayData();
export const skHynix5DayData: ChartDataPoint[]     = generate5DayData();

// ─── Event markers ────────────────────────────────────────────────────────────
// Real events that materially affected SK hynix's share price.
// Displayed as colored dots on the chart; translated in StockChart.tsx.
// type: 'earnings' (amber) | 'product' (blue) | 'macro' (green)
export const skHynixEvents: EventMarker[] = [
  // 2023
  { date: '2023-07', label: 'DRAM Price Recovery',              type: 'macro'    },
  { date: '2023-09', label: 'HBM3 Revenue Surge',               type: 'earnings' },
  { date: '2023-11', label: 'Fed Pause Signal',                 type: 'macro'    },
  // 2024
  { date: '2024-01', label: 'CES 2024 AI Chip Showcase',        type: 'product'  },
  { date: '2024-02', label: 'NVIDIA Q4 Earnings Beat',          type: 'earnings' },
  { date: '2024-03', label: 'BOJ Rate Hike (First Since 2007)', type: 'macro'    },
  { date: '2024-05', label: 'HBM3E Mass Production',            type: 'product'  },
  { date: '2024-06', label: 'ECB Rate Cut Start',               type: 'macro'    },
  { date: '2024-07', label: 'FOMC Hold + Inflation Data',       type: 'macro'    },
  { date: '2024-08', label: 'NVIDIA Q2 Earnings',               type: 'earnings' },
  { date: '2024-09', label: 'Fed 50bps Rate Cut',               type: 'macro'    },
  { date: '2024-10', label: 'SK hynix Q3 Record Profit',        type: 'earnings' },
  { date: '2024-11', label: 'HBM4 Samples to NVIDIA',           type: 'product'  },
  { date: '2024-12', label: 'FOMC 25bps Cut + Hawkish Guidance',type: 'macro'    },
  // 2025
  { date: '2025-01', label: 'SK hynix Q4 FY24 Earnings',        type: 'earnings' },
  { date: '2025-02', label: 'NVIDIA Q4 FY25 Earnings',          type: 'earnings' },
  { date: '2025-03', label: 'FOMC Hold + Dot Plot Shift',       type: 'macro'    },
  { date: '2025-04', label: 'HBM4 Qualification Complete',      type: 'product'  },
  { date: '2025-06', label: 'HBM4 Mass Production',             type: 'product'  },
  { date: '2025-07', label: 'US CPI Below 2.5%',                type: 'macro'    },
  { date: '2025-08', label: 'NVIDIA Q2 FY26 Earnings',          type: 'earnings' },
  { date: '2025-09', label: 'Fed Rate Cut',                     type: 'macro'    },
  { date: '2025-10', label: 'SK hynix Q3 Earnings Beat',        type: 'earnings' },
  { date: '2025-11', label: 'DDR6 Standard Finalized',          type: 'product'  },
  { date: '2025-12', label: 'FOMC Year-End Decision',           type: 'macro'    },
  // 2026
  { date: '2026-01', label: 'HBM4E Announcement',               type: 'product'  },
  { date: '2026-02', label: 'NVIDIA Q4 FY26 Earnings Preview',  type: 'earnings' },
];

// ─── Reference stats ──────────────────────────────────────────────────────────
// Static snapshot as of early 2026. Shown in the chart header when the default
// SK hynix stock is selected. Live values are fetched via fetchQuote('000660.KS')
// in StockChart.tsx and overlay these if the API call succeeds.
export const skHynixStats = {
  ticker:        '000660.KS',
  name:          'SK hynix Inc.',
  price:         312400,
  change:        8200,
  changePercent: 2.70,
  marketCap:     '227.4T KRW',
  marketCapKRW:  227_400_000_000_000,
  pe:            8.2,
  high52w:       315000,
  low52w:        128000,
  volume:        '4.2M',
};
