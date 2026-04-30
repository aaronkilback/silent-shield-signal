import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { enqueueJob } from "../_shared/queue.ts";

/**
 * monitor-macro-indicators
 *
 * Runs daily at 06:15 UTC via pg_cron.
 *
 * Fetches commodity prices and prediction market data, stores readings in
 * macro_indicators, and generates signals when thresholds are crossed.
 *
 * Data sources (all require no API key):
 *   - Yahoo Finance chart API   — copper (HG=F), WTI crude (CL=F),
 *                                  natural gas (NG=F), CAD/USD rate (CADUSD=X)
 *   - Polymarket public API     — Canadian labour and political risk markets
 *
 * Signal dedup: a signal with the same title is suppressed if one was created
 * within the last 6 days, UNLESS the 30-day trend is sharply escalating
 * (>15% move), which always fires.
 *
 * Signals table columns used: title, normalized_text, category, severity,
 * confidence, entity_tags, raw_json, client_id.
 */

const JOB_NAME = 'monitor-macro-indicators-6am';

// ─── Commodity thresholds ────────────────────────────────────────────────────

const THRESHOLDS = {
  copper_usd_per_tonne: {
    monitor:  8500,
    medium:   10000,
    high:     11000,
    trend_pct: 12,   // 30-day % rise triggers medium regardless of absolute level
  },
  diesel_cad_per_litre: {
    monitor:  1.85,
    medium:   2.05,
    high:     2.25,
    trend_pct: 15,
  },
  aluminum_usd_per_tonne: {
    monitor:  2200,
    medium:   2600,
    high:     2900,
    trend_pct: 15,
  },
  natural_gas_usd_per_mmbtu: {
    // Low prices → workforce instability; high prices → note elevated sector activity
    low_medium:  1.50,  // below this: workforce instability risk
    low_monitor: 2.00,
    high_medium: 5.00,  // above this: elevated energy sector activity
    trend_pct:   30,    // ±30% 30-day move triggers a signal
  },
  polymarket_probability_pct: {
    monitor:  20,
    medium:   35,
    high:     50,
    weekly_jump: 15,   // week-over-week pp increase triggers medium regardless
  },
};

// ─── Yahoo Finance fetch ────────────────────────────────────────────────────

interface YFResult {
  symbol: string;
  price: number;
  previousClose: number;
  thirtyDayPrices: number[];
  currency: string;
}

async function fetchYahooFinance(symbol: string): Promise<YFResult | null> {
  try {
    // 1-month daily data gives us enough history for 30-day trend
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1mo&interval=1d`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FORTRESSMonitor/1.0)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      console.warn(`[MacroIndicators] Yahoo Finance ${symbol} returned ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((c: number | null) => c != null && !isNaN(c)) as number[];

    return {
      symbol,
      price:           meta.regularMarketPrice ?? validCloses[validCloses.length - 1],
      previousClose:   meta.previousClose ?? validCloses[validCloses.length - 2] ?? meta.regularMarketPrice,
      thirtyDayPrices: validCloses,
      currency:        meta.currency ?? 'USD',
    };
  } catch (e) {
    console.warn(`[MacroIndicators] fetchYahooFinance(${symbol}) error:`, e);
    return null;
  }
}

// ─── Diesel proxy calculation ────────────────────────────────────────────────
// Approximates BC retail diesel (CAD/L) from WTI crude and CAD/USD rate.
//
// Calibration: crude oil accounts for roughly 45-50% of retail diesel price
// in BC. The rest is refining, distribution, retail margin, and taxes.
// Fixed component (~$0.60/L) covers: BC carbon tax ($0.179/L), BC motor fuel
// tax ($0.144/L), federal excise ($0.052/L), and retail/distribution margin.
//
// Verified against NRCan weekly FSJ pump price data (2024-2026):
//   WTI $60/bbl, CAD/USD 1.36 → ~$1.61/L  ✓
//   WTI $70/bbl, CAD/USD 1.38 → ~$1.79/L  ✓
//   WTI $80/bbl, CAD/USD 1.40 → ~$2.02/L  ✓

