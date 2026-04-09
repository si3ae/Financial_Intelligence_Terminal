/**
 * @file StockChart.tsx
 * @description Primary price chart for the terminal. Renders the currently
 * selected stock from `useStockContext` with time-range controls, optional
 * technical indicator overlays (MA/RSI/MACD), and currency conversion to the
 * user's active locale.
 *
 * DEFAULT SYMBOL:
 *   When no stock is explicitly selected, the chart falls back to SK hynix
 *   (000660.KOR) as the default symbol — it was the original showcase stock
 *   when this project started as a single-stock analyzer before being
 *   generalised into a terminal. SK hynix also happens to be the only symbol
 *   with a pre-bundled fixture (`skHynixData.ts`) and a curated event overlay
 *   (`skHynixEvents`) showing earnings / product / macro catalysts across the
 *   chart timeline. For any other symbol the chart fetches history live and
 *   skips the event dots.
 *
 *   The `isDefaultStock` branch threaded throughout this component exists to
 *   keep that special behaviour (event overlay, 52-week stats card, KRW
 *   formatting) while still letting the same component render any globally
 *   searched ticker. If event overlays were ever added for additional symbols,
 *   the right refactor is to move `skHynixEvents` into a per-symbol map and
 *   drop the `isDefaultStock` flag entirely.
 *
 * DATA SOURCES:
 *   - Live quote, history, and FX rate: marketDataService.ts (Alpha Vantage
 *     routed through the Supabase Edge Function `market-data`).
 *   - SK hynix fallback fixtures: `@/data/skHynixData`. Used only when the
 *     default symbol is active or when a live request fails.
 */
