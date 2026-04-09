// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AV_BASE = 'https://www.alphavantage.co/query';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const AV_KEY = Deno.env.get('ALPHA_VANTAGE_API_KEY');
    const NEWS_KEY = Deno.env.get('NEWS_API_KEY');

    if (!AV_KEY) throw new Error('ALPHA_VANTAGE_API_KEY not configured');

    let data: any;

    switch (action) {
      case 'search': {
        const keywords = url.searchParams.get('keywords') || '';
        const res = await fetch(`${AV_BASE}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${AV_KEY}`);
        data = await res.json();
        break;
      }

      case 'quote': {
        const symbol = url.searchParams.get('symbol') || '';
        const res = await fetch(`${AV_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${AV_KEY}`);
        data = await res.json();
        break;
      }

      case 'daily':
      case 'daily_adjusted': {
        const symbol = url.searchParams.get('symbol') || '';
        const outputsize = url.searchParams.get('outputsize') || 'compact';
        const fn = action === 'daily_adjusted' ? 'TIME_SERIES_DAILY_ADJUSTED' : 'TIME_SERIES_DAILY';
        const res = await fetch(`${AV_BASE}?function=${fn}&symbol=${encodeURIComponent(symbol)}&outputsize=${outputsize}&apikey=${AV_KEY}`);
        data = await res.json();
        break;
      }

      case 'intraday': {
        const symbol = url.searchParams.get('symbol') || '';
        const interval = url.searchParams.get('interval') || '5min';
        const res = await fetch(`${AV_BASE}?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(symbol)}&interval=${interval}&apikey=${AV_KEY}`);
        data = await res.json();
        break;
      }

      case 'weekly': {
        const symbol = url.searchParams.get('symbol') || '';
        const res = await fetch(`${AV_BASE}?function=TIME_SERIES_WEEKLY&symbol=${encodeURIComponent(symbol)}&apikey=${AV_KEY}`);
        data = await res.json();
        break;
      }

      case 'monthly': {
        const symbol = url.searchParams.get('symbol') || '';
        const res = await fetch(`${AV_BASE}?function=TIME_SERIES_MONTHLY&symbol=${encodeURIComponent(symbol)}&apikey=${AV_KEY}`);
        data = await res.json();
        break;
      }

      case 'fx': {
        const from = url.searchParams.get('from') || 'USD';
        const to = url.searchParams.get('to') || 'KRW';
        const res = await fetch(`${AV_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${AV_KEY}`);
        data = await res.json();
        break;
      }

      case 'crypto': {
        // CoinGecko public API - no key needed
        const ids = url.searchParams.get('ids') || 'bitcoin,ethereum,solana';
        const vs = url.searchParams.get('vs') || 'usd';
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true&include_market_cap=true`);
        data = await res.json();
        break;
      }

      case 'news': {
        if (!NEWS_KEY) throw new Error('NEWS_API_KEY not configured');
        const q = url.searchParams.get('q') || 'stock market';
        const language = url.searchParams.get('language') || 'en';
        const country = url.searchParams.get('country') || '';
        const pageSize = url.searchParams.get('pageSize') || '10';
        const mode = url.searchParams.get('mode') || 'headlines'; // headlines | everything
        let newsUrl: string;
        if (mode === 'everything') {
          newsUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${language}&pageSize=${pageSize}&sortBy=publishedAt&apiKey=${NEWS_KEY}`;
        } else if (country) {
          newsUrl = `https://newsapi.org/v2/top-headlines?country=${country}&category=business&pageSize=${pageSize}&apiKey=${NEWS_KEY}`;
        } else {
          newsUrl = `https://newsapi.org/v2/top-headlines?category=business&language=${language}&pageSize=${pageSize}&apiKey=${NEWS_KEY}`;
        }
        const res = await fetch(newsUrl);
        data = await res.json();
        break;
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action. Use: search, quote, daily, intraday, weekly, monthly, fx, crypto, news' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('market-data error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