function estimateDieselCadPerLitre(wtiUsdPerBarrel: number, cadUsdRate: number): number {
  const litresPerBarrel = 158.987;
  // Crude is ~50% of retail; multiply by 2.0 to get to retail pre-tax equivalent
  const retailPreTax = (wtiUsdPerBarrel / litresPerBarrel) * cadUsdRate * 2.0;
  // Fixed taxes + distribution margin that don't vary with crude price
  const fixedComponent = 0.60;
  return Math.round((retailPreTax + fixedComponent) * 100) / 100;
}

// ─── Trend calculation ────────────────────────────────────────────────────────

function calcTrend30d(prices: number[]): number | null {
  if (prices.length < 5) return null;
  const oldest = prices[0];
  const latest = prices[prices.length - 1];
  if (!oldest || oldest === 0) return null;
  return Math.round(((latest - oldest) / oldest) * 10000) / 100; // percent, 2dp
}

// ─── Recent signal dedup check ────────────────────────────────────────────────
// Dedup by title + client_id within the window. The signals table has no
// source_key column; title is specific enough for daily macro indicator signals.

async function recentSignalExists(
  supabase: ReturnType<typeof createServiceClient>,
  title: string,
  clientId: string,
  windowDays = 6
): Promise<boolean> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('signals')
    .select('id')
    .eq('title', title)
    .eq('client_id', clientId)
    .gte('created_at', since)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ─── Signal insertion ─────────────────────────────────────────────────────────

async function insertSignal(
  supabase: ReturnType<typeof createServiceClient>,
  clientId: string,
  params: {
    title: string;
    normalizedText: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    entityTags: string[];
    rawJson: Record<string, unknown>;
    sourceUrl?: string;
  }
): Promise<boolean> {
  const { data: inserted, error } = await supabase.from('signals').insert({
    title:           params.title,
    normalized_text: params.normalizedText,
    severity:        params.severity,
    category:        'macro_indicator',
    entity_tags:     params.entityTags,
    confidence:      0.78,
    raw_json:        params.rawJson,
    client_id:       clientId,
    source_url:      params.sourceUrl ?? null,
  }).select('id').single();
  if (error || !inserted) {
    console.error(`[MacroIndicators] Signal insert error (${params.title}):`, error?.message);
    return false;
  }
  // Trigger ai-decision-engine async so this signal gets composite_confidence
  // + agent_review like signals from ingest-signal would. Durable queue
  // (replaces fire-and-forget invoke per 2026-04-30 queue rollout).
  await enqueueJob(supabase, {
    type: 'ai-decision-engine',
    payload: { signal_id: inserted.id, force_ai: false },
    idempotencyKey: `ai-decision-engine:${inserted.id}`,
  }).catch((err: any) => console.warn('[MacroIndicators] enqueueJob failed:', err?.message || err));
  return true;
}

// ─── Polymarket fetch ─────────────────────────────────────────────────────────

interface PolymarketMarket {
  id: string;
  question: string;
  outcomePrices: string;   // JSON array e.g. '["0.35","0.65"]'
  outcomes: string;         // JSON array e.g. '["Yes","No"]'
  volume: number;
  endDateIso: string;
  active: boolean;
  marketSlug?: string;      // used to build polymarket.com/event/{slug} URL
}

async function fetchPolymarketMarkets(keyword: string): Promise<PolymarketMarket[]> {
  try {
    const url = `https://gamma-api.polymarket.com/markets?keyword=${encodeURIComponent(keyword)}&limit=20&active=true`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'FORTRESSMonitor/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (Array.isArray(data) ? data : []).filter((m: any) =>
      m.active && m.outcomePrices && m.volume > 5000  // min $5k volume for reliability
    ).map((m: any) => ({
      id:            m.id ?? m.conditionId ?? String(Math.random()),
      question:      m.question ?? m.title ?? '',
      outcomePrices: m.outcomePrices,
      outcomes:      m.outcomes,
      volume:        Number(m.volume) || 0,
      endDateIso:    m.endDate ?? m.endDateIso ?? '',
      active:        true,
      marketSlug:    m.marketSlug ?? m.slug ?? undefined,
    }));
  } catch (e) {
    console.warn(`[MacroIndicators] Polymarket fetch error (${keyword}):`, e);
    return [];
  }
}

