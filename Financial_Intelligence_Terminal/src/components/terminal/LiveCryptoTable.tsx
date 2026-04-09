/**
 * LiveCryptoTable — Real-time crypto prices from CoinGecko with spring hover
 */
import { useState, useEffect } from 'react';
import { type MarketItem } from '@/data/marketData';
import { fetchCryptoLive, cryptoData } from '@/services/marketDataService';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateAsset } from '@/i18n/assetNames';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const fast = { duration: 0.15, ease: 'easeOut' as const };

const LiveCryptoTable = () => {
  const { locale, t } = useLanguage();
  const [data, setData] = useState<MarketItem[]>(cryptoData);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const live = await fetchCryptoLive();
      if (!cancelled && live.length > 0) { setData(live); setLoading(false); }
    };
    load();
    const interval = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="glass-card p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-5">{t.digitalAssets}</h3>
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div><div className="shimmer h-4 w-24 mb-1" /><div className="shimmer h-3 w-12" /></div>
              <div className="text-right"><div className="shimmer h-4 w-20 mb-1 ml-auto" /><div className="shimmer h-3 w-14 ml-auto" /></div>
            </div>
          ))
        ) : (
          <AnimatePresence>
            {data.map((item) => (
              <motion.div
                key={item.ticker}
                className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg border-b border-border/50 last:border-0 cursor-default"
                whileHover={{ scale: 1.01, backgroundColor: 'hsla(var(--glass-bg), 0.6)' }}
                transition={fast}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{translateAsset(locale, item.name)}</p>
                  <p className="text-xs text-muted-foreground font-mono">{item.ticker}</p>
                </div>
                <div className="text-right ml-4">
                  <p className="text-sm num col-value text-foreground">{item.price}</p>
                  <div className={`flex items-center justify-end gap-1 text-xs num col-change ${item.changePercent >= 0 ? 'ticker-positive' : 'ticker-negative'}`}>
                    {item.changePercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    <span>{item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default LiveCryptoTable;
