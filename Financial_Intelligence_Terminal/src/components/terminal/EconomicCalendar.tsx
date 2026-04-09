/**
 * @file EconomicCalendar.tsx
 * @description Upcoming macro events panel with list and grid views.
 *
 * DATA SOURCE — STATIC:
 *   The `upcomingEvents` array below is hand-maintained and represents the
 *   author's curated set of high-impact macro releases for the current month.
 *   This is intentional, not an oversight — see WHAT_IF_NO_LIMITS below for
 *   what a live implementation would look like.
 *
 *   Each event has a date, an English canonical name (used as the lookup key
 *   for translations), a country flag emoji, expected/previous numbers, and
 *   an impact tier (high / medium / low) that drives the badge colour.
 *
 * TRANSLATIONS:
 *   `eventNameTranslations` is keyed first by locale and then by the English
 *   event name. Locales without an entry for a given event fall back to the
 *   English name (see `translateEvent` helper). The Korean, Chinese, and
 *   Japanese tables are complete; the German, French, and Italian tables
 *   only cover the most-watched events to keep the maintenance burden low.
 *
 * VIEW MODES:
 *   - 'list': vertical timeline with full detail per event.
 *   - 'grid': calendar month view with impact dots and a hover tooltip.
 *   The grid view derives its cell layout from `gridCells` (memoised), which
 *   pads the start of the month with nulls to align day-of-week columns.
 */

import { useState, useMemo } from 'react';
import { Calendar, LayoutList, CalendarDays } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/i18n/LanguageContext';

interface EconEvent {
  date: string;
  event: string;
  country: string;
  flag: string;
  expected?: string;
  actual?: string;
  previous?: string;
  impact: 'high' | 'medium' | 'low';
}

const upcomingEvents: EconEvent[] = buildUpcomingEvents();

/**
 * Generates the static event list relative to today's date so the panel
 * never shows a month full of past-dated releases.
 *
 * Each template entry describes a recurring macro release by its typical
 * day-of-month and impact tier. `buildUpcomingEvents` walks the current
 * month and the following month and places each template on the closest
 * matching calendar day, producing an ~4-to-6-week horizon of events from
 * "recent past" to "upcoming".
 *
 * The expected/previous numbers are stable placeholders — a live calendar
 * API would return real consensus forecasts, but for the static fixture
 * we use values that read as plausible rather than going stale (specific
 * numbers get outdated; "Fed Interest Rate Decision" never does).
 *
 * If the current day-of-month is past a template's typical day, the event
 * is placed in the CURRENT month and will show as "recent past" in the
 * list view. If it isn't, the event lands in the current month as upcoming.
 * The same templates are replayed for next month so the user always sees
 * a forward horizon even on the last day of the month.
 */