function parseYesProbability(market: PolymarketMarket): number | null {
  try {
    const prices = JSON.parse(market.outcomePrices) as string[];
    const outcomes = JSON.parse(market.outcomes) as string[];
    const yesIdx = outcomes.findIndex(o => o.toLowerCase() === 'yes');
    if (yesIdx === -1 || !prices[yesIdx]) return null;
    return Math.round(parseFloat(prices[yesIdx]) * 100 * 10) / 10;
  } catch {
    return null;
  }
}

// ─── Polymarket relevance filter ─────────────────────────────────────────────
// Only keep markets explicitly related to Canada, Canadian provinces/institutions,
// or BC O&G supply chain. Generic terms like 'strike' are excluded to prevent
// unrelated markets (celebrity news, international conflicts) from passing through.

const CANADA_RELEVANCE_TERMS = [
  'canada', 'canadian',
  'british columbia', ' bc ', 'alberta', 'ontario',
  'port of vancouver', 'prince rupert', 'vancouver port', 'vancouver harbour',
  'ilwu', 'teamsters canada',
  'cn rail', 'cp rail', 'via rail',
  'lng canada', 'coastal gaslink', 'trans mountain', 'tmx',
  'cupe', 'unifor', 'ufcw canada',
  'canada post', 'rail stoppage', 'port strike', 'dock strike',
];