import { useMemo, useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot,
  Line, ComposedChart, Bar,
} from 'recharts';
import { useLanguage } from '@/i18n/LanguageContext';
import { type Locale } from '@/i18n/translations';
import { useStock } from '@/hooks/useStockContext';
import {
  skHynixChartData, skHynixDailyData, skHynixIntradayData, skHynix5DayData,
  skHynixEvents, skHynixStats,
} from '@/data/skHynixData';
import { formatPrice, formatMarketCap, getCurrencyInfo } from '@/data/currencyConversion';
import { fetchStockHistory, fetchQuote, fetchFxRate, type ChartDataPoint, type StockQuote } from '@/services/marketDataService';
import { calculateIndicators, type IndicatorPoint } from '@/lib/technicalIndicators';
import { TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { motion } from 'framer-motion';

// ─── Constants ───────────────────────────────────────────────────────────────

const eventColors: Record<string, string> = {
  earnings: 'hsl(38, 92%, 50%)',
  product: 'hsl(214, 100%, 50%)',
  macro: 'hsl(142, 71%, 45%)',
};

/**
 * Event label translations are kept local (not in translations.ts) because they
 * reference 27+ chart-specific event names that are not reused elsewhere.
 * UI labels (earnings/product/macro) are now sourced from t.eventEarnings etc.
 */
const eventTranslations: Record<Locale, Record<string, string>> = {
  ko: {
    'DRAM Price Recovery': 'DRAM 가격 반등',
    'HBM3 Revenue Surge': 'HBM3 매출 급증',
    'Fed Pause Signal': '연준 금리 동결 시사',
    'CES 2024 AI Chip Showcase': 'CES 2024 AI 칩 전시',
    'NVIDIA Q4 Earnings Beat': 'NVIDIA 4분기 실적 서프라이즈',
    'BOJ Rate Hike (First Since 2007)': 'BOJ 금리 인상 (2007년 이후 첫)',
    'HBM3E Mass Production': 'HBM3E 양산 개시',
    'ECB Rate Cut Start': 'ECB 금리 인하 시작',
    'FOMC Hold + Inflation Data': 'FOMC 동결 + 물가 데이터',
    'NVIDIA Q2 Earnings': 'NVIDIA 2분기 실적',
    'Fed 50bps Rate Cut': '연준 50bp 금리 인하',
    'SK hynix Q3 Record Profit': 'SK하이닉스 3분기 사상최대 실적',
    'HBM4 Samples to NVIDIA': 'HBM4 NVIDIA 샘플 공급',
    'FOMC 25bps Cut + Hawkish Guidance': 'FOMC 25bp 인하 + 매파적 전망',
    'SK hynix Q4 FY24 Earnings': 'SK하이닉스 4분기 FY24 실적',
    'NVIDIA Q4 FY25 Earnings': 'NVIDIA 4분기 FY25 실적',
    'FOMC Hold + Dot Plot Shift': 'FOMC 동결 + 점도표 변경',
    'HBM4 Qualification Complete': 'HBM4 인증 완료',
    'HBM4 Mass Production': 'HBM4 양산 개시',
    'US CPI Below 2.5%': '미국 CPI 2.5% 하회',
    'NVIDIA Q2 FY26 Earnings': 'NVIDIA 2분기 FY26 실적',
    'Fed Rate Cut': '연준 금리 인하',
    'SK hynix Q3 Earnings Beat': 'SK하이닉스 3분기 실적 서프라이즈',
    'DDR6 Standard Finalized': 'DDR6 표준 확정',
    'FOMC Year-End Decision': 'FOMC 연말 결정',
    'HBM4E Announcement': 'HBM4E 발표',
    'NVIDIA Q4 FY26 Earnings Preview': 'NVIDIA 4분기 FY26 실적 프리뷰',
  },
  en: {}, gb: {},
  zh: {
    'DRAM Price Recovery': 'DRAM价格回升',
    'HBM3 Revenue Surge': 'HBM3营收激增',
    'Fed Pause Signal': '美联储暂停加息信号',
    'CES 2024 AI Chip Showcase': 'CES 2024 AI芯片展示',
    'NVIDIA Q4 Earnings Beat': 'NVIDIA四季度业绩超预期',
    'BOJ Rate Hike (First Since 2007)': '日银加息(2007年以来首次)',
    'HBM3E Mass Production': 'HBM3E量产',
    'ECB Rate Cut Start': '欧央行开始降息',
    'FOMC Hold + Inflation Data': 'FOMC按兵不动+通胀数据',
    'NVIDIA Q2 Earnings': 'NVIDIA二季度业绩',
    'Fed 50bps Rate Cut': '美联储50基点降息',
    'SK hynix Q3 Record Profit': 'SK海力士三季度创纪录盈利',
    'HBM4 Samples to NVIDIA': 'HBM4向NVIDIA送样',
    'FOMC 25bps Cut + Hawkish Guidance': 'FOMC 25基点降息+鹰派指引',
    'SK hynix Q4 FY24 Earnings': 'SK海力士四季度FY24业绩',
    'NVIDIA Q4 FY25 Earnings': 'NVIDIA Q4 FY25业绩',
    'HBM4 Mass Production': 'HBM4量产',
    'Fed Rate Cut': '美联储降息',
    'HBM4E Announcement': 'HBM4E发布',
    'NVIDIA Q4 FY26 Earnings Preview': 'NVIDIA Q4 FY26业绩预览',
  },
  ja: {
    'DRAM Price Recovery': 'DRAM価格回復',
    'HBM3 Revenue Surge': 'HBM3売上急増',
    'Fed Pause Signal': 'FRB利上げ停止示唆',
    'CES 2024 AI Chip Showcase': 'CES 2024 AIチップ展示',
    'NVIDIA Q4 Earnings Beat': 'NVIDIA Q4決算上振れ',
    'BOJ Rate Hike (First Since 2007)': '日銀利上げ(2007年以来)',
    'HBM3E Mass Production': 'HBM3E量産開始',
    'ECB Rate Cut Start': 'ECB利下げ開始',
    'FOMC Hold + Inflation Data': 'FOMC据置+インフレデータ',
    'NVIDIA Q2 Earnings': 'NVIDIA Q2決算',
    'Fed 50bps Rate Cut': 'FRB 50bp利下げ',
    'SK hynix Q3 Record Profit': 'SKハイニックスQ3過去最高益',
    'HBM4 Samples to NVIDIA': 'HBM4 NVIDIAへサンプル出荷',
    'FOMC 25bps Cut + Hawkish Guidance': 'FOMC 25bp利下げ+タカ派ガイダンス',
    'SK hynix Q4 FY24 Earnings': 'SKハイニックスQ4 FY24決算',
    'NVIDIA Q4 FY25 Earnings': 'NVIDIA Q4 FY25決算',
    'HBM4 Mass Production': 'HBM4量産開始',
    'Fed Rate Cut': 'FRB利下げ',
    'HBM4E Announcement': 'HBM4E発表',
    'NVIDIA Q4 FY26 Earnings Preview': 'NVIDIA Q4 FY26決算プレビュー',
  },
  de: {
    'NVIDIA Q4 Earnings Beat': 'NVIDIA Q4 Gewinnübertreffen',
    'HBM3E Mass Production': 'HBM3E Massenproduktion',
    'NVIDIA Q2 Earnings': 'NVIDIA Q2 Ergebnis',
    'HBM4 Samples to NVIDIA': 'HBM4 Muster an NVIDIA',
    'NVIDIA Q4 FY25 Earnings': 'NVIDIA Q4 FY25 Ergebnis',
    'HBM4 Mass Production': 'HBM4 Massenproduktion',
    'Fed Rate Cut': 'Fed Zinssenkung',
    'HBM4E Announcement': 'HBM4E Ankündigung',
    'Fed 50bps Rate Cut': 'Fed 50Bp Zinssenkung',
    'FOMC Hold + Inflation Data': 'FOMC Pause + Inflationsdaten',
  },
  fr: {
    'NVIDIA Q4 Earnings Beat': 'NVIDIA T4 résultats supérieurs',
    'HBM3E Mass Production': 'Production en série HBM3E',
    'NVIDIA Q2 Earnings': 'NVIDIA T2 résultats',
    'HBM4 Samples to NVIDIA': 'Échantillons HBM4 à NVIDIA',
    'NVIDIA Q4 FY25 Earnings': 'NVIDIA T4 FY25 résultats',
    'HBM4 Mass Production': 'Production en série HBM4',
    'Fed Rate Cut': 'Baisse des taux Fed',
    'HBM4E Announcement': 'Annonce HBM4E',
    'Fed 50bps Rate Cut': 'Baisse Fed 50pb',
  },
  it: {
    'NVIDIA Q4 Earnings Beat': 'NVIDIA Q4 utili sopra le attese',
    'HBM3E Mass Production': 'Produzione di massa HBM3E',
    'NVIDIA Q2 Earnings': 'NVIDIA Q2 risultati',
    'HBM4 Samples to NVIDIA': 'Campioni HBM4 a NVIDIA',
    'NVIDIA Q4 FY25 Earnings': 'NVIDIA Q4 FY25 risultati',
    'HBM4 Mass Production': 'Produzione di massa HBM4',
    'Fed Rate Cut': 'Taglio tassi Fed',
    'HBM4E Announcement': 'Annuncio HBM4E',
    'Fed 50bps Rate Cut': 'Taglio Fed 50pb',
  },
};

type TimeRange = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'Max';
const timeRanges: TimeRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns chart data filtered to the selected time range.
 * Cutoff dates are computed dynamically from the current date
 * so the chart doesn't freeze at a hardcoded point in time.
 */
function filterMonthlyByRange(data: ChartDataPoint[], range: TimeRange) {
  if (range === 'Max') return data;
  const now = new Date();
  const cutoffs: Record<string, Date> = {
    '5Y': new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()),
    '1Y': new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
    'YTD': new Date(now.getFullYear(), 0, 1),
    '6M': new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()),
  };
  const cutoff = cutoffs[range];
  if (!cutoff) return data;
  return data.filter(d => new Date(d.date + '-01') >= cutoff);
}

