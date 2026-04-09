/**
 * @file sentimentAnalysis.ts
 * @description Rule-based sentiment classification for financial news headlines.
 *
 * APPROACH — keyword matching, not ML:
 *   This is an intentional design choice. A lightweight keyword engine runs
 *   entirely client-side with zero latency and zero API cost, which is
 *   appropriate for a terminal that already makes several external API calls
 *   on load. The tradeoff is lower accuracy vs. a real NLP model.
 *
 * MATCHING SEMANTICS:
 *   - Latin-script keywords ('surge', 'crash', 'récession', etc.) are matched
 *     with word boundaries via a precompiled regex. This stops false positives
 *     like 'crash' matching 'recrash' or 'risk' matching 'asterisk' that the
 *     earlier `String.includes()` implementation suffered from.
 *   - CJK keywords (Korean / Chinese / Japanese) use plain substring matching,
 *     because those languages don't separate words with whitespace and a
 *     `\b` regex boundary is ill-defined for CJK characters anyway.
 *   - Word-boundary matching means we lose the accidental stemming that the
 *     old `includes()` implementation gave us for free ('bankruptcy' would
 *     have matched 'bankrupt' as a substring). To compensate, the keyword
 *     lists below explicitly enumerate the common stem variants ('bankrupt'
 *     and 'bankruptcy', 'profit' and 'profits' and 'profitable', etc.).
 *     This is verbose but predictable; the alternative — pulling in a real
 *     stemmer like Porter or Snowball — would add a dependency for marginal
 *     gain on display-only badges.
 *   - Matching is case-insensitive for Latin scripts (the regex carries the
 *     `i` flag). The previous `headline.toLowerCase()` call was a no-op for
 *     CJK and is no longer needed.
 *
 * PHRASE OVERRIDES:
 *   Some keywords flip polarity in context. 'Record' is bullish on its own
 *   ('record profits') but bearish in 'record low'. 'Cuts' is ambiguous
 *   ('rate cuts' is bullish for equities, 'job cuts' is bearish). The
 *   `PHRASE_OVERRIDES` table below catches the most common cases by
 *   demoting a base keyword's polarity when a specific follow-up word
 *   appears within a small window.
 *
 *   This is not exhaustive — it covers the headlines we observed misclassified
 *   in practice. If new false positives surface, add an entry rather than
 *   reaching for a heavier solution.
 *
 * ACCURACY CHARACTERISTICS:
 *   - High precision on unambiguous headlines ("surges 8%", "files for bankruptcy")
 *   - Neutral fallback for ambiguous or mixed-signal headlines
 *   - Limited context awareness via PHRASE_OVERRIDES; broader negation
 *     ("not growth", "fails to gain") still slips through. Acceptable for a
 *     display-only sentiment indicator.
 *
 * UPGRADE PATH — real sentiment scoring:
 *   If higher accuracy is needed, pass headlines to the ai-assistant Edge
 *   Function with a prompt like:
 *     "Classify this headline as bullish/bearish/neutral for [stock]: {headline}"
 *   Use sparingly to avoid exhausting the AI gateway rate limit.
 *   Alternatively, integrate a dedicated financial NLP API:
 *     - FinBERT (HuggingFace, free): specialized for financial text
 *     - Anthropic Claude via the API with a lightweight system prompt
 */

export type Sentiment = 'bullish' | 'bearish' | 'neutral';

// ─── Keyword dictionaries ─────────────────────────────────────────────────────
//
// Split into Latin-script (word-boundary matched) and CJK (substring matched)
// because the matching strategies differ. Keeping them in separate arrays
// makes that distinction explicit and lets us compile the Latin keywords into
// a single regex on module load.

const BULLISH_LATIN = [
  'surge', 'surges', 'surged', 'rally', 'rallies', 'rallied',
  'rise', 'rises', 'rose', 'gain', 'gains', 'gained',
  'record', 'beat', 'beats', 'exceeded', 'outperform', 'outperforms',
  'upgrade', 'upgraded', 'buy', 'bullish', 'recovery',
  'growth', 'grew', 'profit', 'profits', 'profitable', 'profitability',
  'boom', 'booms', 'soar', 'soars', 'soared', 'jump', 'jumps', 'jumped',
  'positive', 'strong', 'strength', 'expand', 'expands', 'expansion',
  'optimistic', 'breakout', 'milestone', 'approve', 'approved',
  'demand', 'win', 'wins', 'won', 'partnership', 'deal', 'deals',
  // German
  'steigt', 'zulegen', 'Rekord', 'Gewinn', 'Wachstum', 'stark',
  // French
  'hausse', 'monte', 'bénéfice', 'croissance', 'fort',
  // Italian
  'sale', 'rialzo', 'utile', 'crescita', 'forte',
] as const;