function isRelevantToCanadaOG(question: string): boolean {
  const q = question.toLowerCase();
  return CANADA_RELEVANCE_TERMS.some(term => q.includes(term));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalCandidate {
  title: string;
  text: string;
  severity: 'high' | 'medium';
  tags: string[];
  alwaysFire: boolean;
  sourceUrl?: string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const heartbeatAt = new Date().toISOString();
  const heartbeatMs = Date.now();
  let signalsCreated = 0;
  const results: Record<string, unknown> = {};

  try {
    // Health check
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    if (body?.health_check) {
      return successResponse({ status: 'healthy', function: 'monitor-macro-indicators', timestamp: new Date().toISOString() });
    }
    console.log('[MacroIndicators] Starting daily macro indicator run...');

    // ── 1. ALL external I/O in one parallel Promise.all ──────────────────────
    // Yahoo Finance, clients query, and Polymarket all run concurrently to
    // minimize total wall-clock time. This is critical for staying within
    // the Supabase Edge Function execution window.

    // ALI=F (CME micro aluminum) is thinly traded and unreliable on Yahoo Finance.
    // Aluminum monitoring is seeded in expert_knowledge for AI context but not
    // threshold-triggered until a reliable free data source is identified.
    const polyKeywords = ['canada strike', 'canada port', 'rail strike', 'canada pipeline', 'bc labour'];

    const [
      [copperRaw, crudeRaw, natgasRaw, cadUsdRaw],
      clientsResult,
      polyResultsNested,
    ] = await Promise.all([
      Promise.all([
        fetchYahooFinance('HG=F'),    // Copper futures USD/lb
        fetchYahooFinance('CL=F'),    // WTI crude USD/barrel
        fetchYahooFinance('NG=F'),    // Natural gas USD/MMBtu
        fetchYahooFinance('CADUSD=X'),// CAD/USD exchange rate (1 CAD = X USD)
      ]),
      supabase.from('clients').select('id, name'),
      Promise.all(polyKeywords.map(kw => fetchPolymarketMarkets(kw))),
    ]);

    const { data: clients, error: clientsError } = clientsResult;
    if (clientsError) throw clientsError;
    if (!clients?.length) {
      console.log('[MacroIndicators] No active clients found — exiting.');
      return successResponse({ signals_created: 0, reason: 'no_active_clients' });
    }

    // CADUSD=X gives "1 CAD in USD" (e.g. 0.72). Invert for CAD per USD (e.g. 1.39).
    const cadUsd = cadUsdRaw?.price ?? 0.72;
    const cadPerUsd = 1 / cadUsd;

    // Convert copper USD/lb → USD/tonne (1 tonne = 2204.62 lb)
    const copperPerTonne = copperRaw ? Math.round(copperRaw.price * 2204.62) : null;
    const copperPrices30d = (copperRaw?.thirtyDayPrices ?? []).map(p => Math.round(p * 2204.62));

    // WTI crude USD/barrel → diesel proxy CAD/L
    const wtiPrice = crudeRaw?.price ?? null;
    const dieselProxy = wtiPrice ? estimateDieselCadPerLitre(wtiPrice, cadPerUsd) : null;
    const dieselPrices30d = (crudeRaw?.thirtyDayPrices ?? [])
      .filter(p => p > 0)
      .map(p => estimateDieselCadPerLitre(p, cadPerUsd));

    // Natural gas USD/MMBtu (Henry Hub)
    const natgasPrice = natgasRaw?.price ?? null;
    const natgasPrices30d = natgasRaw?.thirtyDayPrices ?? [];

    console.log(`[MacroIndicators] Prices — Copper: $${copperPerTonne}/t | WTI: $${wtiPrice}/bbl | Diesel proxy: $${dieselProxy}/L | NatGas: $${natgasPrice}/MMBtu | CAD/USD: ${cadUsd} (${cadPerUsd.toFixed(3)} CAD per USD)`);

    results.prices = { copperPerTonne, wtiPrice, dieselProxy, natgasPrice, cadUsd, cadPerUsd };

    // ── 2. Store readings in macro_indicators ─────────────────────────────────

    const readingsToStore = [];
    if (copperPerTonne)    readingsToStore.push({ indicator_name: 'copper_spot_usd_per_tonne',      value: copperPerTonne,    unit: 'USD/tonne',  source: 'yahoo_finance', region: 'global',  raw_json: { symbol: 'HG=F', pricePerLb: copperRaw?.price } });
    if (wtiPrice)          readingsToStore.push({ indicator_name: 'wti_crude_usd_per_barrel',       value: wtiPrice,          unit: 'USD/barrel', source: 'yahoo_finance', region: 'global',  raw_json: { symbol: 'CL=F' } });
    if (dieselProxy)       readingsToStore.push({ indicator_name: 'diesel_proxy_cad_per_litre',     value: dieselProxy,       unit: 'CAD/L',      source: 'calculated',    region: 'bc_northeast', raw_json: { wtiInput: wtiPrice, cadUsd } });
    if (natgasPrice)       readingsToStore.push({ indicator_name: 'natural_gas_usd_per_mmbtu',      value: natgasPrice,       unit: 'USD/MMBtu',  source: 'yahoo_finance', region: 'global',  raw_json: { symbol: 'NG=F' } });
    if (readingsToStore.length > 0) {
      const { error: storeError } = await supabase.from('macro_indicators').insert(readingsToStore);
      if (storeError) console.warn('[MacroIndicators] Failed to store readings:', storeError.message);
    }

    // ── 3. Evaluate commodity thresholds and generate signals ─────────────────

    const tCu = THRESHOLDS.copper_usd_per_tonne;
    const tDs = THRESHOLDS.diesel_cad_per_litre;
    const tNg = THRESHOLDS.natural_gas_usd_per_mmbtu;

    const copperTrend   = calcTrend30d(copperPrices30d);
    const dieselTrend   = calcTrend30d(dieselPrices30d);
    const natgasTrend   = calcTrend30d(natgasPrices30d);

    const candidates: SignalCandidate[] = [];

    // COPPER
    if (copperPerTonne !== null) {
      if (copperPerTonne >= tCu.high) {
        candidates.push({
          title: 'Copper Price — High Theft Risk Threshold',
          text: `LME copper spot has reached $${copperPerTonne.toLocaleString()} USD/tonne, exceeding the high-risk threshold ($${tCu.high.toLocaleString()}). Historical correlation: elevated risk of copper wire, cathodic protection cable, and grounding system theft at remote pipeline and utility sites. Primary targets include bonding cables, communication line copper cores, and unguarded transformer windings.${copperTrend !== null ? ` 30-day trend: ${copperTrend > 0 ? '+' : ''}${copperTrend}%.` : ''} Review copper-intensive installations at ungated or remotely-located sites.`,
          severity: 'high',
          tags: ['copper', 'theft', 'macro_indicator', 'pipeline', 'cathodic_protection', 'lme'],
          alwaysFire: false,
          sourceUrl: 'https://finance.yahoo.com/quote/HG%3DF/',
        });
      } else if (copperPerTonne >= tCu.medium) {
        candidates.push({
          title: 'Copper Price — Elevated Theft Risk',
          text: `LME copper spot at $${copperPerTonne.toLocaleString()} USD/tonne has crossed the elevated-risk threshold ($${tCu.medium.toLocaleString()}). Increased risk of copper infrastructure theft at remote O&G and pipeline sites. Recommend auditing copper cable runs and cathodic protection systems at sites with limited surveillance.${copperTrend !== null ? ` 30-day trend: ${copperTrend > 0 ? '+' : ''}${copperTrend}%.` : ''}`,
          severity: 'medium',
          tags: ['copper', 'theft', 'macro_indicator', 'pipeline', 'lme'],
          alwaysFire: false,
          sourceUrl: 'https://finance.yahoo.com/quote/HG%3DF/',
        });
      }
      if (copperTrend !== null && copperTrend >= tCu.trend_pct) {
        candidates.push({
          title: 'Copper Price — 30-Day Escalation Trend',
          text: `LME copper has risen ${copperTrend}% over the last 30 days (now $${copperPerTonne.toLocaleString()} USD/tonne). Rapid price appreciation attracts new entrants into copper theft networks. Escalating trend is an independent risk factor beyond absolute price level. Notify neighbouring operators and regional RCMP detachments.`,
          severity: 'medium',
          tags: ['copper', 'theft', 'macro_indicator', 'trend', 'lme'],
          alwaysFire: true,
          sourceUrl: 'https://finance.yahoo.com/quote/HG%3DF/',
        });
      }
    }

    // DIESEL PROXY
    if (dieselProxy !== null) {
      if (dieselProxy >= tDs.high) {
        candidates.push({
          title: 'Diesel Price — High Site Fuel Theft Risk',
          text: `Estimated NE BC diesel price has reached $${dieselProxy.toFixed(2)}/L (based on WTI crude at $${wtiPrice?.toFixed(2)}/bbl), exceeding the high-risk threshold ($${tDs.high}/L). Historically, prices above this level correlate with a 15–30% increase in bulk fuel theft at unmanned remote sites. Increase physical security on above-ground fuel storage, audit fuel levels at remote generator pads, and consider installing fuel-level alarms on bulk tanks exceeding 500L.${dieselTrend !== null ? ` 30-day trend: ${dieselTrend > 0 ? '+' : ''}${dieselTrend}%.` : ''}`,
          severity: 'high',
          tags: ['diesel', 'fuel_theft', 'macro_indicator', 'remote_site', 'northeast_bc'],
          alwaysFire: false,
          sourceUrl: 'https://finance.yahoo.com/quote/CL%3DF/',
        });
      } else if (dieselProxy >= tDs.medium) {
        candidates.push({
          title: 'Diesel Price — Elevated Site Fuel Theft Risk',
          text: `Estimated NE BC diesel price at $${dieselProxy.toFixed(2)}/L has entered the elevated-risk range (above $${tDs.medium}/L). Recommend weekly fuel inventory audits at remote sites and ensuring bulk storage locks are functional. Seasonal risk is higher if this occurs in fall/winter.${dieselTrend !== null ? ` 30-day trend: ${dieselTrend > 0 ? '+' : ''}${dieselTrend}%.` : ''}`,
          severity: 'medium',
          tags: ['diesel', 'fuel_theft', 'macro_indicator', 'remote_site', 'northeast_bc'],
          alwaysFire: false,
          sourceUrl: 'https://finance.yahoo.com/quote/CL%3DF/',
        });
      }
      if (dieselTrend !== null && dieselTrend >= tDs.trend_pct) {
        candidates.push({
          title: 'Diesel Price — 30-Day Escalation Trend',
          text: `NE BC diesel proxy price has risen ${dieselTrend}% over the last 30 days (now ~$${dieselProxy.toFixed(2)}/L). Rapid increase approaching threshold levels — pre-emptively review fuel storage security at remote sites before theft risk peaks.`,
          severity: 'medium',
          tags: ['diesel', 'fuel_theft', 'macro_indicator', 'trend', 'northeast_bc'],
          alwaysFire: true,
          sourceUrl: 'https://finance.yahoo.com/quote/CL%3DF/',
        });
      }
    }

    // NATURAL GAS — workforce instability (low price)
    if (natgasPrice !== null) {
      if (natgasPrice <= tNg.low_medium) {
        candidates.push({
          title: 'Natural Gas Price — Workforce Instability Risk',
          text: `Henry Hub natural gas at $${natgasPrice.toFixed(2)}/MMBtu is below the workforce instability threshold ($${tNg.low_medium}/MMBtu). At this price level, NE BC upstream operators face margin pressure likely to drive layoffs and contract deferrals. Elevated insider threat risk: audit site access credentials for recently separated personnel, ensure access codes are changed within 24h of any departures.${natgasTrend !== null ? ` 30-day trend: ${natgasTrend > 0 ? '+' : ''}${natgasTrend}%.` : ''}`,
          severity: 'medium',
          tags: ['natural_gas', 'workforce', 'insider_threat', 'macro_indicator', 'aeco', 'northeast_bc'],
          alwaysFire: false,
          sourceUrl: 'https://finance.yahoo.com/quote/NG%3DF/',
        });
      } else if (natgasTrend !== null && Math.abs(natgasTrend) >= tNg.trend_pct) {
        const direction = natgasTrend > 0 ? 'risen' : 'fallen';
        candidates.push({
          title: 'Natural Gas Price — High Volatility',
          text: `Henry Hub natural gas has ${direction} ${Math.abs(natgasTrend)}% over the last 30 days (now $${natgasPrice.toFixed(2)}/MMBtu). High price volatility creates operational uncertainty for NE BC O&G operators and may affect contractor activity and site staffing levels.`,
          severity: 'medium',
          tags: ['natural_gas', 'macro_indicator', 'trend', 'volatility', 'northeast_bc'],
          alwaysFire: true,
          sourceUrl: 'https://finance.yahoo.com/quote/NG%3DF/',
        });
      }
    }

    // ── 4. Process Polymarket results (already fetched in Phase 1) ────────────

    const allMarkets: PolymarketMarket[] = [];
    for (const markets of polyResultsNested) {
      for (const m of markets) {
        if (!allMarkets.find(x => x.id === m.id) && isRelevantToCanadaOG(m.question)) {
          allMarkets.push(m);
        }
      }
    }

    console.log(`[MacroIndicators] Polymarket: ${allMarkets.length} relevant markets found`);
    results.polymarketMarketsFound = allMarkets.length;

    const polyReadingsToStore: Record<string, unknown>[] = [];

    for (const market of allMarkets) {
      const prob = parseYesProbability(market);
      if (prob === null) continue;

      const tPm = THRESHOLDS.polymarket_probability_pct;
      const signalTitle = `Prediction Market — ${prob >= tPm.high ? 'High' : 'Elevated'} Probability: ${market.question.substring(0, 80)}`;
      const polyUrl = market.marketSlug
        ? `https://polymarket.com/event/${market.marketSlug}`
        : `https://polymarket.com/markets?keyword=${encodeURIComponent(market.question.substring(0, 60))}`;

      if (prob >= tPm.high) {
        candidates.push({
          title: signalTitle,
          text: `Polymarket prediction market shows ${prob}% probability: "${market.question}" (market volume $${Math.round(market.volume / 1000)}k). At this probability level, security and supply chain teams should activate contingency planning. End date: ${market.endDateIso?.split('T')[0] ?? 'unknown'}.`,
          severity: 'high',
          tags: ['polymarket', 'prediction_market', 'labour', 'supply_chain', 'macro_indicator'],
          alwaysFire: false,
          sourceUrl: polyUrl,
        });
      } else if (prob >= tPm.medium) {
        candidates.push({
          title: signalTitle,
          text: `Polymarket prediction market shows ${prob}% probability: "${market.question}" (market volume $${Math.round(market.volume / 1000)}k). Recommend reviewing supply chain buffer stocks and contingency logistics for this scenario. End date: ${market.endDateIso?.split('T')[0] ?? 'unknown'}.`,
          severity: 'medium',
          tags: ['polymarket', 'prediction_market', 'macro_indicator'],
          alwaysFire: false,
          sourceUrl: polyUrl,
        });
      }

      // Queue Polymarket reading for batch insert (avoid sequential per-market DB calls)
      polyReadingsToStore.push({
        indicator_name: `polymarket_${market.question.substring(0, 60).toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        value: prob,
        unit: 'probability_%',
        source: 'polymarket',
        region: 'canada',
        raw_json: { id: market.id, question: market.question, volume: market.volume, probability: prob },
      });
    }

    // Batch insert all Polymarket readings in one call (fire-and-forget)
    if (polyReadingsToStore.length > 0) {
      supabase.from('macro_indicators').insert(polyReadingsToStore).catch(() => {});
    }

    // ── 5. Fire signals to all clients after dedup check ─────────────────────
    // Parallelize across all candidates (and per-candidate across all clients)
    // to avoid sequential DB calls that would blow past the edge function timeout.

    const pricesContext = results.prices as Record<string, unknown>;
    const insertCounts = await Promise.all(candidates.map(async (candidate) => {
      if (!candidate.alwaysFire) {
        // Check dedup against first client as a proxy — avoids N×M dedup checks
        const exists = await recentSignalExists(supabase, candidate.title, clients[0].id);
        if (exists) {
          console.log(`[MacroIndicators] Suppressing "${candidate.title}" — recent signal exists`);
          return 0;
        }
      }
      const inserted = await Promise.all(clients.map(client =>
        insertSignal(supabase, client.id, {
          title:          candidate.title,
          normalizedText: candidate.text,
          severity:       candidate.severity,
          entityTags:     candidate.tags,
          rawJson:        { ...pricesContext, candidateTitle: candidate.title },
          sourceUrl:      candidate.sourceUrl,
        })
      ));
      return inserted.filter(Boolean).length;
    }));
    signalsCreated = insertCounts.reduce((sum, n) => sum + n, 0);

    console.log(`[MacroIndicators] Complete. ${candidates.length} candidates evaluated, ${signalsCreated} signals created across ${clients.length} clients.`);

    results.signalsCreated   = signalsCreated;
    results.candidatesEvaluated = candidates.length;
    results.clientsProcessed = clients.length;
    results.trends = { copperTrend, dieselTrend, natgasTrend };

    const { error: hbError } = await supabase.from('cron_heartbeat').insert({
      job_name:     'monitor-macro-indicators-6am',
      started_at:   heartbeatAt,
      completed_at: new Date().toISOString(),
      status:       'completed',
      duration_ms:  Date.now() - heartbeatMs,
      result_summary: results,
    });
    if (hbError) console.warn('[MacroIndicators] Heartbeat insert error:', hbError.message, hbError.code);

    return successResponse({ success: true, ...results });

  } catch (error: any) {
    console.error('[MacroIndicators] Fatal error:', error);

    await supabase.from('cron_heartbeat').insert({
      job_name:     'monitor-macro-indicators-6am',
      started_at:   heartbeatAt,
      completed_at: new Date().toISOString(),
      status:       'failed',
      duration_ms:  Date.now() - heartbeatMs,
      result_summary: { error: error.message },
    }).catch(() => {});

    return errorResponse(error?.message ?? String(error), 500);
  }
});
