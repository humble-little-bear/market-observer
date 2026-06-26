import Database from "better-sqlite3";
import type {
  AlertEvent,
  Candle,
  DigestRun,
  Indicator,
  Interval,
  MarketMetric,
  Market,
  Observation,
  SymbolStatus,
} from "../types.js";

export class Repository {
  private readonly db: Database.Database;

  // Prepared statements (compiled once).
  private readonly upsertCandleStmt: Database.Statement;
  private readonly upsertIndicatorStmt: Database.Statement;
  private readonly insertObservationStmt: Database.Statement;
  private readonly upsertReportStmt: Database.Statement;
  private readonly setSymbolStatusStmt: Database.Statement;
  private readonly countCandlesStmt: Database.Statement;
  private readonly latestCandleStmt: Database.Statement;
  private readonly latestIndicatorsStmt: Database.Statement;
  private readonly latestObservationStmt: Database.Statement;
  private readonly observationByMarketDateStmt: Database.Statement;
  private readonly latestObservationBeforeTsStmt: Database.Statement;
  private readonly allLatestObservationsStmt: Database.Statement;
  private readonly hasObservationStmt: Database.Statement;
  private readonly insertAlertEventStmt: Database.Statement;
  private readonly alertEventsStmt: Database.Statement;
  private readonly unsentAlertEventsStmt: Database.Statement;
  private readonly alertEventsBetweenStmt: Database.Statement;
  private readonly markAlertEventSentStmt: Database.Statement;
  private readonly insertDigestRunStmt: Database.Statement;
  private readonly digestRunByPeriodStmt: Database.Statement;
  private readonly markDigestRunSentStmt: Database.Statement;
  private readonly upsertMarketMetricStmt: Database.Statement;
  private readonly latestMarketMetricsStmt: Database.Statement;
  private readonly latestMarketMetricStmt: Database.Statement;
  private readonly marketMetricAtOrBeforeStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.upsertCandleStmt = db.prepare(
      `INSERT INTO candles
         (market, interval, open_time, open, high, low, close, volume, close_time)
       VALUES (@market, @interval, @openTime, @open, @high, @low, @close, @volume, @closeTime)
       ON CONFLICT(market, interval, open_time) DO UPDATE SET
         open = excluded.open,
         high = excluded.high,
         low  = excluded.low,
         close = excluded.close,
         volume = excluded.volume,
         close_time = excluded.close_time`,
    );
    this.upsertIndicatorStmt = db.prepare(
      `INSERT INTO indicators
         (market, interval, open_time, ema20, ema60, atr, atr_pct, rsi, macd, macd_signal, macd_hist)
       VALUES (@market, @interval, @openTime, @ema20, @ema60, @atr, @atr_pct, @rsi, @macd, @macd_signal, @macd_hist)
       ON CONFLICT(market, interval, open_time) DO UPDATE SET
         ema20       = excluded.ema20,
         ema60       = excluded.ema60,
         atr         = excluded.atr,
         atr_pct     = excluded.atr_pct,
         rsi         = excluded.rsi,
         macd        = excluded.macd,
         macd_signal = excluded.macd_signal,
         macd_hist   = excluded.macd_hist`,
    );
    this.insertObservationStmt = db.prepare(
      `INSERT INTO observations
         (market, interval, ts, close, strategy_bias, confidence, trend, volatility, summary)
       VALUES (@market, @interval, @ts, @close, @strategyBias, @confidence, @trend, @volatility, @summary)
       ON CONFLICT(market, interval, ts) DO UPDATE SET
         close         = excluded.close,
         strategy_bias = excluded.strategy_bias,
         confidence    = excluded.confidence,
         trend         = excluded.trend,
         volatility    = excluded.volatility,
         summary       = excluded.summary`,
    );
    this.upsertReportStmt = db.prepare(
      `INSERT INTO reports (date, path, content)
       VALUES (@date, @path, @content)
       ON CONFLICT(date) DO UPDATE SET
         path    = excluded.path,
         content = excluded.content`,
    );
    this.setSymbolStatusStmt = db.prepare(
      `INSERT INTO symbol_status (market, available, last_checked, note)
       VALUES (@market, @available, @lastChecked, @note)
       ON CONFLICT(market) DO UPDATE SET
         available    = excluded.available,
         last_checked = excluded.last_checked,
         note         = excluded.note`,
    );
    this.countCandlesStmt = db.prepare(
      `SELECT COUNT(*) AS n FROM candles WHERE market = ? AND interval = ?`,
    );
    this.latestCandleStmt = db.prepare(
      `SELECT market, interval, open_time, open, high, low, close, volume, close_time
         FROM candles
        WHERE market = ? AND interval = ? AND open_time <= ?
        ORDER BY open_time DESC
        LIMIT ?`,
    );
    this.latestIndicatorsStmt = db.prepare(
      `SELECT market, interval, open_time, ema20, ema60, atr, atr_pct, rsi, macd, macd_signal, macd_hist
         FROM indicators
        WHERE market = ? AND interval = ? AND open_time <= ?
        ORDER BY open_time DESC
        LIMIT ?`,
    );
    this.latestObservationStmt = db.prepare(
      `SELECT id, market, interval, ts, close, strategy_bias, confidence, trend, volatility, summary
         FROM observations
        WHERE market = ? AND interval = ?
        ORDER BY ts DESC
        LIMIT 1`,
    );
    this.observationByMarketDateStmt = db.prepare(
      `SELECT id, market, interval, ts, close, strategy_bias, confidence, trend, volatility, summary
         FROM observations
        WHERE market = ? AND interval = ?
           AND ts >= ? AND ts < ?
        ORDER BY ts DESC
        LIMIT 1`,
    );
    this.latestObservationBeforeTsStmt = db.prepare(
      `SELECT id, market, interval, ts, close, strategy_bias, confidence, trend, volatility, summary
         FROM observations
        WHERE market = ? AND interval = ? AND ts < ?
        ORDER BY ts DESC
        LIMIT 1`,
    );
    this.allLatestObservationsStmt = db.prepare(
      `SELECT o.market, o.interval, o.ts, o.close, o.strategy_bias, o.confidence, o.trend,
              o.volatility, o.summary
         FROM observations o
         JOIN (
           SELECT market, MAX(ts) AS max_ts
             FROM observations
            WHERE interval = ?
            GROUP BY market
         ) m ON m.market = o.market AND m.max_ts = o.ts
        WHERE o.interval = ?`,
    );
    this.hasObservationStmt = db.prepare(
      `SELECT 1 FROM observations WHERE market = ? AND interval = ? LIMIT 1`,
    );
    this.insertAlertEventStmt = db.prepare(
      `INSERT OR IGNORE INTO alert_events
         (market, interval, ts, type, severity, fingerprint, title, body, data_json, sent_at)
       VALUES (@market, @interval, @ts, @type, @severity, @fingerprint, @title, @body, @dataJson, @sentAt)`,
    );
    this.alertEventsStmt = db.prepare(
      `SELECT id, market, interval, ts, type, severity, fingerprint, title, body, data_json, sent_at
         FROM alert_events
        ORDER BY ts DESC, id DESC
        LIMIT ?`,
    );
    this.unsentAlertEventsStmt = db.prepare(
      `SELECT id, market, interval, ts, type, severity, fingerprint, title, body, data_json, sent_at
         FROM alert_events
        WHERE sent_at IS NULL
        ORDER BY ts ASC, id ASC
        LIMIT ?`,
    );
    this.alertEventsBetweenStmt = db.prepare(
      `SELECT id, market, interval, ts, type, severity, fingerprint, title, body, data_json, sent_at
         FROM alert_events
        WHERE ts >= ? AND ts < ?
        ORDER BY ts ASC, id ASC`,
    );
    this.markAlertEventSentStmt = db.prepare(
      `UPDATE alert_events SET sent_at = ? WHERE id = ?`,
    );
    this.insertDigestRunStmt = db.prepare(
      `INSERT OR IGNORE INTO digest_runs
         (period_start, period_end, title, body, sent_at)
       VALUES (@periodStart, @periodEnd, @title, @body, @sentAt)`,
    );
    this.digestRunByPeriodStmt = db.prepare(
      `SELECT id, period_start, period_end, title, body, sent_at
         FROM digest_runs
        WHERE period_start = ? AND period_end = ?
        LIMIT 1`,
    );
    this.markDigestRunSentStmt = db.prepare(
      `UPDATE digest_runs SET sent_at = ? WHERE id = ?`,
    );
    this.upsertMarketMetricStmt = db.prepare(
      `INSERT INTO market_metrics
         (market, venue, ts, mid_price, best_bid, best_ask, spread_bps,
          depth_bid_25_bps, depth_ask_25_bps, depth_bid_50_bps, depth_ask_50_bps,
          imbalance_25_bps, slippage_buy_10k_bps, slippage_sell_10k_bps,
          open_interest, funding_rate, basis_bps)
       VALUES
         (@market, @venue, @ts, @midPrice, @bestBid, @bestAsk, @spreadBps,
          @depthBid25Bps, @depthAsk25Bps, @depthBid50Bps, @depthAsk50Bps,
          @imbalance25Bps, @slippageBuy10kBps, @slippageSell10kBps,
          @openInterest, @fundingRate, @basisBps)
       ON CONFLICT(market, venue, ts) DO UPDATE SET
         mid_price = excluded.mid_price,
         best_bid = excluded.best_bid,
         best_ask = excluded.best_ask,
         spread_bps = excluded.spread_bps,
         depth_bid_25_bps = excluded.depth_bid_25_bps,
         depth_ask_25_bps = excluded.depth_ask_25_bps,
         depth_bid_50_bps = excluded.depth_bid_50_bps,
         depth_ask_50_bps = excluded.depth_ask_50_bps,
         imbalance_25_bps = excluded.imbalance_25_bps,
         slippage_buy_10k_bps = excluded.slippage_buy_10k_bps,
         slippage_sell_10k_bps = excluded.slippage_sell_10k_bps,
         open_interest = excluded.open_interest,
         funding_rate = excluded.funding_rate,
         basis_bps = excluded.basis_bps`,
    );
    this.latestMarketMetricsStmt = db.prepare(
      `SELECT market, venue, ts, mid_price, best_bid, best_ask, spread_bps,
              depth_bid_25_bps, depth_ask_25_bps, depth_bid_50_bps, depth_ask_50_bps,
              imbalance_25_bps, slippage_buy_10k_bps, slippage_sell_10k_bps,
              open_interest, funding_rate, basis_bps
         FROM market_metrics
        WHERE market = ?
        ORDER BY ts DESC, venue ASC
        LIMIT ?`,
    );
    this.latestMarketMetricStmt = db.prepare(
      `SELECT market, venue, ts, mid_price, best_bid, best_ask, spread_bps,
              depth_bid_25_bps, depth_ask_25_bps, depth_bid_50_bps, depth_ask_50_bps,
              imbalance_25_bps, slippage_buy_10k_bps, slippage_sell_10k_bps,
              open_interest, funding_rate, basis_bps
         FROM market_metrics
        WHERE market = ? AND venue = ?
        ORDER BY ts DESC
        LIMIT 1`,
    );
    this.marketMetricAtOrBeforeStmt = db.prepare(
      `SELECT market, venue, ts, mid_price, best_bid, best_ask, spread_bps,
              depth_bid_25_bps, depth_ask_25_bps, depth_bid_50_bps, depth_ask_50_bps,
              imbalance_25_bps, slippage_buy_10k_bps, slippage_sell_10k_bps,
              open_interest, funding_rate, basis_bps
         FROM market_metrics
        WHERE market = ? AND venue = ? AND ts <= ?
        ORDER BY ts DESC
        LIMIT 1`,
    );
  }

  upsertCandles(candles: readonly Candle[]): number {
    if (candles.length === 0) return 0;
    const tx = this.db.transaction((rows: readonly Candle[]) => {
      let n = 0;
      for (const c of rows) {
        this.upsertCandleStmt.run({
          market: c.market,
          interval: c.interval,
          openTime: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          closeTime: c.closeTime,
        });
        n++;
      }
      return n;
    });
    return tx(candles);
  }

  upsertIndicators(rows: readonly Indicator[]): number {
    if (rows.length === 0) return 0;
    const tx = this.db.transaction((rows: readonly Indicator[]) => {
      let n = 0;
      for (const r of rows) {
        this.upsertIndicatorStmt.run({
          market: r.market,
          interval: r.interval,
          openTime: r.openTime,
          ema20: r.ema20,
          ema60: r.ema60,
          atr: r.atr,
          atr_pct: r.atrPct,
          rsi: r.rsi,
          macd: r.macd,
          macd_signal: r.macdSignal,
          macd_hist: r.macdHist,
        });
        n++;
      }
      return n;
    });
    return tx(rows);
  }

  insertObservation(obs: Observation): number {
    const info = this.insertObservationStmt.run({
      market: obs.market,
      interval: obs.interval,
      ts: obs.ts,
      close: obs.close,
      strategyBias: obs.strategyBias,
      confidence: obs.confidence,
      trend: obs.trend,
      volatility: obs.volatility,
      summary: obs.summary,
    });
    return Number(info.lastInsertRowid);
  }

  insertObservations(obs: readonly Observation[]): number {
    if (obs.length === 0) return 0;
    const tx = this.db.transaction((rows: readonly Observation[]) => {
      let n = 0;
      for (const o of rows) this.insertObservation(o);
      n += rows.length;
      return n;
    });
    return tx(obs);
  }

  upsertReport(date: string, filePath: string, content: string): void {
    this.upsertReportStmt.run({ date, path: filePath, content });
  }

  setSymbolStatus(s: SymbolStatus): void {
    this.setSymbolStatusStmt.run({
      market: s.market,
      available: s.available,
      lastChecked: s.lastChecked,
      note: s.note ?? null,
    });
  }

  countCandles(market: Market, interval: Interval): number {
    const row = this.countCandlesStmt.get(market, interval) as { n: number };
    return row.n;
  }

  queryLatestCandles(
    market: Market,
    interval: Interval,
    upToOpenTimeMs: number,
    limit: number,
  ): Candle[] {
    const rows = this.latestCandleStmt.all(market, interval, upToOpenTimeMs, limit) as Array<{
      market: string;
      interval: string;
      open_time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      close_time: number;
    }>;
    return rows.map((r) => ({
      market: r.market as Market,
      interval: r.interval as Interval,
      openTime: r.open_time,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      closeTime: r.close_time,
    }));
  }

  queryLatestIndicators(
    market: Market,
    interval: Interval,
    upToOpenTimeMs: number,
    limit: number,
  ): Indicator[] {
    const rows = this.latestIndicatorsStmt.all(
      market,
      interval,
      upToOpenTimeMs,
      limit,
    ) as Array<{
      market: string;
      interval: string;
      open_time: number;
      ema20: number | null;
      ema60: number | null;
      atr: number | null;
      atr_pct: number | null;
      rsi: number | null;
      macd: number | null;
      macd_signal: number | null;
      macd_hist: number | null;
    }>;
    return rows.map((r) => ({
      market: r.market as Market,
      interval: r.interval as Interval,
      openTime: r.open_time,
      ema20: r.ema20,
      ema60: r.ema60,
      atr: r.atr,
      atrPct: r.atr_pct,
      rsi: r.rsi,
      macd: r.macd,
      macdSignal: r.macd_signal,
      macdHist: r.macd_hist,
    }));
  }

  queryLatestObservation(market: Market, interval: Interval): Observation | null {
    const row = this.latestObservationStmt.get(market, interval) as
      | {
          id: number;
          market: string;
          interval: string;
          ts: number;
          close: number;
          strategy_bias: string;
          confidence: number;
          trend: string;
          volatility: string;
          summary: string;
        }
      | undefined;
    if (!row) return null;
    return {
      market: row.market as Market,
      interval: row.interval as Interval,
      ts: row.ts,
      close: row.close,
      strategyBias: "observe",
      confidence: row.confidence,
      trend: row.trend as Observation["trend"],
      volatility: row.volatility as Observation["volatility"],
      summary: row.summary,
    };
  }

  queryLatestObservationsForInterval(interval: Interval): Observation[] {
    const rows = this.allLatestObservationsStmt.all(interval, interval) as Array<{
      market: string;
      interval: string;
      ts: number;
      close: number;
      strategy_bias: string;
      confidence: number;
      trend: string;
      volatility: string;
      summary: string;
    }>;
    return rows.map((r) => ({
      market: r.market as Market,
      interval: r.interval as Interval,
      ts: r.ts,
      close: r.close,
      strategyBias: "observe",
      confidence: r.confidence,
      trend: r.trend as Observation["trend"],
      volatility: r.volatility as Observation["volatility"],
      summary: r.summary,
    }));
  }

  queryObservationOnDate(
    market: Market,
    interval: Interval,
    dayStartMs: number,
    dayEndMs: number,
  ): Observation | null {
    const row = this.observationByMarketDateStmt.get(
      market,
      interval,
      dayStartMs,
      dayEndMs,
    ) as
      | {
          id: number;
          market: string;
          interval: string;
          ts: number;
          close: number;
          strategy_bias: string;
          confidence: number;
          trend: string;
          volatility: string;
          summary: string;
        }
      | undefined;
    if (!row) return null;
    return {
      market: row.market as Market,
      interval: row.interval as Interval,
      ts: row.ts,
      close: row.close,
      strategyBias: "observe",
      confidence: row.confidence,
      trend: row.trend as Observation["trend"],
      volatility: row.volatility as Observation["volatility"],
      summary: row.summary,
    };
  }

  queryLatestObservationBeforeTs(
    market: Market,
    interval: Interval,
    beforeTs: number,
  ): Observation | null {
    const row = this.latestObservationBeforeTsStmt.get(
      market,
      interval,
      beforeTs,
    ) as
      | {
          id: number;
          market: string;
          interval: string;
          ts: number;
          close: number;
          strategy_bias: string;
          confidence: number;
          trend: string;
          volatility: string;
          summary: string;
        }
      | undefined;
    if (!row) return null;
    return {
      market: row.market as Market,
      interval: row.interval as Interval,
      ts: row.ts,
      close: row.close,
      strategyBias: "observe",
      confidence: row.confidence,
      trend: row.trend as Observation["trend"],
      volatility: row.volatility as Observation["volatility"],
      summary: row.summary,
    };
  }

  hasAnyObservation(market: Market, interval: Interval): boolean {
    const row = this.hasObservationStmt.get(market, interval);
    return row !== undefined;
  }

  insertAlertEvent(event: AlertEvent): boolean {
    const info = this.insertAlertEventStmt.run({
      market: event.market,
      interval: event.interval,
      ts: event.ts,
      type: event.type,
      severity: event.severity,
      fingerprint: event.fingerprint,
      title: event.title,
      body: event.body,
      dataJson: event.dataJson,
      sentAt: event.sentAt,
    });
    return info.changes > 0;
  }

  queryUnsentAlertEvents(limit: number): AlertEvent[] {
    const rows = this.unsentAlertEventsStmt.all(limit) as AlertEventRow[];
    return rows.map(alertEventFromRow);
  }

  queryAlertEvents(limit: number): AlertEvent[] {
    const rows = this.alertEventsStmt.all(limit) as AlertEventRow[];
    return rows.map(alertEventFromRow);
  }

  queryAlertEventsBetween(startTs: number, endTs: number): AlertEvent[] {
    const rows = this.alertEventsBetweenStmt.all(startTs, endTs) as AlertEventRow[];
    return rows.map(alertEventFromRow);
  }

  countAlertEvents(): { total: number; unsent: number } {
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM alert_events`).get() as { n: number };
    const unsent = this.db.prepare(`SELECT COUNT(*) AS n FROM alert_events WHERE sent_at IS NULL`).get() as { n: number };
    return { total: total.n, unsent: unsent.n };
  }

  markAlertEventSent(id: number, sentAt: number): void {
    this.markAlertEventSentStmt.run(sentAt, id);
  }

  insertDigestRun(run: DigestRun): boolean {
    const info = this.insertDigestRunStmt.run({
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      title: run.title,
      body: run.body,
      sentAt: run.sentAt,
    });
    return info.changes > 0;
  }

  queryDigestRun(periodStart: number, periodEnd: number): DigestRun | null {
    const row = this.digestRunByPeriodStmt.get(periodStart, periodEnd) as
      | {
          id: number;
          period_start: number;
          period_end: number;
          title: string;
          body: string;
          sent_at: number | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      title: row.title,
      body: row.body,
      sentAt: row.sent_at,
    };
  }

  markDigestRunSent(id: number, sentAt: number): void {
    this.markDigestRunSentStmt.run(sentAt, id);
  }

  upsertMarketMetrics(rows: readonly MarketMetric[]): number {
    if (rows.length === 0) return 0;
    const tx = this.db.transaction((items: readonly MarketMetric[]) => {
      let n = 0;
      for (const m of items) {
        this.upsertMarketMetricStmt.run({
          market: m.market,
          venue: m.venue,
          ts: m.ts,
          midPrice: m.midPrice,
          bestBid: m.bestBid,
          bestAsk: m.bestAsk,
          spreadBps: m.spreadBps,
          depthBid25Bps: m.depthBid25Bps,
          depthAsk25Bps: m.depthAsk25Bps,
          depthBid50Bps: m.depthBid50Bps,
          depthAsk50Bps: m.depthAsk50Bps,
          imbalance25Bps: m.imbalance25Bps,
          slippageBuy10kBps: m.slippageBuy10kBps,
          slippageSell10kBps: m.slippageSell10kBps,
          openInterest: m.openInterest,
          fundingRate: m.fundingRate,
          basisBps: m.basisBps,
        });
        n++;
      }
      return n;
    });
    return tx(rows);
  }

  queryLatestMarketMetrics(market: Market, limit = 4): MarketMetric[] {
    const rows = this.latestMarketMetricsStmt.all(market, limit) as MarketMetricRow[];
    return rows.map(marketMetricFromRow);
  }

  queryLatestMarketMetric(market: Market, venue: MarketMetric["venue"]): MarketMetric | null {
    const row = this.latestMarketMetricStmt.get(market, venue) as MarketMetricRow | undefined;
    return row ? marketMetricFromRow(row) : null;
  }

  queryMarketMetricAtOrBefore(
    market: Market,
    venue: MarketMetric["venue"],
    ts: number,
  ): MarketMetric | null {
    const row = this.marketMetricAtOrBeforeStmt.get(market, venue, ts) as MarketMetricRow | undefined;
    return row ? marketMetricFromRow(row) : null;
  }
}

type AlertEventRow = {
      id: number;
      market: string;
      interval: string;
      ts: number;
      type: AlertEvent["type"];
      severity: AlertEvent["severity"];
      fingerprint: string;
      title: string;
      body: string;
      data_json: string;
      sent_at: number | null;
};

function alertEventFromRow(r: AlertEventRow): AlertEvent {
  return {
    id: r.id,
    market: r.market as Market,
    interval: r.interval as Interval,
    ts: r.ts,
    type: r.type,
    severity: r.severity,
    fingerprint: r.fingerprint,
    title: r.title,
    body: r.body,
    dataJson: r.data_json,
    sentAt: r.sent_at,
  };
}

type MarketMetricRow = {
      market: string;
      venue: MarketMetric["venue"];
      ts: number;
      mid_price: number;
      best_bid: number;
      best_ask: number;
      spread_bps: number;
      depth_bid_25_bps: number;
      depth_ask_25_bps: number;
      depth_bid_50_bps: number;
      depth_ask_50_bps: number;
      imbalance_25_bps: number;
      slippage_buy_10k_bps: number | null;
      slippage_sell_10k_bps: number | null;
      open_interest: number | null;
      funding_rate: number | null;
      basis_bps: number | null;
};

function marketMetricFromRow(r: MarketMetricRow): MarketMetric {
  return {
    market: r.market as Market,
    venue: r.venue,
    ts: r.ts,
    midPrice: r.mid_price,
    bestBid: r.best_bid,
    bestAsk: r.best_ask,
    spreadBps: r.spread_bps,
    depthBid25Bps: r.depth_bid_25_bps,
    depthAsk25Bps: r.depth_ask_25_bps,
    depthBid50Bps: r.depth_bid_50_bps,
    depthAsk50Bps: r.depth_ask_50_bps,
    imbalance25Bps: r.imbalance_25_bps,
    slippageBuy10kBps: r.slippage_buy_10k_bps,
    slippageSell10kBps: r.slippage_sell_10k_bps,
    openInterest: r.open_interest,
    fundingRate: r.funding_rate,
    basisBps: r.basis_bps,
  };
}