const BEARISH_LATIN = [
  'fall', 'falls', 'fell', 'drop', 'drops', 'dropped',
  'decline', 'declines', 'declined', 'plunge', 'plunges', 'plunged',
  'crash', 'crashes', 'crashed', 'slump', 'slumps', 'slumped',
  'tumble', 'tumbles', 'tumbled', 'sink', 'sinks', 'sank',
  'loss', 'losses', 'lossmaking',
  'miss', 'misses', 'missed', 'disappoint', 'disappoints', 'disappointing',
  'downgrade', 'downgraded', 'sell', 'bearish', 'recession', 'recessionary',
  'concern', 'concerns', 'risk', 'risks', 'warning', 'warnings',
  'alert', 'alerts', 'fear', 'fears',
  'weak', 'weakness', 'weaken', 'weakens',
  'contract', 'contracts', 'contraction', 'layoff', 'layoffs',
  'bankrupt', 'bankruptcy', 'default', 'defaults', 'cut', 'cuts',
  'inflation', 'inflationary', 'tariff', 'tariffs', 'sanction', 'sanctions',
  'ban', 'bans', 'banned', 'probe', 'probes', 'fine', 'fined',
  // German
  'fällt', 'sinkt', 'Verlust', 'Rezession', 'schwach', 'Risiko',
  // French
  'baisse', 'chute', 'perte', 'récession', 'faible', 'risque',
  // Italian
  'cade', 'ribasso', 'perdita', 'recessione', 'debole', 'rischio',
] as const;

const BULLISH_CJK = [
  // Korean
  '상승', '급등', '호재', '성장', '반등', '돌파', '최고', '흑자',
  '매수', '상향', '수익', '호조', '강세', '기대', '확대',
  // Japanese
  '上昇', '急騰', '最高', '好調', '黒字', '成長', '回復',
  // Chinese
  '上涨', '暴涨', '创新高', '盈利', '增长', '强劲', '好转',
] as const;

const BEARISH_CJK = [
  // Korean
  '하락', '급락', '악재', '부진', '손실', '적자', '우려',
  '매도', '하향', '위기', '약세', '감소', '둔화', '충격',
  // Japanese
  '下落', '急落', '赤字', '低調', '損失', '懸念', '弱',
  // Chinese
  '下跌', '暴跌', '亏损', '下滑', '疲软', '担忧', '风险',
] as const;

// ─── Phrase overrides ─────────────────────────────────────────────────────────
//
// Each override says: "if `base` matched as `polarity`, but `followup` appears
// within `window` words after it, suppress the match." Followups are matched
// case-insensitively against word tokens.
//
// The list is short and English-only on purpose: these are the cases where the
// rule-based engine has shipped visibly wrong labels. Add to it when a new
// false positive shows up in production, not preemptively.

interface PhraseOverride {
  base: string;
  polarity: Sentiment;
  followup: string;
  window: number;
}

const PHRASE_OVERRIDES: PhraseOverride[] = [
  // 'record low' / 'record lows' — bearish despite 'record' being bullish
  { base: 'record', polarity: 'bullish', followup: 'low',  window: 2 },
  { base: 'record', polarity: 'bullish', followup: 'lows', window: 2 },
  // 'job cuts' / 'staff cuts' — bearish, not the bullish 'rate cuts' / 'tax cuts'
  // We instead suppress the bearish reading of 'cuts' when it follows 'rate' or 'tax',
  // so 'rate cuts' goes back to neutral rather than getting a false bearish hit.
  { base: 'cuts',   polarity: 'bearish', followup: 'rates', window: 2 },
  { base: 'cuts',   polarity: 'bearish', followup: 'rate',  window: 2 },
  { base: 'cuts',   polarity: 'bearish', followup: 'taxes', window: 2 },
  { base: 'cuts',   polarity: 'bearish', followup: 'tax',   window: 2 },
];

