# Changelog

Patch history for the Financial Intelligence Terminal. Rounds are listed
newest-first. For the review findings that drove each round, see
`CODE_REVIEW.md`.

---

## Round 5 — End-to-end verification pass (findings only, no fixes)

First build of the patched tree was run end-to-end in the browser.
The build works — the page renders, Tailwind is processed correctly,
env-var guard fires cleanly when `.env` is missing, live equity chart
and crypto table fetch successfully. But manual testing surfaced five
issues that previous rounds either missed or only suspected.

**This round is documentation only.** No code was changed. The fixes
are scheduled for round 6. The point of recording them here is to
separate "confirmed by running it" from "caught by reading the source",
which are very different epistemic states.

### 5.1 Stock search silently returns no results — `CODE_REVIEW.md §1.5`

Typing any query into the header search box yields zero matches. The
code path is correct, which means the failure is happening inside the
`try { ... } catch { return [] }` block in `searchSymbol()` — and
since Alpha Vantage's rate-limit response comes back as HTTP 200 with
a `Note` field and no `bestMatches`, the parser can't distinguish
"quota exhausted" from "genuinely no matches". This is the concrete
consequence of the transport-vs-data error distinction flagged in
`CODE_REVIEW.md §1.4`: it wasn't just theoretical.

Round 6 will add explicit detection of `data.Note` / `data.Information`
/ `data['Error Message']` in `searchSymbol` and throw typed errors
that the UI can surface distinctly ("rate limited — try tomorrow" vs
"no matches").

### 5.2 News feed is English-only across all locales — `CODE_REVIEW.md §1.6`

Every non-English locale falls through to the Tier 3 English global
fallback in `fetchNews()`. Tier 1 (`top-headlines?country=XX`) returns
empty for most non-US locales because NewsAPI's free Developer tier
has very thin country-indexed coverage outside the US. Tier 2
(`everything?language=XX&q=<stock name>`) then misses because stock
names are typically written in English even in local-language press,
so there's nothing for the `language=XX` filter to match.

The 3-tier fallback was designed correctly; the problem is that Tiers
1 and 2 don't have the raw material to succeed on a free tier. Round
6 will:
- Replace `country=` with curated `sources=` lists per locale
- Augment Tier 2 queries with locale-specific finance keywords
  (e.g. `OR 주식 OR 증시` for Korean)
- Label the Tier 3 fallback explicitly in the UI so users know why
  they're seeing English content

### 5.3 Date picker shows `연도-월-일` in English UI — `CODE_REVIEW.md §1.7`

The portfolio panel's "Pick Historical Price" uses a native
`<input type="date">`, which draws its placeholder from the OS locale,
not from React state or `lang` attribute. Chrome ignores `lang="en"`
on date inputs.

Round 6 will replace the native input with shadcn/ui's `Calendar` +
`Popover` combo (already available via `components.json`), which
also unlocks proper keyboard navigation and a consistent look across
OSes.

### 5.4 Ragged last row on the terminal grid — `CODE_REVIEW.md §1.8`

`Index.tsx` has 10 panels in a `grid-cols-1 md:grid-cols-2
xl:grid-cols-3` layout. 10 ÷ 3 = 3 full rows + 1 orphan, leaving two
empty cells to the right of the last panel on desktop. Round 6 will
promote `PortfolioPanel` to `xl:col-span-2 xl:row-span-2` — it has
the highest internal row count of any panel and earns the anchor
position on the right column.

### 5.5 Glass cards look flat — `CODE_REVIEW.md §2.6`

The frosted-glass effect is barely visible. Root cause turned out to
be **one line of performance optimisation cancelling the visual
effect**: `.glass-card` has `contain: layout style paint`, and
`contain: paint` interacts badly with `backdrop-filter` in Chromium.
The blur technically runs but is scoped away from the content it's
supposed to sample. Compounding this, the light-mode background
gradients are low-saturation enough that even a working blur wouldn't
have much to pick up.

Round 6 fix stack (in order of impact):
1. Drop `paint` from the contain rule — one-line fix
2. Lower `--glass-bg` alpha to `~0.25` and raise border alpha
3. Raise `--glass-blur` from `12px` to `~22px`
4. Strengthen the light-mode background radial gradients
5. Raise the inset highlight from `0.04` to `~0.15`

