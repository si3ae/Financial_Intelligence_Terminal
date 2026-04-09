/**
 * @file AIAssistantPanel.tsx
 * @description Floating AI assistant panel with streaming SSE responses.
 *
 * CONTEXT INJECTION:
 *   The assistant receives four layers of terminal context on every message:
 *
 *   1. stockContext  — currently selected stock (symbol, name, currency, region).
 *      Already present in the original implementation.
 *
 *   2. portfolioContext — user's open positions (symbol, name, buy price,
 *      quantity, currency). Injected as a compact JSON summary so the AI
 *      can give portfolio-aware analysis without the user re-stating their
 *      positions in the chat.
 *      Example: "You're holding 100 SK hynix at ₩295,000 avg — want to
 *      discuss exit strategy given the recent HBM guidance?"
 *
 *   3. newsContext — per-position recent news digest with sentiment tags.
 *      Up to 3 headlines per position, each classified as bullish/bearish/
 *      neutral by the rule-based engine in `lib/sentimentAnalysis.ts`. This
 *      lets the AI connect news to holdings without any extra user prompt:
 *      "There's a bearish headline on NVDA about export-control changes
 *      from 3 hours ago — that might be relevant to your position."
 *
 *      The news is fetched in a background effect (see `newsRef`) so the
 *      Send button never blocks on a network round-trip. On the very first
 *      message after opening the panel, newsContext may be empty if the
 *      fetch hasn't landed yet — the AI handles this gracefully because the
 *      empty-array case is handled by the system prompt (see below).
 *
 *   4. locale — drives the response language in the Edge Function system prompt.
 *
 * EDGE FUNCTION UPDATE REQUIRED:
 *   In supabase/functions/ai-assistant/index.ts, update the system prompt to
 *   include both portfolioContext and newsContext:
 *   ──────────────────────────────────────────────────────────────────────
 *   const { messages, stockContext, portfolioContext, newsContext, locale }
 *     = await req.json();
 *
 *   // Add to systemPrompt string:
 *   ${portfolioContext?.length
 *     ? `\nUser's current portfolio:\n${JSON.stringify(portfolioContext, null, 2)}`
 *     : '\nUser has no open positions.'}
 *
 *   ${newsContext?.length
 *     ? `\nRecent news relevant to the user's positions (with sentiment):\n` +
 *       `${JSON.stringify(newsContext, null, 2)}\n` +
 *       `When answering, proactively connect these headlines to the user's ` +
 *       `holdings where relevant. Do not invent news that is not listed here.`
 *     : ''}
 *   ──────────────────────────────────────────────────────────────────────
 *
 *   The "do not invent news" instruction is important: without it, models
 *   sometimes confabulate plausible-sounding headlines when asked about
 *   recent events. Constraining the AI to the supplied list keeps it honest.
 *
 * STREAMING:
 *   Responses are streamed via SSE (Server-Sent Events) from the Edge Function,
 *   which proxies to the AI gateway (Gemini backend). The `upsert`
 *   helper appends delta chunks to the last assistant message in real time,
 *   creating a typewriter effect without storing intermediate state externally.
 *
 * RATE LIMITS:
 *   The AI gateway returns 429 if the user sends messages too quickly.
 *   The Edge Function surfaces this as a JSON error body which is displayed
 *   inline in the chat rather than as a toast to keep the UX contained.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, Loader2, Bot } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/i18n/LanguageContext';
import { useStock } from '@/hooks/useStockContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { fetchPortfolioNews, normaliseCompanyName, type NewsArticle } from '@/services/marketDataService';
import { getSentiment } from '@/lib/sentimentAnalysis';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const AIAssistantPanel = () => {
  const { locale, t } = useLanguage();
  const { stock } = useStock();
  const { positions } = usePortfolio();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Portfolio-wide news digest, kept in a ref so that sendMessage can read
  // the latest value without forcing a re-render of the whole panel when
  // news arrives. News is fetched opportunistically in a background effect
  // whenever the portfolio changes; the service-layer cache (5 min TTL)
  // typically means this is a no-op because PortfolioPanel just populated
  // the same cache key.
  //
  // Storing in a ref rather than state is deliberate: the news only matters
  // at the moment the user hits Send, and we don't want the input field to
  // re-render mid-typing because a background news fetch resolved.
  const newsRef = useRef<NewsArticle[]>([]);
  const latestNewsRequestId = useRef(0);

  useEffect(() => {
    if (positions.length === 0) { newsRef.current = []; return; }
    const myId = ++latestNewsRequestId.current;
    fetchPortfolioNews(positions.map(p => p.name), locale)
      .then(articles => {
        if (myId !== latestNewsRequestId.current) return;
        newsRef.current = articles;
      })
      .catch(() => {
        if (myId !== latestNewsRequestId.current) return;
        newsRef.current = [];
      });
  }, [positions, locale]);

  // Auto-scroll to the latest message as it streams in
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  /**
   * Builds a compact portfolio summary for the AI context payload.
   * Keeps the payload small — only the fields the AI needs for analysis.
   * Live prices are not included here; the AI is instructed to caveat
   * that P&L figures are based on the user's recorded buy prices.
   */
  const buildPortfolioContext = useCallback(() => {
    if (positions.length === 0) return [];
    return positions.map(p => ({
      symbol:   p.symbol,
      name:     p.name,
      buyPrice: p.buyPrice,
      quantity: p.quantity,
      currency: p.currency,
    }));
  }, [positions]);

  /**
   * Builds a compact, per-position news digest for the AI context payload.
   *
   * For each held position, finds the most recent headlines that mention its
   * (normalised) company name, classifies each with the rule-based sentiment
   * engine, and bundles up to `PER_POSITION_LIMIT` items. Headlines not
   * matching any position are dropped — the AI doesn't need a dump of every
   * financial headline on the internet, just the ones relevant to holdings.
   *
   * Why a ref and not state for `newsRef`: see the comment next to the
   * declaration above. The short version is that a background news fetch
   * arriving while the user is mid-typing should not re-render the input.
   *
   * Payload size: each headline is ~100-150 chars including sentiment tag and
   * source, × up to 3 per position × up to 10 positions = ~4.5KB worst case.
   * Well under the 100KB+ that modern LLM context windows tolerate on the
   * input side, and a tiny fraction of the total request.
   */
  const buildNewsContext = useCallback(() => {
    if (positions.length === 0 || newsRef.current.length === 0) return [];
    const PER_POSITION_LIMIT = 3;
    const result: Array<{
      symbol: string;
      headlines: Array<{ headline: string; source: string; time: string; sentiment: string }>;
    }> = [];

    for (const p of positions) {
      const needle = normaliseCompanyName(p.name).toLowerCase();
      if (!needle) continue;
      const matching = newsRef.current
        .filter(a => a.headline.toLowerCase().includes(needle))
        .slice(0, PER_POSITION_LIMIT)
        .map(a => ({
          headline: a.headline,
          source:   a.source,
          time:     a.time,
          sentiment: getSentiment(a.headline),
        }));
      if (matching.length > 0) {
        result.push({ symbol: p.symbol, headlines: matching });
      }
    }
    return result;
  }, [positions]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    let assistantSoFar = '';

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          stockContext: {
            symbol:   stock.symbol,
            name:     stock.name,
            currency: stock.currency,
            region:   stock.region,
          },
          // Portfolio positions — used by the Edge Function system prompt to
          // give the AI awareness of what the user is holding.
          // Requires the ai-assistant Edge Function to be updated (see file JSDoc).
          portfolioContext: buildPortfolioContext(),
          // Per-position recent news digest with sentiment tags. Populated
          // from newsRef, which is filled by a background effect whenever
          // the portfolio changes. On first message, this may be empty if
          // the background fetch hasn't completed yet — that's an acceptable
          // tradeoff to avoid blocking the send button on a news round-trip.
          newsContext: buildNewsContext(),
          locale,
        }),
      });

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({ error: 'Request failed' }));
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `⚠️ ${errData.error || 'Error'}` },
        ]);
        setLoading(false);
        return;
      }

      // Stream SSE delta chunks into the last assistant message
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      const upsert = (chunk: string) => {
        assistantSoFar += chunk;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
            );
          }
          return [...prev, { role: 'assistant', content: assistantSoFar }];
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, idx);
          textBuffer  = textBuffer.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || !line.trim() || !line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') break;
          try {
            const parsed  = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsert(content);
          } catch {
            // Incomplete JSON chunk — prepend back to buffer and retry next iteration
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }
    } catch (e) {
      console.error('AI assistant error:', e);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: '⚠️ Connection error. Please try again.' },
      ]);
    }

    setLoading(false);
  }, [input, loading, messages, stock, locale, buildPortfolioContext, buildNewsContext]);

  // ─── Collapsed state — floating button ──────────────────────────────────────

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl bg-accent text-accent-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
        style={{ boxShadow: '0 0 20px hsl(var(--accent) / 0.3)' }}
        aria-label="Open AI assistant"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  // ─── Expanded state — chat panel ─────────────────────────────────────────────

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[380px] h-[520px] glass-card flex flex-col overflow-hidden"
      style={{ backdropFilter: 'blur(20px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">{t.aiTitle}</span>
          <div className="live-indicator" />
          {/* Show portfolio count if positions are loaded — signals context awareness */}
          {positions.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
              {positions.length} position{positions.length > 1 ? 's' : ''} loaded
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close AI assistant"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Message list */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Bot className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-xs text-muted-foreground max-w-[240px]">
              {t.aiAskAbout} {stock.name}
            </p>
            {positions.length > 0 && (
              <p className="text-[10px] text-muted-foreground/60 mt-2 max-w-[240px]">
                I can also see your {positions.length} portfolio position{positions.length > 1 ? 's' : ''}.
              </p>
            )}
          </div>
        )}
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted/50 text-foreground'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-xs dark:prose-invert max-w-none [&_p]:m-0 [&_ul]:my-1 [&_li]:my-0 text-xs">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : msg.content}
              </div>
            </div>
          ))}
          {loading && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex justify-start">
              <div className="bg-muted/50 rounded-xl px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input bar */}
      <div className="px-3 py-3 border-t border-border/50">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder={t.aiPlaceholder}
            className="flex-1 bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="w-8 h-8 rounded-lg bg-accent text-accent-foreground flex items-center justify-center disabled:opacity-40 transition-opacity"
            aria-label="Send message"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistantPanel;