function buildUpcomingEvents(): EconEvent[] {
  interface Template {
    dayOfMonth: number;
    event: string;
    country: string;
    flag: string;
    expected?: string;
    previous?: string;
    impact: 'high' | 'medium' | 'low';
  }

  // Typical day-of-month for each release. These are approximations — real
  // release days shift week-to-week. Accurate calendaring is exactly the
  // thing a live API would provide; see WHAT_IF_NO_LIMITS below.
  const templates: Template[] = [
    { dayOfMonth: 3,  event: 'ISM Manufacturing PMI',    country: 'US', flag: '🇺🇸', expected: '50.5',  previous: '50.9',  impact: 'medium' },
    { dayOfMonth: 5,  event: 'Fed Interest Rate Decision', country: 'US', flag: '🇺🇸', expected: '4.50%', previous: '4.50%', impact: 'high'   },
    { dayOfMonth: 6,  event: 'ECB Press Conference',     country: 'EU', flag: '🇪🇺', expected: '-',     previous: '-',     impact: 'medium' },
    { dayOfMonth: 7,  event: 'Non-Farm Payrolls',        country: 'US', flag: '🇺🇸', expected: '185K',  previous: '143K',  impact: 'high'   },
    { dayOfMonth: 10, event: 'China CPI (YoY)',          country: 'CN', flag: '🇨🇳', expected: '0.5%',  previous: '0.5%',  impact: 'medium' },
    { dayOfMonth: 12, event: 'US CPI (YoY)',             country: 'US', flag: '🇺🇸', expected: '2.8%',  previous: '2.9%',  impact: 'high'   },
    { dayOfMonth: 13, event: 'UK GDP (MoM)',             country: 'GB', flag: '🇬🇧', expected: '0.2%',  previous: '0.1%',  impact: 'medium' },
    { dayOfMonth: 14, event: 'BOK Rate Decision',        country: 'KR', flag: '🇰🇷', expected: '2.75%', previous: '2.75%', impact: 'high'   },
    { dayOfMonth: 18, event: 'BOJ Rate Decision',        country: 'JP', flag: '🇯🇵', expected: '0.50%', previous: '0.50%', impact: 'high'   },
    { dayOfMonth: 19, event: 'FOMC Minutes Released',    country: 'US', flag: '🇺🇸', expected: '-',     previous: '-',     impact: 'high'   },
    { dayOfMonth: 20, event: 'ECB Rate Decision',        country: 'EU', flag: '🇪🇺', expected: '2.65%', previous: '2.90%', impact: 'high'   },
    { dayOfMonth: 21, event: 'Germany PPI (MoM)',        country: 'DE', flag: '🇩🇪', expected: '0.3%',  previous: '0.2%',  impact: 'low'    },
    { dayOfMonth: 25, event: 'Consumer Confidence',      country: 'US', flag: '🇺🇸', expected: '102.5', previous: '98.3',  impact: 'medium' },
    { dayOfMonth: 27, event: 'France CPI (YoY)',         country: 'FR', flag: '🇫🇷', expected: '1.8%',  previous: '1.7%',  impact: 'medium' },
    { dayOfMonth: 28, event: 'US GDP (QoQ)',             country: 'US', flag: '🇺🇸', expected: '2.3%',  previous: '2.5%',  impact: 'high'   },
    { dayOfMonth: 30, event: 'Italy GDP (QoQ)',          country: 'IT', flag: '🇮🇹', expected: '0.2%',  previous: '0.1%',  impact: 'medium' },
  ];

  const now = new Date();
  const events: EconEvent[] = [];

  // Replay templates across current month + next month. We clamp day-of-month
  // to the actual last day of each month so "day 30" in February lands on 28
  // or 29 rather than overflowing into March.
  const buildForMonth = (year: number, month: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (const tpl of templates) {
      const day = Math.min(tpl.dayOfMonth, lastDay);
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      events.push({
        date,
        event: tpl.event,
        country: tpl.country,
        flag: tpl.flag,
        expected: tpl.expected,
        previous: tpl.previous,
        impact: tpl.impact,
      });
    }
  };

  buildForMonth(now.getFullYear(), now.getMonth());
  buildForMonth(
    now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(),
    (now.getMonth() + 1) % 12,
  );

  // Sort chronologically so the list view reads top-to-bottom as a timeline.
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

const eventNameTranslations: Record<string, Record<string, string>> = {
  ko: {
    'ISM Manufacturing PMI': 'ISM 제조업 PMI',
    'Fed Interest Rate Decision': '연준 금리 결정',
    'ECB Press Conference': 'ECB 기자회견',
    'Non-Farm Payrolls': '비농업 고용지수',
    'China CPI (YoY)': '중국 CPI (전년비)',
    'US CPI (YoY)': '미국 CPI (전년비)',
    'UK GDP (MoM)': '영국 GDP (전월비)',
    'BOK Rate Decision': '한국은행 금리 결정',
    'BOJ Rate Decision': '일본은행 금리 결정',
    'FOMC Minutes Released': 'FOMC 의사록 공개',
    'ECB Rate Decision': 'ECB 금리 결정',
    'Germany PPI (MoM)': '독일 PPI (전월비)',
    'Consumer Confidence': '소비자 신뢰지수',
    'France CPI (YoY)': '프랑스 CPI (전년비)',
    'US GDP (QoQ)': '미국 GDP (전분기비)',
    'Italy GDP (QoQ)': '이탈리아 GDP (전분기비)',
  },
  zh: {
    'ISM Manufacturing PMI': 'ISM制造业PMI',
    'Fed Interest Rate Decision': '美联储利率决议',
    'ECB Press Conference': '欧央行新闻发布会',
    'Non-Farm Payrolls': '非农就业数据',
    'China CPI (YoY)': '中国CPI(同比)',
    'US CPI (YoY)': '美国CPI(同比)',
    'UK GDP (MoM)': '英国GDP(环比)',
    'BOK Rate Decision': '韩国央行利率决议',
    'BOJ Rate Decision': '日本央行利率决议',
    'FOMC Minutes Released': 'FOMC会议纪要',
    'ECB Rate Decision': '欧央行利率决议',
    'Germany PPI (MoM)': '德国PPI(环比)',
    'Consumer Confidence': '消费者信心指数',
    'France CPI (YoY)': '法国CPI(同比)',
    'US GDP (QoQ)': '美国GDP(环比)',
    'Italy GDP (QoQ)': '意大利GDP(环比)',
  },
  ja: {
    'ISM Manufacturing PMI': 'ISM製造業PMI',
    'Fed Interest Rate Decision': 'FRB金利決定',
    'ECB Press Conference': 'ECB記者会見',
    'Non-Farm Payrolls': '非農業部門雇用者数',
    'China CPI (YoY)': '中国CPI(前年比)',
    'US CPI (YoY)': '米CPI(前年比)',
    'UK GDP (MoM)': '英GDP(前月比)',
    'BOK Rate Decision': '韓国銀行金利決定',
    'BOJ Rate Decision': '日銀金利決定',
    'FOMC Minutes Released': 'FOMC議事録公表',
    'ECB Rate Decision': 'ECB金利決定',
    'Germany PPI (MoM)': '独PPI(前月比)',
    'Consumer Confidence': '消費者信頼感指数',
    'France CPI (YoY)': '仏CPI(前年比)',
    'US GDP (QoQ)': '米GDP(前期比)',
    'Italy GDP (QoQ)': '伊GDP(前期比)',
  },
  de: {
    'Fed Interest Rate Decision': 'Fed Zinsentscheid',
    'Non-Farm Payrolls': 'Beschäftigte außerhalb der Landwirtschaft',
    'Consumer Confidence': 'Verbrauchervertrauen',
    'US CPI (YoY)': 'US VPI (JüJ)',
    'US GDP (QoQ)': 'US BIP (QüQ)',
    'Germany PPI (MoM)': 'Deutschland EPI (MüM)',
  },
  fr: {
    'Fed Interest Rate Decision': 'Décision taux Fed',
    'Non-Farm Payrolls': 'Emplois non agricoles',
    'Consumer Confidence': 'Confiance des consommateurs',
    'France CPI (YoY)': 'IPC France (A/A)',
    'US GDP (QoQ)': 'PIB US (T/T)',
  },
  it: {
    'Fed Interest Rate Decision': 'Decisione tassi Fed',
    'Non-Farm Payrolls': 'Occupati non agricoli',
    'Consumer Confidence': 'Fiducia consumatori',
    'Italy GDP (QoQ)': 'PIL Italia (T/T)',
    'US GDP (QoQ)': 'PIL USA (T/T)',
  },
};

const dayNames: Record<string, string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  gb: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  fr: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
  it: ['D', 'L', 'M', 'M', 'G', 'V', 'S'],
};