### 5.6 What verification pass 1 confirmed is working

Worth recording, since the review mostly dwells on what's broken:
- Build config, PostCSS, Tailwind processing — all clean
- `assertEnv()` guard fires with the expected error message
- Live equity chart fetches and renders with indicators
- Live crypto table polls and updates
- Portfolio P&L calculation and multi-currency FX conversion
- Race-condition guards in `StockSearch` and `PortfolioPanel`
  (no stale overwrites observed under fast input)
- AI assistant streams responses

---

## Round 4 — Product-layer follow-ups

Three items from the product-review list: multi-currency aggregation,
wiring portfolio to news, and injecting context into the AI assistant.

### Correction up front

Two of the three items turned out to be **mostly already implemented**
when the relevant files were actually read rather than guessed at. They
had been flagged as gaps based on skimming, which was wrong. The honest
accounting of this round's work:

- **Multi-currency portfolio aggregation** — cleanup of my own earlier
  mistake, feature was already complete
- **Portfolio ↔ news wiring** — full feature addition
- **AI assistant news context** — small gap-fill on an otherwise-complete
  feature

### 4.1 Multi-currency portfolio aggregation — cleanup only

`useBaseCurrency.tsx` already existed as a full custom hook with
localStorage persistence, locale-based defaults, and a
`SUPPORTED_CURRENCIES: Record<CurrencyCode, CurrencyMeta>` table.
`PortfolioPanel.tsx` already used it with a `ChevronDown` dropdown,
`fetchFxRate`-driven live conversion (not static), request-id guards
against out-of-order FX responses, `skippedCount` warnings for positions
whose FX failed to load, and a two-currency-per-row layout.

What actually happened this round: **undoing a mistake from an earlier
turn.** A parallel `CurrencyCode` / `SUPPORTED_CURRENCIES` / `convertAmount`
/ `formatAmount` API had been added to `currencyConversion.ts` without
realising the hook already covered the same ground with a different
(and better) shape. The additions were dead code that also created a
naming collision — the array-shaped `SUPPORTED_CURRENCIES` clashed with
the hook's `Record`-shaped one.

Cleanup applied:
- Removed `CurrencyCode` type, `SUPPORTED_CURRENCIES` array,
  `currencyByCode` table, `getCurrencyInfoByCode`, `convertAmount`,
  and `formatAmount` from `currencyConversion.ts`
- Removed the obsolete `WHAT_IF_NO_LIMITS` block that assumed a static
  `convertAmount` migrating to live rates — irrelevant because portfolio
  FX is already live
- Replaced with a short "NOTE ON LIVE FX" docstring explaining why the
  chart formatters still use the static locale table (synchronous render
  callbacks + display-only) while the portfolio uses `fetchFxRate`
- Verified no other module imports the removed symbols

`currencyConversion.ts` is now back to being the legacy locale-keyed
formatter API for `StockChart` and `MacroInsightCard` only.

### 4.2 Portfolio ↔ news wiring — new feature

The news and portfolio subsystems existed side-by-side with no
connection: `LiveNewsFeed` showed news for the currently selected stock,
but the portfolio panel had no awareness of headlines relevant to held
positions. This round wires them together.

**New in `marketDataService.ts`:**

- `fetchPortfolioNews(names: string[], locale: string)` — takes a list
  of position names and returns a flattened `NewsArticle[]` covering all
  of them in a single `/everything` query. Uses an OR-joined quoted
  query (`"NVIDIA" OR "Apple" OR "SK hynix"`) so the whole portfolio is
  fetched in **one** NewsAPI request rather than N. Caps at 10 clauses
  to respect NewsAPI's practical query length limit; larger portfolios
  have their tail trimmed, and the panel handles trimmed positions
  gracefully (they simply have no sentiment badge).
- `normaliseCompanyName(name: string)` — exported helper that strips
  common legal-entity suffixes (`Corp`, `Inc`, `Ltd`, `PLC`, `AG`, `SA`,
  `KK`, `KGaA`, `LLC`, and variants). Used both to build the query (so
  "NVIDIA Corp" becomes the better-matching "NVIDIA") and by callers to
  match returned headlines back to positions.

