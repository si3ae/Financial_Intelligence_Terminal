# FIT Code Review

A self-review of the Financial Intelligence Terminal source, ordered by
severity. Items marked **✅ Fixed** have been addressed — see `CHANGELOG.md`
for the patch round that applied each fix. Items marked **🟡 Open** are
flagged but not yet addressed. Items marked **🔴 Verified bug** were
confirmed in the end-to-end verification pass (CHANGELOG round 5) and are
scheduled for the next fix round.

---

## 1. Bugs

### 1.1 `StockSearch.tsx` — debounced search race condition ✅ Fixed
The 350 ms debounce only delayed the *start* of each request, not the order
in which they resolved. Typing "apple" quickly could result in
`searchSymbol("ap")` completing after `searchSymbol("apple")`, so stale
results overwrote the correct ones. Fixed with a monotonic request-id
guard. The same pattern was later applied to `PortfolioPanel.handlePickDate`
(see CHANGELOG round 2).

### 1.2 `sentimentAnalysis.ts` — three correctness issues ✅ Fixed
- **Substring matching was claimed to be word-boundary matching.**
  `includes()` is plain substring matching, so `'crash'` matched
  `'recrash'`, `'gain'` matched `'against'`, `'risk'` matched `'asterisk'`.
  Latin-script keywords now use a precompiled regex with `\b` boundaries.
  CJK keywords still use `includes()` (word boundaries are ill-defined
  for CJK).
- **Stem variants.** Word-boundary matching loses the accidental stemming
  `includes()` provided. Keyword lists now enumerate common stem variants
  explicitly — verbose but predictable.
- **Phrase-level polarity flips.** `'record'` is bullish but `'record low'`
  is bearish; `'cuts'` is bearish but `'rate cuts'` and `'tax cuts'` aren't.
  A small `PHRASE_OVERRIDES` table handles these without moving to ML.
- Verified on 14 test headlines: 12/14 vs 9/14 before the fix.

### 1.3 `technicalIndicators.ts` — EMA seeding and MA period clamping ✅ Fixed
- **EMA warm-up.** The warm-up window used to push raw prices onto the
  result array, making overlays track the price exactly for the first
  11/25 points and then jump to the real EMA. Now seeds with the SMA of
  the first `period` values and masks the warm-up window to `undefined`
  so the chart simply doesn't draw those points.
- **MACD signal warm-up.** Same issue, same fix — no more flat seed-line
  segment for the first 8 signal/histogram points.
- **Silent MA period clamping.** `calculateIndicators` used to clamp
  `Math.min(50, Math.floor(prices.length * 0.4))`, meaning on 60 points
  the legend said "MA50" but plotted a 24-period MA. The clamp was
  removed; the indicator now simply doesn't render on short histories.
- Verified against the original on a 300-point synthetic price series:
  `ma50`, `ma200`, `rsi`, `macdLine` are bit-identical; `macdSignal` and
  `macdHist` differ only at the warm-up positions that are now correctly
  masked.

### 1.4 `marketDataService.ts` — error swallowing hides real failures 🟡 Partial
Every fetch path uses `try { ... } catch (e) { console.warn(...); return [] }`.
This is fine for resilience but it means a misconfigured Supabase project,
an expired anon key, or an Edge Function deployment failure all surface to
the user as "no data" with no actionable feedback.

**Fixed:** `assertEnv()` now fails fast at module load if
`VITE_SUPABASE_PROJECT_ID` or `VITE_SUPABASE_PUBLISHABLE_KEY` is missing,
pointing at `.env.example` (see §2.2).

**Still open:** Distinguishing *transport* errors (network down, 5xx) from
*data* errors (empty result) and surfacing the former through a toast or
context so the user knows to check their setup. **This gap was felt
directly in verification pass 1** — the stock search returns no results
(see §1.5) and the user has no way to tell whether it's a quota issue,
a misconfigured secret, or a genuinely empty match set.

### 1.5 `searchSymbol()` — no symbols returned in live testing 🔴 Verified bug
During the first end-to-end verification run, the header search box
returns zero results for any typed query. The code path is correct
(`searchSymbol → callEdge('search') → SYMBOL_SEARCH`), so the failure
is silent — Alpha Vantage's free-tier rate-limit response is shaped as
a 200 with `{"Note": "Thank you for using..."}` and no `bestMatches`
key, which the current parser flattens to `[]` without distinguishing
from a real empty match set. Root cause is one of:

1. Shared daily quota already exhausted by other fetch paths (most likely)
2. `ALPHA_VANTAGE_API_KEY` Edge Function secret not set or wrong
3. Edge Function not deployed