const impactColors: Record<string, string> = {
  high: 'bg-destructive',
  medium: 'bg-warning',
  low: 'bg-muted-foreground',
};

type ViewMode = 'list' | 'grid';

const translateEvent = (name: string, locale: string): string =>
  eventNameTranslations[locale]?.[name] ?? name;

const EconomicCalendar = () => {
  const { locale, t } = useLanguage();
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Dynamic: always use current month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US';
    return {
      month: d.toLocaleDateString(intlLocale, { month: 'short' }),
      day: d.getDate(),
    };
  };

  const gridCells = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  const getEventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return upcomingEvents.filter(e => e.date === dateStr);
  };

  const monthLabel = new Date(year, month, 1).toLocaleDateString(
    locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : locale === 'zh' ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: 'long' }
  );

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
          {t.calendarTitle}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-label="List view"
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-label="Grid view"
          >
            <CalendarDays className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <ScrollArea className="h-[280px]">
        {viewMode === 'list' ? (
          <div className="relative">
            <div className="absolute left-[22px] top-0 bottom-0 w-px bg-border/50" />
            <div className="space-y-0.5">
              {upcomingEvents.map((evt, i) => {
                const { month: mo, day } = formatDate(evt.date);
                const isPast = new Date(evt.date) < now;
                return (
                  <div
                    key={i}
                    className={`glass-hover relative flex gap-3 py-2.5 px-1 rounded-lg ${isPast ? 'opacity-50' : ''}`}
                  >
                    <div className="flex flex-col items-center w-[44px] shrink-0 z-10">
                      <span className="text-[9px] uppercase text-muted-foreground font-medium">{mo}</span>
                      <span className="text-sm num text-foreground font-semibold">{day}</span>
                    </div>
                    <div className="flex items-center">
                      <div className={`w-2 h-2 rounded-full ${impactColors[evt.impact]} shrink-0`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{evt.flag}</span>
                        <p className="text-xs text-foreground font-medium truncate">
                          {translateEvent(evt.event, locale)}
                        </p>
                      </div>
                      <div className="flex gap-3 mt-1 text-[10px]">
                        <span className="text-muted-foreground">
                          {t.calendarExpected}: <span className="num text-foreground">{evt.expected || '-'}</span>
                        </span>
                        {evt.actual && (
                          <span className="text-muted-foreground">
                            {t.calendarActual}: <span className="num ticker-positive">{evt.actual}</span>
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {t.calendarPrevious}: <span className="num text-muted-foreground">{evt.previous || '-'}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs text-center text-muted-foreground mb-2 font-medium">{monthLabel}</p>
            <div className="grid grid-cols-7 gap-px text-center text-[9px] text-muted-foreground mb-1">
              {(dayNames[locale] ?? dayNames.en).map((d, i) => (
                <span key={i} className="py-1 font-medium">{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {gridCells.map((day, i) => {
                if (day === null) return <div key={i} className="h-9" />;
                const events = getEventsForDay(day);
                const isToday =
                  day === now.getDate() &&
                  now.getMonth() === month &&
                  now.getFullYear() === year;
                return (
                  <div
                    key={i}
                    className={`h-9 flex flex-col items-center justify-center rounded relative group cursor-default transition-colors hover:bg-muted/40 ${isToday ? 'bg-accent/10 ring-1 ring-accent/30' : ''}`}
                  >
                    <span className={`text-[10px] num ${isToday ? 'text-accent font-bold' : 'text-foreground'}`}>
                      {day}
                    </span>
                    {events.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5">
                        {events.slice(0, 3).map((e, j) => (
                          <div key={j} className={`w-1 h-1 rounded-full ${impactColors[e.impact]}`} />
                        ))}
                      </div>
                    )}
                    {events.length > 0 && (
                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-50 w-40">
                        <div className="glass-card p-2 text-[9px] space-y-1 shadow-lg">
                          {events.map((e, j) => (
                            <div key={j} className="flex items-center gap-1">
                              <div className={`w-1.5 h-1.5 rounded-full ${impactColors[e.impact]} shrink-0`} />
                              <span className="text-foreground truncate">
                                {e.flag} {translateEvent(e.event, locale)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default EconomicCalendar;

/**
 * WHAT_IF_NO_LIMITS — live economic calendar
 *
 * The current implementation uses `buildUpcomingEvents()` to synthesise a
 * rolling 4-to-6-week event horizon from a hand-maintained template list.
 * It's honest and it never goes stale, but the release days are only
 * approximate (US CPI isn't always on the 12th) and the expected/previous
 * numbers are stable placeholders, not real consensus forecasts.
 *
 * Every economic-calendar API with reliable global coverage is paid:
 *
 *   - Trading Economics: free tier covers ~5 countries and is rate-limited
 *     to 1 request/second. Paid tier ($75+/mo) unlocks all countries plus
 *     consensus forecasts.
 *   - FRED (St. Louis Fed): free, but US-only and structured as data series
 *     rather than a unified calendar — would need post-processing to
 *     reconstruct the "upcoming releases" view.
 *   - Investing.com / Forex Factory: scraping their pages is against ToS.
 *
 * With a Trading Economics subscription (or equivalent), the implementation
 * would look like this:
 *
 * ```ts
 * // marketDataService.ts additions
 * export interface CalendarEvent {
 *   date: string;          // ISO 8601
 *   event: string;         // localised event name, e.g. "US CPI (YoY)"
 *   country: string;       // ISO 3166-1 alpha-2
 *   flag: string;          // emoji flag
 *   expected: string | null;
 *   actual: string | null; // non-null once the release has printed
 *   previous: string | null;
 *   impact: 'high' | 'medium' | 'low';
 * }
 *
 * export async function fetchCalendar(
 *   from: string,
 *   to: string,
 *   locale: Locale,
 * ): Promise<CalendarEvent[]> {
 *   const cacheKey = `calendar:${from}:${to}:${locale}`;
 *   const cached = getCache<CalendarEvent[]>(cacheKey, TTL.calendar);
 *   if (cached) return cached;
 *
 *   // Edge Function proxies to Trading Economics and normalises the response
 *   // shape into our CalendarEvent interface. The `lang` parameter maps our
 *   // Locale enum to Trading Economics' supported languages; unsupported
 *   // locales fall back to English on the server.
 *   const data = await callEdge({
 *     action: 'calendar',
 *     from,
 *     to,
 *     lang: locale,
 *   });
 *
 *   setCache(cacheKey, data.events);
 *   return data.events;
 * }
 * ```
 *
 * ```ts
 * // EconomicCalendar.tsx rewrite
 * import { useQuery } from '@tanstack/react-query';
 * import { fetchCalendar } from '@/services/marketDataService';
 *
 * const EconomicCalendar = () => {
 *   const { locale, t } = useLanguage();
 *   const [viewMode, setViewMode] = useState<ViewMode>('list');
 *   const [monthOffset, setMonthOffset] = useState(0); // 0 = current, +1 = next
 *
 *   // Compute the ISO date range for the month being viewed.
 *   const { from, to, year, month } = useMemo(() => {
 *     const base = new Date();
 *     base.setMonth(base.getMonth() + monthOffset);
 *     const year = base.getFullYear();
 *     const month = base.getMonth();
 *     const firstDay = new Date(year, month, 1);
 *     const lastDay  = new Date(year, month + 1, 0);
 *     return {
 *       from: firstDay.toISOString().slice(0, 10),
 *       to:   lastDay.toISOString().slice(0, 10),
 *       year,
 *       month,
 *     };
 *   }, [monthOffset]);
 *
 *   // Background-refetched, de-duplicated, cached for 6 hours because
 *   // calendar updates are slow (consensus forecasts shift daily at most).
 *   const { data: events = [], isLoading } = useQuery({
 *     queryKey: ['calendar', from, to, locale],
 *     queryFn:  () => fetchCalendar(from, to, locale),
 *     staleTime: 6 * 60 * 60_000,
 *   });
 *
 *   // Grid cells unchanged — still derived from year/month alone.
 *   const gridCells = useMemo(() => {
 *     const firstDay = new Date(year, month, 1).getDay();
 *     const daysInMonth = new Date(year, month + 1, 0).getDate();
 *     const cells: (number | null)[] = [];
 *     for (let i = 0; i < firstDay; i++) cells.push(null);
 *     for (let d = 1; d <= daysInMonth; d++) cells.push(d);
 *     while (cells.length % 7 !== 0) cells.push(null);
 *     return cells;
 *   }, [year, month]);
 *
 *   const getEventsForDay = (day: number) => {
 *     const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
 *     return events.filter(e => e.date === dateStr);
 *   };
 *
 *   // ... rest of the render is unchanged, except:
 *   //   - translateEvent() and eventNameTranslations go away — Trading
 *   //     Economics returns localised names directly via the lang param
 *   //   - the list view gets a "Next 7 days" quick filter button
 *   //   - the grid view gains prev/next month arrows wired to setMonthOffset
 * };
 * ```
 *
 * Migration path from the current static version:
 *   1. Deploy the new Edge Function action `market-data?action=calendar`
 *      with a Trading Economics API key in Supabase secrets.
 *   2. Add `fetchCalendar` to marketDataService.ts (behind `callEdge`).
 *   3. Swap this component to use `useQuery` as shown above.
 *   4. Delete `buildUpcomingEvents()` and the templates array (~70 lines).
 *   5. Delete `eventNameTranslations` (~130 lines) — the server returns
 *      localised names via the `lang` param.
 *   6. Add month navigation UI (prev/next arrows) which the static version
 *      didn't need because everything lived in one synthesised window.
 *
 * Net result: ~200 lines deleted, ~40 lines added, and the panel becomes
 * a live calendar with real consensus numbers and accurate release days
 * instead of a best-effort approximation.
 */
