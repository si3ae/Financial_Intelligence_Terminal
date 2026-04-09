import LanguageSelector from '@/components/LanguageSelector';
import StockSearch from '@/components/terminal/StockSearch';
import ThemeToggle from '@/components/terminal/ThemeToggle';
import { useLanguage } from '@/i18n/LanguageContext';
import { useStock } from '@/hooks/useStockContext';
import { Activity } from 'lucide-react';
import { type Locale } from '@/i18n/translations';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const formatDateTime = (locale: Locale): { dateStr: string; timeStr: string } => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  const timeStr = `${h}:${m}`;

  switch (locale) {
    case 'ko':
      return { dateStr: `${now.getFullYear()}년 ${pad(now.getMonth() + 1)}월 ${pad(now.getDate())}일`, timeStr };
    case 'ja':
    case 'zh':
      return { dateStr: `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日`, timeStr };
    case 'de':
    case 'fr':
    case 'it':
      return { dateStr: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`, timeStr };
    default: {
      const engDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const engTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return { dateStr: engDate, timeStr: engTime };
    }
  }
};

const fastTransition = { duration: 0.15, ease: 'easeOut' as const };

const TerminalHeader = () => {
  const { t, locale } = useLanguage();
  const { stock } = useStock();
  const [now, setNow] = useState(() => formatDateTime(locale));

  useEffect(() => {
    const id = setInterval(() => setNow(formatDateTime(locale)), 30_000);
    setNow(formatDateTime(locale));
    return () => clearInterval(id);
  }, [locale]);

  return (
    <motion.header
      className="glass-card px-6 py-4 mb-6"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={fastTransition}
    >
      {/* Row 1: Logo + Title | Date/Time */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground tracking-tight leading-tight truncate">{t.title}</h1>
            <p className="text-[10px] text-muted-foreground truncate">
              {stock.symbol !== '000660.KOR' ? `${stock.name} (${stock.symbol})` : t.subtitle}
            </p>
          </div>
        </div>

        {/* Date/Time — top right */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
          <div className="live-indicator" />
          <span className="font-mono num">{now.dateStr} · {now.timeStr}</span>
        </div>
      </div>

      {/* Row 2: Search | Language | Theme — single horizontal line */}
      <div className="flex items-center gap-3 border-t border-border/40 pt-3">
        <StockSearch />
        <div className="flex-1" />
        <LanguageSelector />
        <div className="h-5 w-px bg-border shrink-0" />
        <ThemeToggle />
      </div>
    </motion.header>
  );
};

export default TerminalHeader;
