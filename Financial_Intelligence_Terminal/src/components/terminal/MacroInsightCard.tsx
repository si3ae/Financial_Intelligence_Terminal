/**
 * @file MacroInsightCard.tsx
 * @description Sector-aware macro insight panel. Reacts to the currently
 * selected stock (via `useStockContext`) and displays a short thematic
 * analysis tuned to the stock's sector and the user's locale.
 *
 * OVERVIEW:
 *   The card shows two things: a sector-appropriate thematic title and two
 *   bullet points describing what macro forces a holder of that sector
 *   should be watching from the user's regional perspective. When the user
 *   changes stocks via `StockSearch`, the card re-renders against the new
 *   sector. When the user changes locale, the card re-renders in the new
 *   language.
 *
 *   This is the terminal-mode replacement for the earlier SK-hynix-only
 *   version of this card. The previous version hard-coded an "HBM / SK hynix
 *   investment thesis" per locale, which was appropriate when the project
 *   was a single-stock analyzer but broke the terminal illusion the moment
 *   the user searched for a different ticker.
 *
 * SECTOR RESOLUTION:
 *   Sector is looked up from the hand-maintained `SYMBOL_TO_SECTOR` table
 *   below, which covers the ~40 most commonly searched global tickers
 *   (mega-cap US tech, major Korean/Japanese/European issues, big banks,
 *   oil supermajors). Anything not in the table falls back to the `generic`
 *   sector, which uses a broad "macro forces and rate regime" analysis that
 *   applies to any equity.
 *
 *   The table is intentionally small. The proper way to do this is to call
 *   Alpha Vantage's COMPANY_OVERVIEW endpoint once per symbol and read the
 *   `Sector` field — but doing so costs one API call per stock-change event,
 *   which would exhaust the free tier within minutes of active use. See
 *   WHAT_IF_NO_LIMITS at the bottom of this file for the live-sector
 *   implementation that would replace the static table.
 *
 * DATA SOURCES:
 *   - Analysis text: static, defined in `analysisContext` below. The matrix
 *     is (sector × locale) so adding a new locale or a new sector is a
 *     single-row addition. CJK locales have full coverage; European locales
 *     cover the sectors most relevant to their market.
 *   - News feed: NOT rendered here. News is the responsibility of
 *     `LiveNewsFeed.tsx`, which is already stock-aware and uses the same
 *     NewsAPI Edge Function action. An earlier version of this card
 *     duplicated that feed inline, which wasted NewsAPI quota (two fetches
 *     per page load) and showed the same headlines twice on screen.
 *
 * LOCALE → COUNTRY MAPPING:
 *   Each locale maps to a 2-letter ISO country code displayed in the card
 *   header as a regional anchor for the analysis.
 *
 * DEPENDENCIES:
 *   - `useStockContext` must be wrapped around this component (it is — see
 *     Index.tsx's provider tree).
 *   - No external network calls. This card is fully client-side; sector
 *     lookup is a synchronous object access.
 */
import { useLanguage } from '@/i18n/LanguageContext';
import { useStock } from '@/hooks/useStockContext';
import { type Locale } from '@/i18n/translations';
import { Lightbulb } from 'lucide-react';

// ─── Locale → country code (for header badge) ──────────────────────────────

const localeToCountry: Record<Locale, string> = {
  ko: 'KR', en: 'US', zh: 'CN', ja: 'JP', gb: 'GB', de: 'DE', fr: 'FR', it: 'IT',
};

// ─── Sector taxonomy ───────────────────────────────────────────────────────
//
// Small, deliberate taxonomy — enough to differentiate the macro lens per
// stock without drowning in GICS sub-industries. If a new sector is added
// here, every locale in `analysisContext` must also grow a corresponding
// entry (TypeScript enforces this via the `Record<Sector, ...>` type).