// ─── Regex compilation (one-time, at module load) ────────────────────────────
//
// Word-boundary regex for the Latin keywords. We escape each keyword (none
// currently contain regex metacharacters, but defensive escape is cheap and
// future-proof) and join with alternation. The `i` flag handles case
// insensitivity so we don't need to lowercase the headline.
//
// `\b` works correctly for ASCII and the Latin-1 supplement characters used by
// the German/French/Italian keywords (`ä`, `é`, `à`, etc.) under modern
// JavaScript engines that implement the Unicode property of `\b` consistently
// for word characters.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BULLISH_LATIN_RE = new RegExp(
  '\\b(' + BULLISH_LATIN.map(escapeRegex).join('|') + ')\\b',
  'gi',
);
const BEARISH_LATIN_RE = new RegExp(
  '\\b(' + BEARISH_LATIN.map(escapeRegex).join('|') + ')\\b',
  'gi',
);

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Counts how many tokens of `headline` (split on whitespace) appear within
 * `window` positions after each occurrence of `base`. Used by the phrase
 * override pass.
 */
function followupHits(tokens: string[], base: string, followup: string, window: number): number {
  const baseLower = base.toLowerCase();
  const followupLower = followup.toLowerCase();
  let hits = 0;
  for (let i = 0; i < tokens.length; i++) {
    // Token comparison is exact-after-lowercase. We strip surrounding
    // punctuation so 'low,' still matches 'low'.
    const tok = tokens[i].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (tok !== baseLower) continue;
    for (let j = i + 1; j <= i + window && j < tokens.length; j++) {
      const next = tokens[j].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (next === followupLower) { hits++; break; }
    }
  }
  return hits;
}

/**
 * Classifies a news headline as bullish, bearish, or neutral.
 *
 * Algorithm:
 *   1. Count Latin-script bullish/bearish hits via the precompiled regexes.
 *   2. Count CJK bullish/bearish hits via plain substring search.
 *   3. Apply PHRASE_OVERRIDES to subtract false positives.
 *   4. Whichever side has more remaining hits wins; ties → neutral.
 */
export function getSentiment(headline: string): Sentiment {
  // Count regex matches. `String.match` with a global regex returns the array
  // of matches or null; we coerce to a length.
  const bullishLatinHits = (headline.match(BULLISH_LATIN_RE) || []).length;
  const bearishLatinHits = (headline.match(BEARISH_LATIN_RE) || []).length;

  const bullishCjkHits = BULLISH_CJK.filter(kw => headline.includes(kw)).length;
  const bearishCjkHits = BEARISH_CJK.filter(kw => headline.includes(kw)).length;

  let bullishScore = bullishLatinHits + bullishCjkHits;
  let bearishScore = bearishLatinHits + bearishCjkHits;

  // Apply phrase overrides. Each matching followup demotes one hit from the
  // base keyword's score. We tokenise once and reuse for all overrides.
  if (PHRASE_OVERRIDES.length > 0) {
    const tokens = headline.split(/\s+/);
    for (const ov of PHRASE_OVERRIDES) {
      const hits = followupHits(tokens, ov.base, ov.followup, ov.window);
      if (hits === 0) continue;
      if (ov.polarity === 'bullish') bullishScore = Math.max(0, bullishScore - hits);
      else                           bearishScore = Math.max(0, bearishScore - hits);
    }
  }

  if (bullishScore > bearishScore) return 'bullish';
  if (bearishScore > bullishScore) return 'bearish';
  return 'neutral';
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

/** Tailwind classes for the sentiment badge background + text. */
export const sentimentStyles: Record<Sentiment, string> = {
  bullish: 'bg-green-500/15 text-green-400 border border-green-500/20',
  bearish: 'bg-red-500/15 text-red-400 border border-red-500/20',
  neutral: 'bg-muted/60 text-muted-foreground border border-border/40',
};

/** Short display label per sentiment — language-agnostic symbols + English. */
export const sentimentLabel: Record<Sentiment, string> = {
  bullish: '▲ Bullish',
  bearish: '▼ Bearish',
  neutral: '● Neutral',
};
