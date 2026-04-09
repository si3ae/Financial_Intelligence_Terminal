# Financial Intelligence Terminal

> A Bloomberg-style market dashboard built for multilingual financial monitoring —
> covering equities, forex, commodities, bonds, crypto, and macro indicators
> in a unified terminal interface.

[![Demo](https://img.shields.io/badge/demo-live-black)](https://your-demo-url)
[![Status](https://img.shields.io/badge/status-in%20progress-orange)]()
[![Built by](https://img.shields.io/badge/built%20by-1%20person-lightgrey)]()

---

## The Problem

Financial data is loud. Most dashboards are either too narrow
(single asset class) or too cluttered (raw data feeds with no structure).

Professionals tracking cross-border markets need a single view that:
- Surfaces **macro context** alongside price data
- Handles **multilingual signal interpretation**
- Structures information for **fast pattern recognition**, not just display

---

## What It Does

A multi-panel terminal interface organized around layered signal types.
Each panel fetches independently — live where the API allows, static with
a documented upgrade path where quota or coverage constraints apply.

| Panel | Data Source | Live? |
|-------|-------------|-------|
| Equity chart | Alpha Vantage | ✅ Live |
| AI Assistant | Gemini 1.5 Flash (direct API) | ✅ Live |
| Crypto prices | CoinGecko public API | ✅ Live (2-min polling) |
| News feeds (×2) | NewsAPI via Supabase Edge Function | ✅ Live |
| Portfolio tracker | Alpha Vantage + live FX | ✅ Live |
| Portfolio news digest | NewsAPI (batched query) | ✅ Live |
| Forex pairs | Static snapshot | ⚠️ Static* |
| Energy & metals | Static snapshot | ⚠️ Static* |
| Bond yields | Static snapshot | ⚠️ Static* |
| Macro indicators | Static snapshot | ⚠️ Static* |
| Economic calendar | Rolling template (current month + next) | ⚠️ Static* |

*Static data is intentional — Alpha Vantage's free tier enforces 25 requests/day
and NewsAPI's free Developer tier is 100 requests/day across all visitors.
Fetching all symbols live would exhaust the quota on first page load.
Each static file documents the exact API call needed to go live via a
`WHAT_IF_NO_LIMITS` code block.

---

## Architecture

```
External APIs
  ├── Alpha Vantage     → stock quotes, price history, FX rates
  ├── CoinGecko         → real-time crypto prices (no key required)
  ├── NewsAPI           → multilingual financial news headlines
  └── Google Gemini 1.5 Flash → streaming AI responses (free tier, 1500 req/day)

Supabase Edge Functions (API proxy layer)
  ├── market-data       → Alpha Vantage + NewsAPI + CoinGecko
  │     actions: quote | daily | intraday | weekly | monthly
  │              fx | crypto | news | portfolio-news | search
  └── ai-assistant      → streaming SSE to Gemini API
        context: selected stock + portfolio positions + portfolio news digest
        format:  Gemini SSE → re-streamed as OpenAI-compatible delta chunks

Frontend (Vite + React + TypeScript)
  ├── i18n Layer        → LanguageContext (8 locales: ko en zh ja gb de fr it)
  ├── Data Layer        → marketDataService.ts (in-memory cache + env guard)
  ├── Signal Layer      → sentimentAnalysis.ts (rule-based NLP, 7 languages)
  ├── Currency Layer    → useBaseCurrency hook (live FX conversion)
  └── Component Layer
        ├── TerminalHeader       (stock search, language selector, clock)
        ├── StockChart           (area chart + MA/RSI/MACD overlays)
        ├── MacroInsightCard     (sector × locale analysis, 7×8 matrix)
        ├── LiveNewsFeed         (stock-scoped live news + sentiment tags)
        ├── LiveCryptoTable      (real-time CoinGecko prices)
        ├── MarketTable ×2       (forex / commodities — static)
        ├── BondsTable           (fixed income yields — static)
        ├── MacroTable           (GDP / CPI / unemployment / rates — static)
        ├── EconomicCalendar     (upcoming macro events — rolling template)
        ├── PortfolioPanel       (live P&L + multi-currency + news sentiment)
        └── AIAssistantPanel     (streaming chat with 4-layer context)

Responsive Grid
  1-col mobile → 2-col tablet → 3-col desktop (max 1440px)
```

---

## Signal Layer

One design goal was making the terminal interpret data, not just display it.

**News sentiment classification.**
Each headline in `LiveNewsFeed` and `PortfolioPanel` is classified as
`▲ Bullish`, `▼ Bearish`, or `● Neutral` using a rule-based keyword engine
(`sentimentAnalysis.ts`) covering English, Korean, Japanese, Chinese, German,
French, and Italian. Latin-script keywords use precompiled `\b` regex
boundaries to avoid false positives like `'gain'` matching `'against'`;
CJK keywords use substring matching (word boundaries are ill-defined for
CJK). A small `PHRASE_OVERRIDES` table handles polarity flips like
`'record low'` (bearish) and `'rate cuts'` (neutral, not bearish).

**Sector-aware macro insight.**
`MacroInsightCard` resolves the active symbol to a sector
(`semiconductor`, `tech`, `finance`, `energy`, `consumer`, `automotive`,
`generic`) via a curated 40-ticker lookup, then picks from a 7-sector ×
8-locale analysis matrix (56 cells). A Korean investor looking at NVDA
sees FX and KOSPI ADR correlation notes; a US investor sees Fed rates
and export controls. Unknown tickers fall through to `generic` with a
rate-regime + FX analysis that applies to any equity.

**Portfolio ↔ news wiring.**
`PortfolioPanel` fetches a batched news digest for all held positions
in a single OR-joined NewsAPI query (one request for the whole
portfolio, not per position — critical for staying inside the 100
req/day free tier). Each position gets a dominant-sentiment badge from
substring matches against the digest; the panel header shows
portfolio-wide bullish/bearish counts.

**AI context injection (4 layers).**
The AI assistant receives four context layers as part of every system
prompt: (1) the currently selected stock, (2) the user's portfolio
positions (symbol, name, buy price, quantity, live P&L), (3) the base
currency and per-position FX conversions, and (4) a digest of recent
news relevant to held positions with sentiment tags. The prompt includes
an explicit "do not invent news that is not listed here" instruction —
without it, models sometimes confabulate plausible-sounding headlines.

**Upgrade path to real NLP.**
`sentimentAnalysis.ts` documents the migration path to FinBERT
(HuggingFace) or a dedicated Gemini classification prompt for higher-
accuracy scoring.

---

## Why This Connects to Financial AI

This terminal is a **signal organization layer**. The architectural
pattern that matters most: injecting heterogeneous, multilingual,
real-time context into an LLM system prompt so it can reason about
cross-border financial data without the user having to re-state it each
turn. That's the same pattern used in enterprise RAG systems for risk
briefing, fraud triage, and regulatory surveillance — where the signal
is scattered across many sources and the model is only as useful as the
state it can see.

The other three layers (multi-source aggregation, multilingual
sentiment, macro context) are infrastructure that makes the context
layer possible, not independent claims.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Vite + React 18 + TypeScript |
| Styling | Tailwind CSS + framer-motion |
| i18n | Custom LanguageContext (8 locales) |
| Charts | Recharts (area, composed, RSI, MACD) |
| Backend | Supabase Edge Functions (Deno) |
| AI | Google Gemini 1.5 Flash (streaming SSE) |
| Data APIs | Alpha Vantage · CoinGecko · NewsAPI |
| Persistence | localStorage (portfolio positions, base currency) |
| Deployment | GitHub + Supabase |

---

## Setup

```bash
# 1. Clone and install
git clone https://github.com/si3ae/Financial_Intelligence_Terminal
cd Financial_Intelligence_Terminal
npm install

# 2. Configure environment
cp .env.example .env
# Fill in VITE_SUPABASE_PROJECT_ID, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_URL
# (assertEnv() will throw at module load with a clear message if these are missing)

# 3. Configure Supabase
cp supabase/config.toml.example supabase/config.toml
# Fill in your project_id

# 4. Add API keys to Supabase Edge Function Secrets
# Dashboard → Settings → Edge Functions → Secrets
# Required: ALPHA_VANTAGE_API_KEY, NEWS_API_KEY, GEMINI_API_KEY

# 5. Deploy Edge Functions
supabase login
supabase link --project-ref <your-project-id>
supabase functions deploy market-data
supabase functions deploy ai-assistant

# 6. Run locally
npm run dev
```

---

## Current Status

**Live data**
- [x] Multi-panel terminal layout (responsive grid, 1–3 column)
- [x] Multilingual support — 8 locales with translated asset names and UI
- [x] Live equity chart with MA / RSI / MACD overlays
- [x] Live crypto prices via CoinGecko (2-min polling)
- [x] Live news feeds via NewsAPI (locale-scoped + stock-scoped)
- [x] Portfolio tracker with live P&L via Alpha Vantage
- [x] Multi-currency portfolio aggregation with live FX conversion
- [x] Portfolio news digest — batched OR-query, one request per portfolio
- [x] Per-position news sentiment badges + portfolio-wide alert banner
- [x] AI assistant with streaming responses and 4-layer context injection
  (selected stock + portfolio + currency + news digest)

**Signal layer**
- [x] Rule-based news sentiment classification (7 languages) with
      word-boundary matching and phrase-level polarity overrides
- [x] Sector-aware macro insight (7-sector × 8-locale analysis matrix)
- [x] Symbol-agnostic chart component (renamed from `SKHynixChart` →
      `StockChart`; SK hynix is now the default, not a hard-coded target)

**Infrastructure**
- [x] Supabase Edge Function proxy (API key isolation)
- [x] Runtime env-var guard (`assertEnv` at module load)
- [x] Static data documented with `WHAT_IF_NO_LIMITS` upgrade blocks
- [x] Race-condition guards on stock search and historical price lookups

**Deferred**
- [x] End-to-end build verification on a fresh checkout (pass 1 complete —
      5 issues found, scheduled for next fix round; see `CHANGELOG.md`
      round 5)
- [ ] Round 6 fixes: stock search error surfacing, news locale coverage,
      date picker replacement, grid layout, glass-card CSS
- [ ] Unit tests — scheduled for after round 6 lands
      (`sentimentAnalysis.ts`, `technicalIndicators.ts`, race guards)
- [ ] Migration of data layer from hand-rolled cache to `@tanstack/react-query`
- [ ] Interval polling for forex / commodity prices (quota permitting)
- [ ] FRED API integration for live bond yields
- [ ] News sentiment upgrade to FinBERT or Gemini classification
- [ ] AI function calling (e.g. "show SK Hynix chart" → setStock)

---

## Limitations

An honest accounting of what this project does not yet do. The first
five items were **confirmed in end-to-end verification pass 1** and are
scheduled for the next fix round — see `CHANGELOG.md` round 5 and
`CODE_REVIEW.md` §1.5–§1.8 and §2.6 for details.

- **Stock search returns no results.** Alpha Vantage's rate-limit
  response comes back as HTTP 200 with a `Note` field and no match
  array, so the parser silently returns `[]`. The UI currently can't
  distinguish "quota exhausted" from "no matches". Fix: explicit
  detection of rate-limit responses plus a typed error that the UI
  can surface.
- **News feed shows English-only content in non-English locales.**
  NewsAPI's free Developer tier has thin country-indexed coverage
  outside the US, so the 3-tier fallback in `fetchNews()` consistently
  falls through to the English global tier. Fix: curated per-locale
  `sources=` lists, locale-specific finance keywords in the query,
  and explicit fallback labelling in the UI.
- **Date picker shows OS locale placeholder.** The portfolio panel's
  "Pick Historical Price" uses a native `<input type="date">`, which
  draws its placeholder from the OS locale regardless of the UI
  language. Fix: replace with shadcn/ui's `Calendar` + `Popover`.
- **Ragged last row on the desktop grid.** 10 panels in a 3-column
  grid leave two empty cells beside the last row. Fix: promote
  `PortfolioPanel` to a 2×2 anchor on the right column.
- **Glass cards look flat.** `.glass-card` has `contain: paint`,
  which is a GPU optimisation that happens to interact badly with
  `backdrop-filter` in Chromium. Plus the light-mode background
  gradients are low enough saturation that even a working blur has
  little to sample. Fix: drop `paint` from the containment rule,
  lower card alpha, raise blur, strengthen background gradients.

- **No automated tests.** Correctness fixes (EMA seeding, MA period
  clamping, sentiment word boundaries, search race conditions) were
  verified manually and against synthetic series. A Vitest pass is
  scheduled for after the next fix round — writing tests against
  code that's about to change on five fronts would be wasted effort.
- **Static data on several panels.** Forex, commodities, bond yields,
  and macro indicators use fallback snapshots because no free real-time
  source exists in the right shape. The economic calendar uses a
  rolling month-window template so dates don't go stale, but the event
  list is hand-curated. Each static source has a `WHAT_IF_NO_LIMITS`
  code block showing the live implementation.
- **Hand-rolled cache.** `marketDataService.ts` uses a module-level
  `Map` that grows unbounded, has no `staleWhileRevalidate` semantics,
  and is shared across component trees. React Query is already wired
  into `App.tsx` but unused — migrating to it is the single
  highest-leverage refactor on the list.
- **Mobile density not audited.** The grid collapses to 1 column under
  ~768 px but the AI assistant and portfolio panels have not been
  evaluated against real small-screen usage.
- **Accessibility not audited.** Sentiment badges use redundant
  symbol + color (good), but keyboard navigation, screen reader
  semantics, and focus ordering across the multi-panel grid have not
  been checked.
- **No quota-aware throttling.** A user who searches for 26+ distinct
  symbols in a single session will exhaust the Alpha Vantage free tier
  and see empty charts for the rest of the day. The Edge Function
  doesn't rate-limit or warn.

For the full review behind most of these, see
[`CODE_REVIEW.md`](./CODE_REVIEW.md).
For patch history and round-by-round changes, see
[`CHANGELOG.md`](./CHANGELOG.md).

---

## What I Learned

- Designing composable panel architectures for high-density financial UIs
- Building a multi-tier API proxy with in-memory caching and graceful fallbacks
- Implementing 8-locale i18n across data, UI strings, and number formatting
- Structuring a rule-based NLP signal layer as a drop-in upgrade path for ML
- Injecting layered application state (stock + portfolio + currency +
  news digest) into LLM system prompts for context-aware AI responses
- Adapting streaming SSE formats across APIs (Gemini → OpenAI-compatible delta chunks)
- Managing API quota constraints as an explicit architectural constraint,
  not a technical debt item
- Using request-id guards instead of `AbortController` when the abort
  signal would otherwise need to thread through the service layer
- Writing honest self-reviews — flagging "areas not yet reviewed" is
  more useful than claiming coverage the work doesn't have

---

> **Related projects**
>
> [Dandi](https://github.com/si3ae/Dandi-AI_Accounting_Automation_System) — the anomaly detection pattern from this terminal's macro layer,
> applied to small merchant financial health monitoring
>
> [Global Shell-Tracker](https://github.com/si3ae/Cross-Border_Fraud_Detection_AI) — multi-signal fraud detection across
> cross-border transactions; shares the same multi-source aggregation architecture

---

Built by Sinae Hong · [LinkedIn](https://www.linkedin.com/in/sinae-hong-583306216/)
