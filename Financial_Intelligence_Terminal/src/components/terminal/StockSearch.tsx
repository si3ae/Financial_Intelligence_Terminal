/**
 * @file StockSearch.tsx
 * @description Header search bar with debounced autocomplete.
 *
 * RACE-CONDITION HANDLING:
 *   The 350 ms debounce prevents firing one request per keystroke, but it
 *   does not guarantee request ordering: if "ap" takes 800 ms to come back
 *   and "apple" takes 200 ms, the user types "apple", sees the right
 *   results, and then watches them get overwritten by stale "ap" results
 *   600 ms later.
 *
 *   We guard against this with a per-call request id. Each invocation of
 *   `doSearch` increments `latestRequestId.current` and captures the value
 *   locally; when the response arrives, it only commits to state if its
 *   captured id still matches the latest. Older responses are silently
 *   discarded.
 *
 *   AbortController would be the textbook fix, but it requires plumbing the
 *   signal through `searchSymbol → callEdge → fetch`, which would touch the
 *   service layer. The request-id approach gives the same user-visible
 *   guarantee with a one-line change here.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { searchSymbol, type SearchResult } from '@/services/marketDataService';
import { useStock } from '@/hooks/useStockContext';
import { useLanguage } from '@/i18n/LanguageContext';

const StockSearch = () => {
  const { setStock } = useStock();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Monotonically increasing id stamped on every doSearch invocation. Used
  // to discard responses that arrive out of order. See file header.
  const latestRequestId = useRef(0);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return; }
    // Stamp this request and capture the id locally so the response handler
    // can compare against the latest issued id at resolution time.
    const myId = ++latestRequestId.current;
    setLoading(true);
    try {
      const r = await searchSymbol(q);
      // If a newer request has been issued while we were awaiting, drop this
      // response on the floor — its results are stale by definition.
      if (myId !== latestRequestId.current) return;
      setResults(r.slice(0, 8));
      setSelectedIdx(-1);
    } finally {
      // Only clear the loading flag if this is still the latest request,
      // otherwise we'd hide the spinner while a newer request is in flight.
      if (myId === latestRequestId.current) setLoading(false);
    }
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    setIsOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 350);
  };

  const selectResult = (r: SearchResult) => {
    setStock({ symbol: r.symbol, name: r.name, currency: r.currency, region: r.region });
    setQuery('');
    setIsOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedIdx >= 0 && results[selectedIdx]) {
      selectResult(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full max-w-xs">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t.searchPlaceholder}
          className="w-full pl-9 pr-8 py-2 text-xs rounded-lg bg-background/60 backdrop-blur-md border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono transition-colors"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
        )}
        {!loading && query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setIsOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute top-full mt-1 w-full z-50 glass-card p-1 max-h-64 overflow-y-auto shadow-xl">
          {results.map((r, i) => (
            <button
              key={r.symbol}
              onClick={() => selectResult(r)}
              className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                i === selectedIdx ? 'bg-accent/10 text-accent' : 'hover:bg-muted/50 text-foreground'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="font-mono font-semibold">{r.symbol}</span>
                <span className="text-muted-foreground text-[10px]">{r.region} · {r.currency}</span>
              </div>
              <p className="text-muted-foreground truncate mt-0.5">{r.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default StockSearch;