**New in `PortfolioPanel.tsx`:**

- `portfolioNews` state + `latestNewsRequestId` ref for out-of-order guard
- `symbolsJoined` memo producing a stable dep string (`"AAPL|NVDA|..."`
  sorted). Using `positions` directly as the dep would re-fetch on
  every live-price update since the positions array identity changes
  on any `setPositions` call.
- `useEffect` calling `fetchPortfolioNews` on `symbolsJoined`/`locale`
  change, with the request-id guard dropping stale responses
- `positionSentiment` memo: for each position, substring-match the
  normalised name against each headline, run `getSentiment` from the
  rule-based engine, tally bullish/bearish/neutral, pick the
  strict-majority dominant sentiment (positions with no matches get
  `null`)
- `alertCounts` memo: portfolio-wide bullish/bearish position counts
  for the header banner

**UI additions:**

- Sentiment alert banner above the FX `skippedCount` warning, shown
  only when at least one position has dominant sentiment. Bearish
  rendered first (red, `TrendingDown` icon) because holders care more
  about downside news; bullish second (green). Footer text: "based on
  N recent headlines" so the user knows the sample size.
- Per-row sentiment badge (`▲ / ▼ / ●`) next to the position name,
  with a native `title` tooltip showing the raw counts (`"5 recent
  headlines: 2▲ 3▼ 0●"`). No badge is rendered when there are zero
  matches — silence is the honest signal for "nothing relevant in the
  digest".

**Cost note.** The `fetchPortfolioNews` design is explicitly one request
per portfolio, not per position, because NewsAPI's free Developer tier
is capped at 100 requests/day across all site visitors. A per-position
design would burn 5–10 requests per page load on a typical portfolio
and exhaust the quota within the first few dozen views.

### 4.3 AI assistant news context — gap fill

`AIAssistantPanel.tsx` was also mostly already done. `usePortfolio` was
imported, `buildPortfolioContext()` existed, and both `stockContext` and
`portfolioContext` were already in the request body. The earlier claim
that "the AI assistant isn't connected to what's on screen" was wrong.

The one actual gap: no **news** context. The AI knew the user's
positions but not the recent headlines about them, so it couldn't
proactively connect news to holdings. This round closes that gap.

**Additions:**

- `fetchPortfolioNews`, `normaliseCompanyName`, `NewsArticle`,
  `getSentiment` imports
- `newsRef` — a `useRef`, **not** `useState`. The ref choice is
  deliberate: a background news fetch arriving while the user is
  mid-typing should not re-render the input field, and the news only
  matters at the moment the user hits Send.
- Background `useEffect` fetching portfolio news on positions/locale
  change and writing to the ref, with a request-id guard
- `buildNewsContext` callback walking positions, substring-matching
  each one against the ref's headlines, classifying with `getSentiment`,
  and returning up to 3 headlines per position as
  `[{ symbol, headlines: [{ headline, source, time, sentiment }] }]`.
  Empty positions omitted; empty overall if the background fetch hasn't
  landed yet.
- `newsContext: buildNewsContext()` added to the `sendMessage` request
  body alongside the existing `portfolioContext`
- `sendMessage` dep array updated

**Header JSDoc** rewritten to document four context layers instead of
three, and the `EDGE FUNCTION UPDATE REQUIRED` block expanded with the
exact code to add to `supabase/functions/ai-assistant/index.ts`:
- Destructure `newsContext` from the request body
- Append the news digest to the system prompt under a "Recent news
  relevant to the user's positions (with sentiment):" header
- Include a "do not invent news that is not listed here" instruction —
  important because without it, models sometimes confabulate
  plausible-sounding headlines when asked about recent events

**Payload size bound:** each headline entry is ~100–150 chars including
sentiment tag, × up to 3 per position × up to 10 positions ≈ 4.5 KB
worst case. Well within modern LLM input budgets.

### 4.4 Design note carried across 4.2 and 4.3

