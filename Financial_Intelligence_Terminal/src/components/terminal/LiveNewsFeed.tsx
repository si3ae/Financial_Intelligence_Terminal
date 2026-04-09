/**
 * @file LiveNewsFeed.tsx
 * @description Live news feed scoped to the currently selected stock or locale.
 *
 * DATA SOURCE: fetchNews() from marketDataService.ts, routed through the
 * Supabase Edge Function `market-data?action=news` to keep the NewsAPI key
 * server-side. Re-fetches on stock or locale change.
 *
 * SENTIMENT TAGS:
 *   Each headline is classified as bullish / bearish / neutral by the
 *   rule-based keyword engine in sentimentAnalysis.ts. This is a display-only
 *   feature — the classification has no effect on data fetching or filtering.
 *   See sentimentAnalysis.ts for accuracy notes and upgrade path to real NLP.
 *
 * QUERY LOGIC:
 *   - Default stock (SK hynix, 000660.KOR): uses a locale-specific market query
 *     (e.g. "Korea KOSPI stock" for ko) to show broad market news.
 *   - Any other stock: uses the stock name directly as the search query so
 *     the feed is scoped to that company.
 *
 * LOADING STATES:
 *   Shimmer placeholders during fetch; empty state with icon if no articles.
 *   No error state shown to the user — fetchNews() handles retries internally
 *   and returns [] on failure rather than throwing.
 */
import { useState, useEffect } from 'react';
import { ExternalLink, Newspaper } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/i18n/LanguageContext';
import { useStock } from '@/hooks/useStockContext';
import { fetchNews, type NewsArticle } from '@/services/marketDataService';
import { getSentiment, sentimentStyles, sentimentLabel } from '@/lib/sentimentAnalysis';
import { motion, AnimatePresence } from 'framer-motion';

const localeToIntl: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP',
  gb: 'en-GB', de: 'de-DE', fr: 'fr-FR', it: 'it-IT',
};

// Fallback queries for the default SK hynix view — shows broad market news
// scoped to the user's locale region rather than a single stock name.
const countryQueries: Record<string, string> = {
  ko: 'Korea KOSPI stock',
  en: 'S&P500 NASDAQ stock',
  zh: 'China Shanghai stock',
  ja: 'Japan Nikkei stock',
  gb: 'FTSE London stock',
  de: 'DAX Germany stock',
  fr: 'CAC40 France stock',
  it: 'FTSE MIB Italy stock',
};

function formatNewsTime(isoStr: string, locale: string): string {
  const intlLocale = localeToIntl[locale] || 'en-US';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

const fast = { duration: 0.15, ease: 'easeOut' as const };

const LiveNewsFeed = () => {
  const { t, locale } = useLanguage();
  const { stock } = useStock();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const query = stock.symbol === '000660.KOR'
      ? (countryQueries[locale] || 'stock market')
      : stock.name;

    fetchNews(query, locale).then(data => {
      if (!cancelled) {
        const localized = data.map(a => ({
          ...a,
          time: formatNewsTime(a.time, locale),
        }));
        setArticles(localized);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [stock.symbol, stock.name, locale]);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
          {t.newsFeed}
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <div className="live-indicator" />
          <span>Live</span>
        </div>
      </div>

      <ScrollArea className="h-[280px]">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="py-2.5 px-2">
                <div className="shimmer h-3 w-full mb-2" />
                <div className="shimmer h-3 w-2/3 mb-1" />
                <div className="shimmer h-2 w-1/4" />
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs">
            <Newspaper className="w-8 h-8 mb-2 opacity-40" />
            <p>{t.newsUnavailable}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence>
              {articles.map((article, i) => {
                // Classify headline sentiment for the badge
                const sentiment = getSentiment(article.headline);

                return (
                  <motion.a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-2.5 border-b border-border/30 last:border-0 px-2 -mx-2 rounded-lg group"
                    whileHover={{ scale: 1.01, backgroundColor: 'hsla(var(--glass-bg), 0.6)' }}
                    transition={fast}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] num text-muted-foreground shrink-0 mt-0.5">
                        {article.time}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground leading-relaxed line-clamp-2 group-hover:text-accent transition-colors">
                          {article.headline}
                        </p>
                        {/* Source + sentiment badge row */}
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {article.source}
                            <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </p>
                          {/* Sentiment badge — rule-based keyword classification */}
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${sentimentStyles[sentiment]}`}>
                            {sentimentLabel[sentiment]}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.a>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default LiveNewsFeed;