**Next-session fix:** In `searchSymbol`, inspect the raw response for
`data.Note`, `data['Information']`, or `data['Error Message']` and
throw a typed error (`QuotaExceededError`, `ConfigError`) instead of
returning `[]`. Surface the distinction in the search UI ("rate
limited — try again tomorrow" vs "no matches"). This is the concrete
actionable version of §1.4.

### 1.6 News feed returns English-only content across locales 🔴 Verified bug
Verified in testing: switching the UI to `ko`, `ja`, `zh`, `de`, `fr`,
or `it` still surfaces predominantly English headlines in `LiveNewsFeed`
and `MacroInsightCard`. The 3-tier fallback in `fetchNews` is
implemented correctly, but in practice Tier 1 (`top-headlines` +
country code) returns zero articles for most non-US locales on NewsAPI's
free Developer tier — Korean and Japanese business sources in
particular have almost no coverage. Tier 2 (`everything` with
`language=ko` + the stock name as query) then fails to find
locale-language matches because stock names are typically written in
English even in Korean/Japanese press. The code falls through to Tier 3
(English global) every time.

This is partly a NewsAPI tier limitation but also a query-construction
issue. **Next-session fix options** (pick one or stack them):

1. Use NewsAPI's `sources=` parameter with a curated locale→sources
   table (e.g. `ko → yonhap,the-chosun-ilbo`) instead of relying on
   `country=kr`. Source-level queries bypass the country index gap.
2. Augment Tier 2's query with locale-specific finance keywords
   (`q: \`${stockName} OR 주식 OR 증시\`` for Korean, etc.) so the
   `language=ko` filter has something to match.
3. Honest fallback labelling: if Tier 3 fires, show a small "showing
   English fallback — NewsAPI locale coverage is limited" tag on the
   panel so the user knows why.

### 1.7 `<input type="date">` shows OS-locale placeholder 🔴 Verified bug
Verified in testing: in English UI mode on a Korean OS, the portfolio
"Pick Historical Price" date input displays `연도-월-일` as its
placeholder. This is **not a bug in the component** — HTML's native
date input draws its placeholder and format from the OS/browser
locale, not from any React state or `lang` attribute. Chrome ignores
`lang="en"` on date inputs in most configurations.

The project's positioning is "multilingual financial terminal", so
letting the date picker leak OS locale through the UI undermines the
pitch. **Next-session fix:** Replace the native input with shadcn/ui's
`Calendar` + `Popover` combo (already available via `components.json`).
This also unlocks proper keyboard navigation and a consistent
cross-platform look.

### 1.8 `Index.tsx` — 10 panels in a 3-column grid leave a ragged last row 🔴 Verified bug
Verified in testing: the terminal has **10** `<Suspense>`-wrapped
panels inside `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`. On desktop,
10 ÷ 3 = 3 full rows + 1 orphan, leaving two empty cells to the right
of the last panel. Screenshot from the verification run shows a large
blank area next to the MacroTable on wide viewports.

**Next-session fix options:**

1. Promote `PortfolioPanel` to `xl:col-span-2 xl:row-span-2` so it
   anchors the right column as a tall card (matches its content
   density — it has the most internal rows of any panel)
2. Merge two related tables into a tabbed panel to bring the count
   down to 9
3. Add a 10th content panel to reach 12

Option (1) is the cheapest and also improves visual hierarchy.

---

## 2. Architectural observations

### 2.1 Process-wide unbounded cache 🟡 Open
`marketDataService.ts` keeps a module-level `Map` cache. It works, but:

- It grows without bound. Every unique `histprice:SYMBOL:DATE` adds an
  entry forever.
- It is shared across all React component trees, including ones that
  mount and unmount during HMR.
- It has no `staleWhileRevalidate` semantics: a cache hit returns
  instantly, but a stale-by-1-ms entry blocks on a full network round trip.

The terminal already depends on `@tanstack/react-query` (wired into
`App.tsx` via `<QueryClientProvider>` but unused). React Query handles
all of the above properly: bounded LRU, background refetch, request
deduplication, retry, and devtools. The hand-rolled cache should be
deleted and the service functions should be called from `useQuery` hooks.

**Not fixed** — too large a change for a single review pass, but flagged
as the single highest-leverage refactor.

### 2.2 `callEdge()` URL construction ✅ Fixed
```ts
const url = `https://${projectId}.supabase.co/functions/v1/market-data?${query}`;
```
If `VITE_SUPABASE_PROJECT_ID` was empty, this silently became
`https://.supabase.co/...` and the request failed with a confusing DNS
error. The `assertEnv()` guard at module load now throws with a clear
message pointing at `.env.example`.

### 2.3 Alpha Vantage response parsing scattered inline 🟡 Open
`fetchQuote`, `fetchStockHistory`, and `fetchHistoricalPrice` each contain
their own copy of the Alpha Vantage field-name decoding (`q['05. price']`,
`vals['4. close']`, etc.). If Alpha Vantage ever versions its response,
every call site needs an edit. Extracting `parseAlphaVantageQuote()` /
`parseAlphaVantageDailyEntry()` helpers would localise the magic strings
to one place.

### 2.4 The 8-branch `if/else` in `fetchStockHistory` 🟡 Open
A state machine in disguise. A small lookup table keyed on `range`
(interval, slice count, time-series key, date formatter) would replace
~60 lines of repeated code with ~15. Easier to test, easier to add new
ranges.

### 2.5 Comments tracking their own diff history ✅ Fixed
Two header comments were tracking what they used to do instead of what
they currently do:

- `MacroInsightCard.tsx`: removed the stale "Bug fix applied: `it`
  previously mapped to 'FR'" line. Diff history belongs in git, not
  source.
- `PortfolioPanel.tsx`: replaced `// Fixed: Promise.all instead of async
  forEach` with a real explanation of *why* `Promise.all` matters here
  (batched quote fetches land in a single `setState` call, avoiding
  one re-render per position and the "prices filling in one at a time"
  flicker).

### 2.6 `.glass-card` — `contain: paint` breaks `backdrop-filter` 🔴 Verified bug
Verified in testing: the frosted-glass effect is barely visible in
light mode and the cards read as flat white rectangles rather than
translucent panels. Two causes stack:

**Cause A — CSS containment interferes with `backdrop-filter`.**
`.glass-card` currently applies:
```css
contain: layout style paint;
backdrop-filter: blur(12px) saturate(1.6);
```
`contain: paint` establishes the element as an independent paint
containment boundary, which is a GPU optimisation — but
`backdrop-filter` needs to sample what's rendered *behind* the
element, and Chromium's backdrop-filter implementation has known
interaction bugs with `contain: paint`. The optimisation added for
scroll performance is the reason the glass effect is washed out.

**Cause B — low contrast leaves nothing to blur.**
Light mode uses `--glass-bg: 0 0% 100% / 0.4` (40% opaque white) over
a pastel gradient background. Where no other card sits behind the
blurred region, there's nothing visually distinct to sample — the
blur technically runs but the reader sees no difference between the
card interior and its surroundings. The top-right empty region in the
verification screenshot is exactly this case.

**Next-session fix** — stacked, in order of impact:

1. Change `contain: layout style paint` → `contain: layout style`
   (drop `paint`). One-line fix that restores backdrop-filter.
2. Lower `--glass-bg` alpha from `0.4` to `~0.25` and raise the border
   alpha — the border is the primary visual cue for glass edges.
3. Raise `--glass-blur` from `12px` to `20–24px`.
4. Strengthen the light-mode background radial gradients (raise their
   alpha from `0.35–0.6` to `0.55–0.75`) so the blur has something
   saturated to pick up.
5. Raise `--glass-highlight` inset from `rgba(255,255,255,0.04)` to
   `~0.15` so the top edge reads as a true glass highlight.

---

## 3. Hardcoded data — what would change with no API limits

These sections use static data because of free-tier API quotas. Each is
annotated with a `WHAT_IF_NO_LIMITS` comment in the relevant file showing
what the live implementation would look like.

### 3.1 `EconomicCalendar.tsx`
`buildUpcomingEvents()` already generates a rolling current-month-plus-next-month
event window from a template list, so dates don't go stale. The
`WHAT_IF_NO_LIMITS` block at the bottom of the file sketches a live
implementation against the **Trading Economics calendar API** or **FRED's
release calendar**:

- New `CalendarEvent` interface in `marketDataService.ts`
- A `fetchCalendar(from, to, locale)` function with `callEdge` routing,
  a new `TTL.calendar` tier, and a 6-hour cache rationale
- A rewritten `EconomicCalendar.tsx` using
  `useQuery(['calendar', from, to, locale])`, with month navigation
- 6-step migration path (~200 lines deleted, ~40 added)

### 3.2 `marketData.ts` — `forexData`, `commoditiesData`, `bondsData`, `macroData`
Fallback values returned when the live API call fails. Some (forex, crypto)
are *also* fetched live elsewhere — the static copy is purely fallback.
Others (bonds, macro indicators) are *only* shown statically because no
free real-time bond yield API exists in the same shape. The honest fix is
either to pay for a Bloomberg/Refinitiv feed, or to label these panels
"Last updated: [date]" so users don't think they're live.

### 3.3 `skHynixData.ts`
250 lines of pre-computed chart data for the default stock. Exists so the
page renders something on first load before any network call completes
(and so the demo works offline). The header comment now clarifies this
is a *first-paint placeholder*, not a fallback for failed requests.

### 3.4 `MacroInsightCard.tsx` — sector × locale analysis matrix
After the terminal-mode refactor (CHANGELOG round 3), this is a 7-sector
× 8-locale static matrix (56 cells). The `WHAT_IF_NO_LIMITS` block at the
bottom sketches the paid-tier version: `useQuery` for `fetchCompanyOverview`
(Alpha Vantage `COMPANY_OVERVIEW` → GICS sector), plus a new `ai-assistant`
Edge Function action that prompts Claude with symbol + sector + recent
NewsAPI headlines and returns JSON. Not live today because:
- Alpha Vantage `COMPANY_OVERVIEW` is capped at 25 req/day on free tier
  (one ticker change burns one request)
- Model spend is ~1¢ per active session per user

---

## 4. Comment quality

Mixed. Three patterns:

1. **Excellent**: `MacroInsightCard.tsx`, `LiveNewsFeed.tsx`,
   `sentimentAnalysis.ts`, `AIAssistantPanel.tsx` (post-refactor).
   Header docstrings explain *why*, name the data sources, list
   dependencies, point at upgrade paths. This should be the standard.
2. **Adequate**: `marketDataService.ts`, most components. Section
   dividers are present but the *why* is missing. A reader has to infer
   why the cache TTLs are what they are, why news has three fallback
   tiers, why the history function has eight range branches.
3. **Sparse**: `technicalIndicators.ts`, `PortfolioPanel.tsx`,
   `StockSearch.tsx`, `LiveCryptoTable.tsx`. Single-line file headers,
   no inline rationale. Given the bugs found in §1.2 and §1.3, the lack
   of reviewer-facing comments here is probably what let those bugs ship.

The **inconsistency itself** is the issue. Pick one bar (the §1 bar) and
hold all files to it. 🟡 Open.

---

## 5. Security

- Supabase anon key in client = correct (RLS protects the data).
- Alpha Vantage / Gemini / NewsAPI keys are stored as Edge Function
  secrets, not exposed to the client = correct.
- `.env` is in `.gitignore`, `.env.example` warns against `VITE_` prefix
  on the secret keys = correct.
- Runtime env-var check in `callEdge()` via `assertEnv()` so a
  misconfigured local checkout fails fast with a clear error rather
  than sending malformed requests. ✅ Fixed.

**Not yet reviewed:**
- Whether Supabase RLS policies are actually configured on any tables
  that back the Edge Functions. The functions are currently stateless
  proxies, so this may be moot — worth confirming.
- Rate limiting on the Edge Functions themselves. A misbehaving or
  malicious client could exhaust the Alpha Vantage quota in one burst.
- CORS allowlist on the Edge Functions.

---

## 6. Verification status

### Verification pass 1 — complete ✅
The build runs end-to-end. First-pass manual testing surfaced five
concrete issues, all catalogued above:

- §1.5 stock search returns no results (silent failure)
- §1.6 news feed returns English-only across all locales
- §1.7 date input shows OS-locale placeholder regardless of UI language
- §1.8 10-panel grid leaves a ragged last row on desktop
- §2.6 glass-card `backdrop-filter` neutralised by `contain: paint`

All five are scheduled for the next fix round. See CHANGELOG round 5
for the verification pass itself.

### Still not covered

- **Unit tests.** No tests exist. `sentimentAnalysis.ts` and
  `technicalIndicators.ts` are pure functions and will get Vitest
  coverage after the verification-pass-1 fixes land — writing tests
  against code that's about to change on five fronts would be wasted
  effort.
- **Accessibility.** Keyboard navigation, screen reader semantics,
  color contrast. The sentiment badges (▲/▼/●) give redundant
  non-color signal, which is good, but this hasn't been audited.
- **Performance.** No profiling has been done. Recharts renders are a
  likely hotspot on the equity chart when indicators are toggled;
  `React.memo` boundaries and `useMemo` on derived data arrays are
  probably under-applied. Worth revisiting after the
  `contain: paint` → `contain: layout style` change in §2.6, since
  that change will also shift render cost.
- **Mobile UX.** The responsive grid works down to 1 column, but
  terminal density on small screens hasn't been evaluated against
  real usage — the AI assistant and portfolio panels in particular
  may need mobile-specific layouts.