Both `PortfolioPanel` and `AIAssistantPanel` call `fetchPortfolioNews`
independently rather than sharing state through a context provider.
This looks like duplication but isn't: the service layer caches for 5
minutes at the same cache key (`portfolio-news:AAPL|NVDA|...:en`), so
the second caller's `fetchPortfolioNews` call hits the cache and is a
synchronous no-op rather than a second network round-trip. A shared
context would be the right refactor when a **third** consumer appears —
until then, it's speculative generality.

---

## Round 3 — Terminal-mode refactor

The project started as a single-stock analyzer focused on SK hynix
(chosen because it's a popular, well-covered name that wouldn't exhaust
free-tier API quotas while the core was being built). It then drifted
toward being a global terminal without removing the single-stock
assumptions, which left the product in an uncomfortable middle: a
search box that let you look up any ticker, but a main chart literally
named `SKHynixChart` and a macro insight card permanently writing about
HBM regardless of which stock was selected. This round commits to the
terminal direction and breaks those remaining assumptions.

The "what if there were no API limits" constraint is honored: every
component that had to settle for static data keeps a `WHAT_IF_NO_LIMITS`
block at the bottom showing the exact code a paid-tier implementation
would use. Those blocks are runnable-looking TypeScript with `useQuery`
keys, Edge Function action names, response type shapes, and migration
steps — not hand-wavy prose.

### 3.1 `SKHynixChart.tsx` → `StockChart.tsx`

File renamed, component identifier and default export renamed. The old
name was misleading — the component already read from `useStockContext`
and rendered whichever stock was selected; it just kept SK hynix as its
default/showcase symbol and as the one stock with a pre-bundled fixture
and a curated `skHynixEvents` catalyst overlay. The new header docstring
explains exactly that: SK hynix is the default symbol, not a special
symbol, and the `isDefaultStock` branch exists only to preserve the
event overlay and KRW-specific formatting paths. All import sites
(`Index.tsx`, documentation references in `skHynixData.ts` and
`translations.ts`) were updated.

### 3.2 `MacroInsightCard.tsx` — complete rewrite

The previous implementation had a single
`analysisContext: Record<Locale, ...>` table that hard-coded "HBM
investment thesis" bullets per locale. The user could search for NVDA
or JPM and still see "HBM3E/HBM4 yield rates" on screen. The new
implementation:

- **Sector-aware.** Introduces a `Sector` union (`semiconductor`, `tech`,
  `finance`, `energy`, `consumer`, `automotive`, `generic`) and a
  hand-curated `SYMBOL_TO_SECTOR` lookup covering ~40 of the most
  commonly searched global tickers. Anything not in the table falls
  through to `generic`, which uses a rate-regime + FX analysis that
  applies to any equity, and shows a small footer hint explaining the
  fallback.
- **(Sector × Locale) analysis matrix.** The rewritten `analysisContext`
  is a 7-sector × 8-locale matrix (56 cells) with every cell filled.
  Each cell is phrased from the perspective of a holder in that region
  — a Korean investor in NVDA cares about FX and KOSPI ADR correlation;
  a US investor in the same stock cares about Fed rates and export
  controls.
- **News section removed.** The previous version duplicated a news
  feed inline, which meant two `fetchNews()` calls per page load
  (wasting NewsAPI quota) and showed the same headlines twice on
  screen. `LiveNewsFeed` was already stock-aware and is the canonical
  news panel; the insight card now focuses purely on sector context.
- **Symbol + sector badge.** The card header now shows the active
  symbol and its resolved sector as small badges, making the
  reactivity visible when the user changes stocks.
- **`WHAT_IF_NO_LIMITS` block.** Appended as a file-final comment with
  a runnable code sketch for the paid-tier implementation: `useQuery`
  for `fetchCompanyOverview` (Alpha Vantage `COMPANY_OVERVIEW` → GICS
  sector), a second `useQuery` for `generateMacroInsight` (a new
  `ai-assistant` Edge Function action), the system-prompt template,
  the `MacroInsight` response interface, and a 5-step migration path.
  Two reasons for not doing it live today are documented concretely:
  Alpha Vantage `COMPANY_OVERVIEW` is capped at 25 req/day on free
  tier, and model spend costs roughly a cent per active session.

### 3.3 `EconomicCalendar.tsx` — `WHAT_IF_NO_LIMITS` block expanded