type Sector =
  | 'semiconductor'
  | 'tech'
  | 'finance'
  | 'energy'
  | 'consumer'
  | 'automotive'
  | 'generic';

// ─── Symbol → sector lookup ────────────────────────────────────────────────
//
// Hand-curated table of the symbols most likely to show up in the search box.
// Any ticker not in this table falls through to the `generic` sector, which
// still produces a sensible analysis (rate regime + liquidity + local
// currency) rather than an error state.
//
// Keyed by uppercase symbol. Alpha Vantage returns `.KOR`, `.TYO`, `.PAR`
// etc. suffixes for non-US listings; we match on the full suffixed form so
// 005930.KOR (Samsung Electronics) doesn't collide with anything on the NYSE.

const SYMBOL_TO_SECTOR: Record<string, Sector> = {
  // Semiconductors (global)
  '000660.KOR': 'semiconductor',   // SK hynix — the original showcase
  '005930.KOR': 'semiconductor',   // Samsung Electronics
  'NVDA':       'semiconductor',
  'AMD':        'semiconductor',
  'INTC':       'semiconductor',
  'TSM':        'semiconductor',
  'AVGO':       'semiconductor',
  'MU':         'semiconductor',
  'QCOM':       'semiconductor',
  'ASML':       'semiconductor',   // Dutch EUV monopoly
  '8035.TYO':   'semiconductor',   // Tokyo Electron
  '6857.TYO':   'semiconductor',   // Advantest

  // Tech (non-semi)
  'AAPL':  'tech',
  'MSFT':  'tech',
  'GOOGL': 'tech',
  'GOOG':  'tech',
  'META':  'tech',
  'AMZN':  'tech',
  'NFLX':  'tech',
  'ORCL':  'tech',
  'CRM':   'tech',
  '035420.KOR': 'tech',  // NAVER

  // Finance
  'JPM':  'finance',
  'BAC':  'finance',
  'GS':   'finance',
  'MS':   'finance',
  'WFC':  'finance',
  'C':    'finance',
  'HSBA.LON': 'finance',
  'BNP.PAR':  'finance',
  '8306.TYO': 'finance', // MUFG

  // Energy
  'XOM':      'energy',
  'CVX':      'energy',
  'BP.LON':   'energy',
  'SHEL.LON': 'energy',
  'TTE.PAR':  'energy',

  // Automotive
  'TSLA':     'automotive',
  'F':        'automotive',
  'GM':       'automotive',
  '7203.TYO': 'automotive', // Toyota
  'VOW3.DEX': 'automotive', // Volkswagen

  // Consumer
  'WMT': 'consumer',
  'KO':  'consumer',
  'PG':  'consumer',
  'MCD': 'consumer',
  'NKE': 'consumer',
};

function sectorFor(symbol: string): Sector {
  return SYMBOL_TO_SECTOR[symbol.toUpperCase()] ?? 'generic';
}

// ─── Analysis matrix: (sector × locale) ────────────────────────────────────
//
// Each cell is { title, points }. Title is the thematic anchor shown above
// the bullets; `points` is exactly two short sentences because the card is
// meant to be scannable in under five seconds. More than two bullets and
// the user stops reading.
//
// Design notes on the content:
//   - Each entry is phrased from the perspective of a holder in that region.
//     A US investor in NVDA cares about Fed rates and export controls; a
//     Korean investor in the same stock cares about FX and KOSPI correlation.
//   - Where a locale doesn't have strong specificity for a sector (e.g. the
//     French view of US consumer staples), we fall back to a generic
//     "global macro + local FX" frame rather than inventing region-flavour
//     that isn't there.

interface AnalysisCell {
  title: string;
  points: string[];
}