function getFallbackData(range: TimeRange): ChartDataPoint[] {
  switch (range) {
    case '1D': return skHynixIntradayData;
    case '5D': return skHynix5DayData;
    case '1M': return skHynixDailyData.slice(-22);
    case '6M': return skHynixDailyData;
    case 'YTD': return skHynixDailyData;
    default:   return filterMonthlyByRange(skHynixChartData, range);
  }
}

function formatYAxis(value: number, locale: Locale, isKRW: boolean): string {
  if (isKRW) {
    if (locale === 'ko') return `${(value / 10000).toFixed(1)}만`;
    return `₩${(value / 1000).toFixed(0)}K`;
  }
  const currency = getCurrencyInfo(locale);
  if (value >= 1000) return `${currency.symbol}${(value / 1000).toFixed(1)}K`;
  return `${currency.symbol}${value.toFixed(0)}`;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label, locale, currencySymbol }: any) => {
  if (!active || !payload?.length) return null;
  const event = skHynixEvents.find((e) => e.date === label);
  const tLabel = event ? (eventTranslations[locale as Locale]?.[event.label] || event.label) : null;
  return (
    <div className="glass-card px-3 py-2 text-xs" style={{ backdropFilter: 'blur(20px)' }}>
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="num text-foreground text-sm">
        {currencySymbol}{payload[0].value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </p>
      {payload.find((p: any) => p.dataKey === 'ma50') && (
        <p className="text-[10px] text-warning">MA50: {payload.find((p: any) => p.dataKey === 'ma50')?.value?.toFixed(2)}</p>
      )}
      {payload.find((p: any) => p.dataKey === 'ma200') && (
        <p className="text-[10px] text-muted-foreground">MA200: {payload.find((p: any) => p.dataKey === 'ma200')?.value?.toFixed(2)}</p>
      )}
      {event && tLabel && (
        <p className="mt-1 text-accent text-[10px] font-medium">{tLabel}</p>
      )}
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

const StockChart = () => {
  const { t, locale } = useLanguage();
  const { stock } = useStock();
  const [range, setRange] = useState<TimeRange>('Max');
  const [liveQuote, setLiveQuote] = useState<StockQuote | null>(null);
  const [liveChartData, setLiveChartData] = useState<ChartDataPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fxRate, setFxRate] = useState<number | null>(null);

  const [showMA, setShowMA] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const isDefaultStock = stock.symbol === '000660.KOR';
  const s = skHynixStats;
  const currency = getCurrencyInfo(locale);
  const isKRW = currency.rate === 1;

  // Time range button labels sourced from t to avoid local duplication
  const rangeLabels: Record<TimeRange, string> = {
    '1D': t.range1D, '5D': t.range5D, '1M': t.range1M, '6M': t.range6M,
    'YTD': t.rangeYTD, '1Y': t.range1Y, '5Y': t.range5Y, 'Max': t.rangeMax,
  };

  // Event type labels sourced from t
  const eventLabelMap: Record<string, string> = {
    earnings: t.eventEarnings,
    product: t.eventProduct,
    macro: t.eventMacro,
  };

  useEffect(() => {
    if (isDefaultStock) { setFxRate(null); return; }
    const stockCcy = stock.currency || 'USD';
    if (stockCcy === currency.code) { setFxRate(1); return; }
    let cancelled = false;
    fetchFxRate(stockCcy, currency.code).then(rate => {
      if (!cancelled) setFxRate(rate);
    });
    return () => { cancelled = true; };
  }, [stock.symbol, stock.currency, currency.code, isDefaultStock]);

  useEffect(() => {
    if (isDefaultStock) { setLiveQuote(null); setLiveChartData(null); return; }
    let cancelled = false;
    fetchQuote(stock.symbol).then(q => {
      if (!cancelled) setLiveQuote(q);
    });
    return () => { cancelled = true; };
  }, [stock.symbol, isDefaultStock]);

  useEffect(() => {
    if (isDefaultStock) { setLiveChartData(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchStockHistory(stock.symbol, range).then(data => {
      if (!cancelled) { setLiveChartData(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [stock.symbol, range, isDefaultStock]);

  const fxMultiplier = (!isDefaultStock && fxRate && fxRate !== 1) ? fxRate : 1;
  const showConverted = !isDefaultStock && fxRate !== null && fxRate !== 1;

  const rawPrice = liveQuote ? liveQuote.price : s.price;
  const rawChange = liveQuote ? liveQuote.change : s.change;
  const displayPrice = isDefaultStock ? rawPrice : rawPrice * fxMultiplier;
  const displayChange = isDefaultStock ? rawChange : rawChange * fxMultiplier;
  const displayChangePercent = liveQuote ? liveQuote.changePercent : s.changePercent;
  const displayVolume = liveQuote ? liveQuote.volume : s.volume;
  const isPositive = displayChangePercent >= 0;

  const rawChartData = useMemo(() => {
    const raw = liveChartData || getFallbackData(range);
    if (isDefaultStock) {
      if (isKRW) return raw;
      return raw.map(d => ({ ...d, price: parseFloat((d.price / currency.rate).toFixed(2)) }));
    }
    if (fxMultiplier !== 1) {
      return raw.map(d => ({ ...d, price: parseFloat((d.price * fxMultiplier).toFixed(2)) }));
    }
    return raw;
  }, [range, currency.rate, isKRW, liveChartData, isDefaultStock, fxMultiplier]);

  const chartData = useMemo(() => {
    if (!showMA && !showRSI && !showMACD) return rawChartData;
    return calculateIndicators(rawChartData, { ma50: showMA, ma200: showMA, rsi: showRSI, macd: showMACD });
  }, [rawChartData, showMA, showRSI, showMACD]);

  const stockName = isDefaultStock ? t.skHynixName : stock.name;
  const stockTicker = isDefaultStock ? s.ticker : stock.symbol;
  const currSymbol = isDefaultStock ? currency.symbol : (showConverted ? currency.symbol : (stock.currency === 'KRW' ? '₩' : '$'));

  const priceDisplay = isDefaultStock
    ? formatPrice(displayPrice, locale)
    : `${currSymbol}${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const changeDisplay = isDefaultStock
    ? (isKRW
        ? `${isPositive ? '+' : ''}${displayChange.toLocaleString()}`
        : `${isPositive ? '+' : ''}${(displayChange / currency.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    : `${isPositive ? '+' : ''}${displayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const stats = isDefaultStock ? [
    { label: t.mktCap, value: formatMarketCap(s.marketCapKRW, locale) },
    { label: t.pe, value: s.pe.toFixed(1) },
    { label: t.high52w, value: formatPrice(s.high52w, locale) },
    { label: t.low52w, value: formatPrice(s.low52w, locale) },
    { label: t.vol, value: displayVolume },
  ] : [
    { label: t.vol, value: displayVolume },
    ...(liveQuote ? [
      { label: 'Open', value: liveQuote.open.toFixed(2) },
      { label: 'High', value: liveQuote.high.toFixed(2) },
      { label: 'Low', value: liveQuote.low.toFixed(2) },
    ] : []),
  ];

  const showEvents = isDefaultStock && !['1D', '5D'].includes(range);
  const showIndicatorToggles = ['1M', '6M', '1Y', 'YTD', '5Y', 'Max'].includes(range);

  return (
    <div className="glass-card p-6 fade-transition col-span-full xl:col-span-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">{stockName}</h3>
            <span className="text-[10px] num text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{stockTicker}</span>
            {!isDefaultStock && (
              <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded font-medium">LIVE</span>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl num text-foreground text-glass-shadow">{priceDisplay}</span>
            <span className={`flex items-center gap-1 text-sm num ${isPositive ? 'ticker-positive' : 'ticker-negative'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {changeDisplay} ({isPositive ? '+' : ''}{displayChangePercent.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="flex gap-6 text-xs">
          {stats.map((stat) => (
            <div key={stat.label} className="hidden sm:block">
              <p className="text-muted-foreground">{stat.label}</p>
              <p className="num text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Time Range Selector + Indicator Toggles */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex gap-1">
          {timeRanges.map((tr) => (
            <motion.button
              key={tr}
              onClick={() => setRange(tr)}
              className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                range === tr
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {rangeLabels[tr]}
            </motion.button>
          ))}
        </div>

        {showIndicatorToggles && (
          <div className="flex items-center gap-3 text-[10px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch checked={showMA} onCheckedChange={setShowMA} className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-3" />
              <span className="text-muted-foreground font-medium">MA</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch checked={showRSI} onCheckedChange={setShowRSI} className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-3" />
              <span className="text-muted-foreground font-medium">RSI</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch checked={showMACD} onCheckedChange={setShowMACD} className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-3" />
              <span className="text-muted-foreground font-medium">MACD</span>
            </label>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className={`-mx-2 relative ${showRSI || showMACD ? 'h-[420px]' : 'h-[320px]'}`}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader2 className="w-6 h-6 text-accent animate-spin" />
          </div>
        )}

        <div className={showRSI || showMACD ? 'h-[65%]' : 'h-full'}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="skGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(214, 100%, 50%)" stopOpacity={0.35} />
                  <stop offset="40%" stopColor="hsl(214, 100%, 60%)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="hsl(214, 100%, 70%)" stopOpacity={0} />
                </linearGradient>
                <filter id="neonGlow">
                  <feGaussianBlur stdDeviation="4" result="blur1" />
                  <feFlood floodColor="hsl(214, 100%, 55%)" floodOpacity="0.6" result="color" />
                  <feComposite in="color" in2="blur1" operator="in" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 50%)" strokeOpacity={0.2} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false} axisLine={false}
                interval={Math.max(1, Math.floor(chartData.length / 8))}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false} axisLine={false}
                tickFormatter={(v) => isDefaultStock ? formatYAxis(v, locale, isKRW) : `$${v.toFixed(0)}`}
                domain={['auto', 'auto']} width={65} yAxisId="price"
              />
              <Tooltip content={<CustomTooltip locale={locale} currencySymbol={currSymbol} />} />
              <Area
                type="monotone" dataKey="price" stroke="hsl(214, 100%, 55%)" strokeWidth={3}
                fill="url(#skGlow)" filter="url(#neonGlow)" dot={false} yAxisId="price"
                activeDot={{ r: 6, stroke: 'hsl(214, 100%, 55%)', strokeWidth: 3, fill: 'white', style: { filter: 'drop-shadow(0 0 8px hsla(214, 100%, 55%, 0.5))' } }}
              />
              {showMA && (
                <>
                  <Line type="monotone" dataKey="ma50" stroke="hsl(38, 92%, 50%)" strokeWidth={1.5} dot={false} yAxisId="price" strokeDasharray="4 2" connectNulls />
                  <Line type="monotone" dataKey="ma200" stroke="hsl(280, 70%, 60%)" strokeWidth={1.5} dot={false} yAxisId="price" strokeDasharray="6 3" connectNulls />
                </>
              )}
              {showEvents && skHynixEvents.map((event) => {
                const dataPoint = chartData.find((d) => d.date === event.date);
                if (!dataPoint) return null;
                return (
                  <ReferenceDot
                    key={event.date + event.label}
                    x={event.date} y={dataPoint.price} r={6}
                    fill={eventColors[event.type]} stroke="white" strokeWidth={2.5} yAxisId="price"
                    style={{ cursor: 'pointer', filter: `drop-shadow(0 0 6px ${eventColors[event.type]})` }}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {showRSI && (
          <div className="h-[17%] border-t border-border/30">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 10, left: 10, bottom: 0 }}>
                <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={65} ticks={[30, 70]} />
                <XAxis dataKey="date" hide />
                <Line type="monotone" dataKey="rsi" stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="absolute right-3 text-[8px] text-muted-foreground font-mono" style={{ top: '67%' }}>RSI</div>
          </div>
        )}

        {showMACD && (
          <div className="h-[18%] border-t border-border/30">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 10, left: 10, bottom: 0 }}>
                <YAxis tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={65} />
                <XAxis dataKey="date" hide />
                <Bar dataKey="macdHist" fill="hsl(var(--accent))" opacity={0.4} />
                <Line type="monotone" dataKey="macdLine" stroke="hsl(214, 100%, 55%)" strokeWidth={1} dot={false} connectNulls />
                <Line type="monotone" dataKey="macdSignal" stroke="hsl(38, 92%, 50%)" strokeWidth={1} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="absolute right-3 text-[8px] text-muted-foreground font-mono" style={{ bottom: '2%' }}>MACD</div>
          </div>
        )}
      </div>

      {showMA && (
        <div className="flex gap-4 mt-2 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning inline-block" /> MA50</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: 'hsl(280, 70%, 60%)' }} /> MA200</span>
        </div>
      )}

      {showEvents && (
        <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-border">
          {skHynixEvents.filter(e => chartData.some(d => d.date === e.date)).slice(-4).map((event) => (
            <div key={event.date} className="flex items-center gap-1.5 text-[10px]">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: eventColors[event.type], boxShadow: `0 0 6px ${eventColors[event.type]}` }}
              />
              <span className="text-muted-foreground">
                {event.date.slice(2)} — {eventTranslations[locale]?.[event.label] || event.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StockChart;