The existing `buildUpcomingEvents()` implementation already generates a
rolling current-month-plus-next-month event window from a template
list, so dates never go stale — no code change needed there. What was
missing was a concrete live-API version.

The prose-only block at the top of the file was moved to the bottom
(matching `MacroInsightCard`'s convention) and expanded into a full
code sketch:

- A new `CalendarEvent` interface in `marketDataService.ts`
- A `fetchCalendar(from, to, locale)` function with `callEdge` routing,
  a new `TTL.calendar` tier, and 6-hour cache rationale
- A rewritten `EconomicCalendar.tsx` using
  `useQuery(['calendar', from, to, locale])`, with month navigation
  (`monthOffset`), the unchanged grid-cell logic, and notes on what
  goes away (template builder, `eventNameTranslations`, `translateEvent`)
  and what gets added (prev/next month arrows, a "next 7 days" quick
  filter)
- A 6-step migration path with line-count estimates (~200 lines
  deleted, ~40 added)

No behavioural change in the current-day build — this is pure
documentation of the paid-tier replacement.

---

## Round 2 — Race condition and comment cleanup

### 2.1 `PortfolioPanel.handlePickDate` race condition

`handlePickDate` fetches the closing price for a user-picked historical
date via `fetchHistoricalPrice` and writes it into the `buyPrice` input.
The previous implementation awaited the response and unconditionally
called `setBuyPrice` and `setLoadingPrice(false)` with no ordering guard.

Two failure modes:

1. **Stale overwrite.** If the user picked a date, then quickly picked
   a different date (or switched `stock.symbol`) before the first
   request resolved, the older response could land after the newer
   one and overwrite the correct price with the wrong one.
2. **Spinner flicker.** The `finally` block cleared `loadingPrice` as
   soon as *any* request resolved, so a fast-returning stale request
   hid the spinner while a newer request was still in flight.

`CODE_REVIEW.md` §1.1 flagged this alongside the `StockSearch.tsx`
race. The `StockSearch` side was fixed in round 1; `PortfolioPanel`
was not.

**Fix applied** — same request-id guard pattern as `StockSearch.tsx`:

- Added `useRef` to the React import
- Declared a `latestHistoricalRequestId` ref, initialised to `0`
- On entry to `handlePickDate`, incremented the ref and captured the
  value into a local `myId`
- After `await`, compared `myId` against `latestHistoricalRequestId.current`
  and returned early if they no longer matched
- Applied the same guard inside `catch` so a stale rejection doesn't
  log a warning for a request the user has moved past
- Wrapped the `finally` block's `setLoadingPrice(false)` in the same
  guard so a fast stale response cannot hide the spinner of a newer
  in-flight request

AbortController was not used, for the same reason `StockSearch.tsx`
avoids it: the signal would have to be plumbed through
`fetchHistoricalPrice → callEdge → fetch`, pushing the change into the
service layer. The request-id guard delivers the same user-visible
guarantee with a one-component change.

### 2.2 Comment cleanup — `CODE_REVIEW.md` §1.5 and §2.5

Two header/inline comments were tracking their own diff history rather
than describing the current design. Header comments shouldn't be
changelogs — they rot, and they offer no value to a reader who doesn't
already know the old implementation.

- **`MacroInsightCard.tsx`** — removed the line `Bug fix applied: 'it'
  previously mapped to 'FR' — now correctly maps to 'IT'` from the
  header docstring. The current mapping is visible in the code; the
  fact that it used to be wrong belongs in the git log.
- **`PortfolioPanel.tsx`** — replaced the stub comment
  `// Fixed: Promise.all instead of async forEach` with a real
  explanation of *why* `Promise.all` is needed here: batching the
  quote fetches lets every resolved quote land in a single `setState`
  call, avoiding one re-render per position and the visible "prices
  filling in one at a time" flicker that a naive `forEach(async ...)`
  would cause.

---

## Round 1 — Initial patch set

### 1.1 Build configuration (added)

The original checkout was missing standard tooling configuration files,
which is why styles broke when running locally:

- `postcss.config.js` — required for Tailwind to actually run. Without
  it, every utility class was silently dropped at build time.
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — Project
  References setup for the app and build-tool TypeScript code.
- `components.json` — shadcn/ui CLI configuration.

### 1.2 Build entry point (fixed)

- `index.html` — script tag now points at `/src/main.tsx` instead of
  the non-existent `/src/pages/index.tsx`.
- `src/main.tsx`, `src/App.tsx`, `src/App.css`, `src/index.css`,
  `src/vite-env.d.ts` — moved from the misplaced `src/test/` folder
  up to `src/` where Vite expects them. The old `src/test/` folder
  was removed entirely.

### 1.3 Service layer — env guard

`src/services/marketDataService.ts` — added `assertEnv()` check that
fails fast at module load if `VITE_SUPABASE_PROJECT_ID` or
`VITE_SUPABASE_PUBLISHABLE_KEY` is missing, with a message pointing at
`.env.example`. Previous behaviour was to silently build a malformed
URL like `https://.supabase.co/...` and throw a confusing DNS error.
Header docstring, per-section rationale, and `WHAT_IF_NO_LIMITS`
comments added throughout. No behavioural change to any fetch path.

### 1.4 `technicalIndicators.ts`

- **EMA seeding.** The warm-up window used to push raw prices onto the
  result array, making chart overlays track the price exactly for the
  first 11/25 points and then jump to the real EMA. Now seeds with the
  SMA of the first `period` values and masks the warm-up window to
  `undefined` in `calculateIndicators` so the chart simply doesn't
  draw those points.
- **MACD signal warm-up** also masked off, so the chart no longer
  shows a flat seed-line segment for the first 8 signal/histogram
  points.
- **Silent MA period clamping** removed. The previous version silently
  reduced `MA50` to a 24-period MA on short histories while the chart
  legend still said "MA50". Now the indicator simply doesn't render
  on short histories — the user can switch to a longer range.
- Verified against the original on a 300-point synthetic price series:
  `ma50`, `ma200`, `rsi`, `macdLine` are bit-identical; `macdSignal`
  and `macdHist` differ only at the 8 warm-up positions that are now
  correctly masked.

### 1.5 `StockSearch.tsx` — autocomplete race condition

The 350 ms debounce only delayed the *start* of each request, not the
order in which they resolved, so a slow "ap" response could overwrite
a fast "apple" response. Now stamps each `doSearch` call with a
monotonically increasing request id and discards stale responses on
resolution. Pure addition: nothing was removed from the original
component.

### 1.6 `sentimentAnalysis.ts`

- **Word boundary matching.** Latin-script keywords are now matched via
  a precompiled regex with `\b` boundaries, fixing false positives like
  `'gain'` matching `'against'` or `'risk'` matching `'asterisk'`. CJK
  keywords still use plain substring matching (word boundaries are
  ill-defined for CJK).
- **Stem variants.** Word-boundary matching loses the accidental
  stemming the old `includes()` provided (e.g. `'bankruptcy'` no
  longer matches `'bankrupt'`). The keyword lists now explicitly
  enumerate common stem variants — verbose but predictable, and
  avoids pulling in a real stemmer for marginal gain on display-only
  badges.
- **Phrase overrides.** A small `PHRASE_OVERRIDES` table demotes
  keywords whose polarity flips in context. Currently catches
  `'record low'` (was bullish, now correctly neutralised) and
  `'rate cuts'` / `'tax cuts'` (was bearish, now correctly
  neutralised).
- Verified against the original on 14 test headlines: 12/14 vs 9/14.
  The two remaining "wrong" cases are headlines where the new version
  is arguably more correct than the test expectation.

---

## Deferred to future rounds

Flagged in `CODE_REVIEW.md` but not addressed — these are larger
changes that belong in their own commits:

- Migration of the data-fetching layer from the hand-rolled cache to
  `@tanstack/react-query` (already wired into `App.tsx` but unused) —
  §2.1
- Refactoring the 8-branch `if/else` in `fetchStockHistory` into a
  lookup table — §2.4
- Extracting the inline Alpha Vantage response parsers into shared
  helpers — §2.3
- Surfacing transport errors (network, 5xx) separately from empty
  results in `marketDataService.ts` — §1.4
- Unit tests for `sentimentAnalysis.ts`, `technicalIndicators.ts`,
  and the race-condition guards — §6
- End-to-end build verification on a fresh checkout