const analysisContext: Record<Sector, Record<Locale, AnalysisCell>> = {
  semiconductor: {
    ko: {
      title: 'HBM 주도권 및 국내 수급',
      points: [
        'HBM3E/HBM4 수율 및 용인 클러스터 진척도',
        '한은 금리 기조에 따른 원화 변동성',
      ],
    },
    en: {
      title: 'AI Capex Cycle & Export Controls',
      points: [
        'NVIDIA GPU roadmap alignment with HBM supply cadence',
        'US export-control scope changes on advanced-node equipment',
      ],
    },
    zh: {
      title: '晶圆厂运营与监管风险',
      points: [
        '本地DRAM需求及国产替代进程',
        '美国芯片法案对在华投资和设备进口的限制',
      ],
    },
    ja: {
      title: 'サプライチェーンと為替リスク',
      points: [
        'EUVレジスト等素材サプライヤーの安定性',
        '円安が設備輸入コストへ与える影響',
      ],
    },
    gb: {
      title: 'AI Capex & ARM Licensing',
      points: [
        'Sterling data-center buildout and cloud provider commitments',
        'ARM licensing revenue as a read-through on mobile + AI silicon demand',
      ],
    },
    de: {
      title: 'EU Chips Act & Automobilnachfrage',
      points: [
        'EV-Halbleiternachfrage von VW, BMW und Mercedes-Benz',
        'EU-subventionierter Fab-Aufbau: Zeitplan und Finanzierungsfortschritt',
      ],
    },
    fr: {
      title: 'Souveraineté Numérique UE',
      points: [
        "Initiatives cloud souverain et investissements IA à l'échelle UE",
        'Impact de la politique BCE sur les multiples du secteur semi-conducteur',
      ],
    },
    it: {
      title: 'Semiconduttori & Politica UE',
      points: [
        'Domanda automotive italiana per chip di grado EV',
        "Allocazione EU Chips Act e partecipazione dell'Italia",
      ],
    },
  },

  tech: {
    ko: {
      title: '빅테크 실적 시즌 및 환헤지',
      points: [
        '미국 빅테크 실적과 국내 ADR 연동성',
        '원달러 환율이 해외주식 평가손익에 미치는 영향',
      ],
    },
    en: {
      title: 'Mega-cap Earnings & Fed Regime',
      points: [
        'Mega-cap margin trajectory vs. capex growth — the AI spend ROI question',
        'Long-duration equity sensitivity to the Fed terminal rate',
      ],
    },
    zh: {
      title: '互联网监管与平台经济',
      points: [
        '平台经济监管方向及反垄断执法节奏',
        '美国ADR退市风险对港股科技板块的传导',
      ],
    },
    ja: {
      title: '米国テック決算と円相場',
      points: [
        '米国ビッグテック決算の日経連動と外需ETFへの資金流入',
        '円安による海外売上比率の高い銘柄へのプラス影響',
      ],
    },
    gb: {
      title: 'US Tech Exposure via FTSE',
      points: [
        'FTSE-listed tech proxies and ADR liquidity during US market hours',
        'Sterling-dollar rate effect on translated earnings from US mega-caps',
      ],
    },
    de: {
      title: 'US Tech & EUR Exposure',
      points: [
        'DAX-Tech (SAP, Infineon) Korrelation mit US-Mega-Caps',
        'EUR/USD-Effekt auf importierte Cloud- und SaaS-Kosten',
      ],
    },
    fr: {
      title: 'Tech US & Souveraineté Cloud',
      points: [
        'Exposition du CAC 40 aux revenus cloud américains',
        'Investissements dans les alternatives européennes (OVHcloud, Scaleway)',
      ],
    },
    it: {
      title: 'Tech Globale & Euro',
      points: [
        'Correlazione del FTSE MIB con i mega-cap tech statunitensi',
        "Effetto EUR/USD sui costi cloud e SaaS importati",
      ],
    },
  },

  finance: {
    ko: {
      title: '금리 환경 및 은행 수익성',
      points: [
        '연준/한은 금리차이와 순이자마진(NIM) 흐름',
        '상업용 부동산 대출 부실 위험 및 대손충당금',
      ],
    },
    en: {
      title: 'Rate Curve & Credit Quality',
      points: [
        'Yield-curve shape and its impact on net interest income',
        'Commercial real estate loan marks and provisioning trends',
      ],
    },
    zh: {
      title: '利率政策与地产风险',
      points: [
        '人民银行利率决议及存款利率上限调整',
        '房地产行业风险敞口对银行资产质量的影响',
      ],
    },
    ja: {
      title: '日銀政策修正と銀行株',
      points: [
        '日銀YCC修正およびマイナス金利解除ペース',
        '邦銀の海外融資ポートフォリオと円相場の関係',
      ],
    },
    gb: {
      title: 'BoE Policy & UK Banks',
      points: [
        'BoE base rate trajectory and UK bank net interest margin',
        'UK commercial property exposure across the big four',
      ],
    },
    de: {
      title: 'EZB-Politik & EU-Banken',
      points: [
        'EZB-Zinsentscheidungen und ihre Wirkung auf die Nettozinsmarge',
        'Gewerbeimmobilien-Kreditrisiken bei deutschen Geschäftsbanken',
      ],
    },
    fr: {
      title: 'Politique BCE & Banques UE',
      points: [
        "Trajectoire des taux BCE et marge nette d'intérêt",
        "Exposition au crédit immobilier commercial dans la zone euro",
      ],
    },
    it: {
      title: 'Politica BCE & Banche Italiane',
      points: [
        'Spread BTP-Bund e margine di intermediazione bancaria',
        "NPL e coverage ratio nel settore bancario italiano",
      ],
    },
  },

  energy: {
    ko: {
      title: '유가 및 정유 마진',
      points: [
        'OPEC+ 감산 결정 및 브렌트유 가격 흐름',
        '국내 정유사 크랙 스프레드 및 LNG 장기계약',
      ],
    },
    en: {
      title: 'Oil Macro & OPEC+ Supply',
      points: [
        'OPEC+ production cuts and their effect on Brent spot + forward curve',
        'US strategic petroleum reserve levels and refilling pace',
      ],
    },
    zh: {
      title: '能源安全与战略储备',
      points: [
        '中国战略石油储备和原油进口来源多元化',
        '天然气进口合同价格与国内工业用电需求',
      ],
    },
    ja: {
      title: 'エネルギー安保と為替',
      points: [
        '円安が原油輸入コストへ与える影響',
        '中東情勢と日本の LNG 長期契約',
      ],
    },
    gb: {
      title: 'North Sea & Windfall Tax',
      points: [
        'UK windfall tax regime impact on North Sea upstream investment',
        'Brent crude correlation with sterling-denominated energy majors',
      ],
    },
    de: {
      title: 'Gaspreise & Industriestandort',
      points: [
        'TTF-Gaspreise und ihre Wirkung auf energieintensive Industrien',
        'LNG-Terminal-Ausbau und Pipeline-Diversifizierung',
      ],
    },
    fr: {
      title: 'Énergie Nucléaire & Pétrole',
      points: [
        "Disponibilité du parc nucléaire EDF et exportations d'électricité",
        'Exposition de TotalEnergies aux marchés gaziers LNG',
      ],
    },
    it: {
      title: 'Gas Naturale & Rinnovabili',
      points: [
        'Prezzi del gas PSV e costi industriali italiani',
        'Investimenti Eni nella transizione energetica e gas africano',
      ],
    },
  },

  automotive: {
    ko: {
      title: '전기차 수요 및 배터리 수급',
      points: [
        '주요국 EV 보조금 정책 변화 및 판매 증가율',
        '리튬/니켈 원자재 가격과 국내 배터리 3사 실적',
      ],
    },
    en: {
      title: 'EV Demand & Legacy Margins',
      points: [
        'EV adoption curve vs. legacy ICE margin pressure — the transition gap',
        'UAW wage settlements and their impact on Detroit Three unit economics',
      ],
    },
    zh: {
      title: '新能源车出口与价格战',
      points: [
        '国内新能源车价格战及头部品牌市占率变化',
        '欧盟反补贴关税对中国车企出口的影响',
      ],
    },
    ja: {
      title: 'HV戦略と為替メリット',
      points: [
        'トヨタ主導のハイブリッド戦略と BEV シフトのペース',
        '円安が北米向け輸出車の利益率に与える影響',
      ],
    },
    gb: {
      title: 'UK Auto & EV Transition',
      points: [
        'UK zero-emission vehicle mandate compliance costs',
        "JLR's production recovery and its contribution to Tata Motors",
      ],
    },
    de: {
      title: 'EV-Strategie & China-Risiko',
      points: [
        "Absatz-Exposure deutscher OEMs im chinesischen Markt",
        "BEV-Margen bei VW, BMW und Mercedes vs. ICE-Altgeschäft",
      ],
    },
    fr: {
      title: "Prime à la Conversion & EV",
      points: [
        "Bonus écologique et impact sur les ventes de Renault / Stellantis",
        "Dépendance de la chaîne d'approvisionnement aux batteries asiatiques",
      ],
    },
    it: {
      title: 'Stellantis & Mercato EV',
      points: [
        "Posizionamento di Stellantis nella transizione elettrica",
        "Incentivi governativi italiani e domanda interna",
      ],
    },
  },

  consumer: {
    ko: {
      title: '소비재 가격결정력 및 환율',
      points: [
        '원화 약세가 수입 소비재 가격에 미치는 영향',
        '국내 소비 심리 지수 및 가처분소득 동향',
      ],
    },
    en: {
      title: 'Pricing Power & Wage Growth',
      points: [
        'Consumer staples gross margin vs. input cost normalisation',
        'Real wage growth and its passthrough to discretionary spending',
      ],
    },
    zh: {
      title: '消费信心与内需刺激',
      points: [
        '居民消费价格指数与可支配收入增速',
        '消费刺激政策与以旧换新补贴执行情况',
      ],
    },
    ja: {
      title: '実質賃金と消費動向',
      points: [
        '実質賃金の推移とインバウンド消費の寄与度',
        '円安による輸入消費財の価格転嫁余地',
      ],
    },
    gb: {
      title: 'UK Consumer & Cost of Living',
      points: [
        'UK real wage growth vs. grocery CPI inflation',
        'Retail footfall and discretionary spending trends',
      ],
    },
    de: {
      title: 'Einzelhandel & Kaufkraft',
      points: [
        'Reallohnentwicklung in Deutschland und ihre Wirkung auf Konsumgüter',
        'Energiepreise und deren Durchschlag auf die Einzelhandelsmargen',
      ],
    },
    fr: {
      title: "Consommation & Pouvoir d'Achat",
      points: [
        "Évolution du pouvoir d'achat et consommation des ménages",
        'Luxe : exposition aux marchés chinois et américain',
      ],
    },
    it: {
      title: 'Consumi & Inflazione',
      points: [
        "Inflazione alimentare e tenuta dei consumi italiani",
        "Esposizione del lusso italiano al mercato asiatico",
      ],
    },
  },

  generic: {
    ko: {
      title: '글로벌 매크로 및 환율',
      points: [
        '연준 금리 경로와 위험자산 선호도',
        '원달러 환율 변동이 해외주식 평가손익에 미치는 영향',
      ],
    },
    en: {
      title: 'Fed Path & Risk Appetite',
      points: [
        'Federal Reserve rate trajectory and its effect on equity multiples',
        'Dollar index strength and implications for foreign earnings translation',
      ],
    },
    zh: {
      title: '全球流动性与汇率',
      points: [
        '美联储政策路径与全球风险资产表现',
        '人民币汇率对上市公司海外业务的影响',
      ],
    },
    ja: {
      title: 'FRB 政策と円相場',
      points: [
        '日米金利差と円相場の方向性',
        '日経平均の海外資金フロー動向',
      ],
    },
    gb: {
      title: 'BoE Policy & Sterling',
      points: [
        'BoE policy path and its effect on UK equity valuations',
        'Sterling movements against dollar and euro as earnings translator',
      ],
    },
    de: {
      title: 'EZB-Politik & DAX',
      points: [
        'EZB-Zinspfad und seine Wirkung auf europäische Aktienbewertungen',
        'EUR/USD-Kurs als Übersetzer für exportorientierte DAX-Werte',
      ],
    },
    fr: {
      title: 'Politique BCE & CAC 40',
      points: [
        "Trajectoire des taux BCE et valorisations des actions européennes",
        "Impact du cours EUR/USD sur les multinationales du CAC 40",
      ],
    },
    it: {
      title: 'BCE & FTSE MIB',
      points: [
        "Politica BCE e valutazioni del FTSE MIB",
        "Spread BTP-Bund come indicatore di rischio paese",
      ],
    },
  },
};

// ─── Component ─────────────────────────────────────────────────────────────

const sectorLabel: Record<Sector, string> = {
  semiconductor: 'Semiconductor',
  tech:          'Technology',
  finance:       'Financial',
  energy:        'Energy',
  automotive:    'Automotive',
  consumer:      'Consumer',
  generic:       'Macro',
};

const MacroInsightCard = () => {
  const { locale, t } = useLanguage();
  const { stock } = useStock();

  const sector = sectorFor(stock.symbol);
  const country = localeToCountry[locale];
  const context = analysisContext[sector][locale];

  return (
    <div className="glass-card p-6 flex flex-col" style={{ maxHeight: 520 }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
          <Lightbulb className="w-4 h-4 text-accent" />
        </div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
          {t.macroInsight} — {country}
        </h3>
      </div>

      {/* Thematic title */}
      <h4 className="text-base font-semibold text-foreground mb-1">{context.title}</h4>

      {/* Sector badge + symbol */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium uppercase tracking-wider">
          {sectorLabel[sector]}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {stock.symbol}
        </span>
      </div>

      {/* Analysis bullet points */}
      <ul className="space-y-1.5 flex-1">
        {context.points.map((point, i) => (
          <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
            <span className="text-accent mt-0.5">▸</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>

      {/* Footer hint — only shown when viewing the default/fallback sector */}
      {sector === 'generic' && (
        <p className="text-[10px] text-muted-foreground/60 mt-3 pt-3 border-t border-border/40">
          {locale === 'ko'
            ? '이 종목은 기본 매크로 분석으로 표시됩니다'
            : 'Showing default macro view — symbol not in sector table'}
        </p>
      )}
    </div>
  );
};

export default MacroInsightCard;

/**
 * WHAT_IF_NO_LIMITS — live sector resolution + AI-generated analysis
 *
 * The card above uses two static lookup tables (`SYMBOL_TO_SECTOR` and
 * `analysisContext`) because the free tiers of both data sources involved
 * would not survive a few minutes of active terminal use:
 *
 *   - Alpha Vantage COMPANY_OVERVIEW: 25 requests/day on the free tier.
 *     Every stock-change event would burn one request. Realistic daily
 *     usage of ~100 ticker switches exhausts the quota in the first hour.
 *
 *   - Anthropic/Gemini (via the `ai-assistant` Edge Function): no hard
 *     rate limit on our side, but the analysis text is long enough
 *     (~200 tokens in × ~150 tokens out) that a user flipping through
 *     50 tickers in a session costs roughly one cent of model spend per
 *     session per user. At free-tier scale that is not sustainable.
 *
 * With paid tiers for both, the file would look like this:
 *
 * ```ts
 * import { useQuery } from '@tanstack/react-query';
 * import { fetchCompanyOverview, generateMacroInsight } from '@/services/marketDataService';
 *
 * const MacroInsightCard = () => {
 *   const { locale, t } = useLanguage();
 *   const { stock } = useStock();
 *
 *   // Step 1: resolve the sector from the live company overview.
 *   // Alpha Vantage's COMPANY_OVERVIEW returns a GICS Sector string
 *   // ('Technology', 'Financials', etc.) which we'd map to our taxonomy
 *   // or pass through directly.
 *   const { data: overview } = useQuery({
 *     queryKey: ['overview', stock.symbol],
 *     queryFn:  () => fetchCompanyOverview(stock.symbol),
 *     staleTime: 24 * 60 * 60_000, // sectors don't change — cache for a day
 *   });
 *
 *   // Step 2: feed the sector + locale + current macro headlines into the
 *   // ai-assistant Edge Function, which prompts Claude (or Gemini) for a
 *   // two-bullet analysis tuned to the user's region.
 *   const { data: insight, isLoading } = useQuery({
 *     queryKey: ['insight', stock.symbol, overview?.sector, locale],
 *     queryFn:  () => generateMacroInsight({
 *       symbol: stock.symbol,
 *       name:   stock.name,
 *       sector: overview?.sector ?? 'Unknown',
 *       locale,
 *       // The Edge Function prepends the 10 most recent macro headlines
 *       // from NewsAPI to the prompt so the bullets reflect today's news,
 *       // not yesterday's static analysis.
 *     }),
 *     enabled:  !!overview?.sector,
 *     staleTime: 30 * 60_000, // 30 min — headlines rotate slowly
 *   });
 *
 *   const country = localeToCountry[locale];
 *
 *   if (isLoading || !insight) return <MacroInsightSkeleton />;
 *
 *   return (
 *     <div className="glass-card p-6 flex flex-col" style={{ maxHeight: 520 }}>
 *       <Header country={country} />
 *       <h4 className="text-base font-semibold text-foreground mb-1">
 *         {insight.title}
 *       </h4>
 *       <SectorBadge sector={overview!.sector} symbol={stock.symbol} />
 *       <ul className="space-y-1.5 flex-1">
 *         {insight.points.map((p, i) => (
 *           <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
 *             <span className="text-accent mt-0.5">▸</span>
 *             <span>{p}</span>
 *           </li>
 *         ))}
 *       </ul>
 *       <RegeneratedAt at={insight.generatedAt} />
 *     </div>
 *   );
 * };
 * ```
 *
 * The Edge Function side would receive `{ symbol, name, sector, locale }`
 * plus the recent headline digest it maintains, and return:
 *
 * ```ts
 * interface MacroInsight {
 *   title: string;        // e.g. "AI Capex & Export Controls"
 *   points: [string, string];
 *   generatedAt: number;  // unix ms
 * }
 * ```
 *
 * The system prompt to Claude would be something like:
 *
 *   "You are a financial analyst writing a two-bullet macro snapshot for a
 *   terminal user in {locale_name}. The user is looking at {name} ({symbol})
 *   in the {sector} sector. Recent macro headlines: {top_10_headlines}.
 *   Write one thematic title (max 5 words) and exactly two bullets (max 15
 *   words each) describing what a {locale_name}-based holder should be
 *   watching. Respond in {locale_language}. Respond in strict JSON."
 *
 * Migration path from the current static version:
 *   1. Deploy the new Edge Function action `ai-assistant?task=macro-insight`.
 *   2. Add `fetchCompanyOverview` and `generateMacroInsight` to
 *      marketDataService.ts (behind the existing `callEdge` wrapper).
 *   3. Swap this component to use `useQuery` as shown above.
 *   4. Delete `SYMBOL_TO_SECTOR` and `analysisContext` (~350 lines).
 *   5. Keep `localeToCountry` — it's still used for the header badge.
 */
