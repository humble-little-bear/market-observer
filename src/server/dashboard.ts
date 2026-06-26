export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Market Observer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: oklch(0.975 0.006 210);
      --panel: oklch(0.995 0.004 210);
      --ink: oklch(0.18 0.012 230);
      --muted: oklch(0.47 0.018 230);
      --line: oklch(0.88 0.012 225);
      --soft: oklch(0.95 0.012 225);
      --buy: oklch(0.47 0.13 160);
      --sell: oklch(0.55 0.16 25);
      --contract: oklch(0.48 0.13 260);
      --warn: oklch(0.58 0.15 70);
      --bad: oklch(0.52 0.17 25);
      --good: oklch(0.48 0.13 155);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 3;
      background: color-mix(in oklch, var(--bg) 92%, transparent);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(10px);
    }
    .bar {
      max-width: 1380px;
      margin: 0 auto;
      padding: 12px 18px;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 14px;
      align-items: center;
    }
    h1 { margin: 0; font-size: 17px; line-height: 1; font-weight: 800; }
    h2 { margin: 0; font-size: 13px; font-weight: 800; }
    button {
      height: 32px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 6px;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    button.active { background: var(--ink); border-color: var(--ink); color: var(--panel); }
    .tabs, .segmented { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
    main { max-width: 1380px; margin: 0 auto; padding: 14px 18px 28px; }
    .status {
      display: grid;
      grid-template-columns: minmax(220px, 0.9fr) minmax(280px, 1.2fr) minmax(360px, 1.5fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .panel, .strip, .cell {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-width: 0;
    }
    .strip { padding: 12px; }
    .label { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .price { font-size: 30px; line-height: 1.05; font-weight: 850; margin-top: 5px; }
    .sub { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 3px 8px;
      background: var(--soft);
      color: var(--ink);
      font-size: 12px;
      font-weight: 700;
    }
    .tag.warn { color: var(--warn); background: oklch(0.96 0.04 80); }
    .tag.bad { color: var(--bad); background: oklch(0.96 0.035 25); }
    .tag.good { color: var(--good); background: oklch(0.95 0.035 155); }
    .thesis {
      font-size: 15px;
      line-height: 1.45;
      font-weight: 750;
      margin-top: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.75fr);
      gap: 12px;
      align-items: start;
    }
    .stack { display: grid; gap: 12px; min-width: 0; }
    .panel-head {
      height: 40px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .matrix {
      display: grid;
      grid-template-columns: 118px repeat(4, minmax(120px, 1fr));
      overflow-x: auto;
    }
    .m-head, .m-row-title, .m-cell {
      min-height: 76px;
      padding: 10px;
      border-bottom: 1px solid var(--line);
      border-right: 1px solid var(--line);
    }
    .m-head {
      min-height: 40px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      background: var(--soft);
    }
    .m-row-title {
      font-size: 12px;
      font-weight: 850;
      background: oklch(0.985 0.006 220);
    }
    .m-cell strong { display: block; font-size: 18px; line-height: 1.1; margin-bottom: 4px; }
    .m-cell span { display: block; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .m-cell.good strong { color: var(--good); }
    .m-cell.bad strong { color: var(--bad); }
    .m-cell.warn strong { color: var(--warn); }
    .depth-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 12px;
    }
    .depth-block {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: oklch(0.985 0.005 220);
    }
    .book-bars { display: grid; gap: 8px; margin-top: 10px; }
    .barline { display: grid; grid-template-columns: 42px 1fr 70px; gap: 8px; align-items: center; font-size: 12px; }
    .rail { height: 10px; border-radius: 999px; background: var(--soft); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; }
    .fill.buy { background: var(--buy); }
    .fill.sell { background: var(--sell); }
    .evidence { padding: 10px 12px; display: grid; gap: 8px; }
    .item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px;
      background: oklch(0.99 0.004 220);
    }
    .item-title { font-size: 13px; font-weight: 800; }
    .item-body { color: var(--muted); font-size: 12px; line-height: 1.4; white-space: pre-wrap; margin-top: 3px; }
    .chart-wrap { height: 170px; padding: 8px 10px 10px; }
    canvas { width: 100%; height: 100%; display: block; }
    .mini-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px; }
    .mini { border: 1px solid var(--line); border-radius: 8px; padding: 9px; background: oklch(0.987 0.005 220); }
    .mini strong { display: block; font-size: 17px; }
    .muted { color: var(--muted); }
    .error { color: var(--bad); padding: 16px; }
    @media (max-width: 980px) {
      .bar { grid-template-columns: 1fr; }
      .status, .grid, .depth-grid, .mini-row { grid-template-columns: 1fr; }
      .matrix { grid-template-columns: 105px repeat(4, minmax(145px, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <h1>Market Observer</h1>
      <nav id="marketTabs" class="tabs"></nav>
      <div class="segmented" id="rangeTabs">
        <button data-hours="6">6h</button>
        <button data-hours="24" class="active">24h</button>
        <button data-hours="72">72h</button>
      </div>
    </div>
  </header>
  <main>
    <section class="status">
      <div class="strip" id="priceStrip"></div>
      <div class="strip" id="thesisStrip"></div>
      <div class="strip" id="pressureStrip"></div>
    </section>

    <section class="grid">
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <h2>信号矩阵</h2>
            <div class="segmented" id="intervalTabs">
              <button data-interval="15m" class="active">15m</button>
              <button data-interval="1h">1h</button>
              <button data-interval="4h">4h</button>
            </div>
          </div>
          <div class="matrix" id="matrix"></div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>买盘 / 卖盘深度</h2><span class="sub">25bps 与 50bps</span></div>
          <div class="depth-grid" id="depthGrid"></div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>证据小图</h2><span class="sub">价格、买卖盘深度、合约压力</span></div>
          <div class="mini-row">
            <div class="mini"><span class="label">价格</span><div class="chart-wrap"><canvas id="priceChart"></canvas></div></div>
            <div class="mini"><span class="label">买/卖盘</span><div class="chart-wrap"><canvas id="bookChart"></canvas></div></div>
            <div class="mini"><span class="label">合约</span><div class="chart-wrap"><canvas id="contractChart"></canvas></div></div>
          </div>
        </div>
      </div>

      <aside class="stack">
        <div class="panel">
          <div class="panel-head"><h2>结构解释</h2><span class="sub" id="updatedAt"></span></div>
          <div class="evidence" id="structureNotes"></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>最近提醒</h2></div>
          <div class="evidence" id="alerts"></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>观察记录</h2></div>
          <div class="evidence" id="observations"></div>
        </div>
      </aside>
    </section>
  </main>

  <script>
    const state = { market: null, hours: 24, interval: "15m", markets: [] };
    const $ = (id) => document.getElementById(id);
    const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
    const fmtPrice = (n) => n == null ? "n/a" : (Math.abs(n) >= 1000 ? Number(n).toFixed(2) : fmt.format(n));
    const fmtPct = (n, d = 2) => n == null || !Number.isFinite(n) ? "n/a" : (n >= 0 ? "+" : "") + Number(n).toFixed(d) + "%";
    const fmtBps = (n) => n == null || !Number.isFinite(n) ? "n/a" : (n >= 0 ? "+" : "") + Number(n).toFixed(1) + "bps";
    const fmtTs = (ts) => ts ? new Date(ts).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "n/a";
    const zhTrend = (v) => v === "bullish" ? "多头" : v === "bearish" ? "空头" : v === "ranging" ? "震荡" : "n/a";
    const zhVol = (v) => v === "high" ? "高波动" : v === "elevated" ? "波动升高" : v === "low" ? "低波动" : v === "normal" ? "正常" : "n/a";
    const compactUsd = (v) => {
      if (v == null || !Number.isFinite(v)) return "n/a";
      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "m";
      if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + "k";
      return v.toFixed(0);
    };
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    async function getJson(path) {
      const res = await fetch(path);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    function setButtons(root, attr, value) {
      [...root.querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b.dataset[attr] === String(value)));
    }

    function renderMarketTabs() {
      $("marketTabs").innerHTML = state.markets.map((m) => '<button data-market="' + m + '">' + m.replace(/USDT$/, "") + '</button>').join("");
      $("marketTabs").onclick = (e) => {
        const btn = e.target.closest("button[data-market]");
        if (!btn) return;
        state.market = btn.dataset.market;
        setButtons($("marketTabs"), "market", state.market);
        refresh();
      };
      setButtons($("marketTabs"), "market", state.market);
    }

    $("rangeTabs").onclick = (e) => {
      const btn = e.target.closest("button[data-hours]");
      if (!btn) return;
      state.hours = Number(btn.dataset.hours);
      setButtons($("rangeTabs"), "hours", state.hours);
      refresh();
    };
    $("intervalTabs").onclick = (e) => {
      const btn = e.target.closest("button[data-interval]");
      if (!btn) return;
      state.interval = btn.dataset.interval;
      setButtons($("intervalTabs"), "interval", state.interval);
      refresh();
    };

    function byVenue(metrics, venue) { return metrics.filter((m) => m.venue === venue); }
    function latest(rows) { return rows.length ? rows[rows.length - 1] : null; }
    function priorBefore(rows, ms) {
      const latestRow = latest(rows);
      if (!latestRow) return null;
      const target = latestRow.ts - ms;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].ts <= target) return rows[i];
      return null;
    }
    function pctChange(from, to) {
      if (from == null || to == null || from === 0) return null;
      return ((to - from) / from) * 100;
    }
    function depth25(m) { return m ? m.depthBid25Bps + m.depthAsk25Bps : null; }
    function bidAsk(m, bps) {
      if (!m) return { bid: null, ask: null };
      return bps === 50
        ? { bid: m.depthBid50Bps, ask: m.depthAsk50Bps }
        : { bid: m.depthBid25Bps, ask: m.depthAsk25Bps };
    }

    function computeContext(summary, candles, structure) {
      const spotRows = byVenue(structure.metrics, "spot");
      const futRows = byVenue(structure.metrics, "futures");
      const spot = summary.structure?.spot || latest(spotRows);
      const fut = summary.structure?.futures || latest(futRows);
      const oldSpot1h = priorBefore(spotRows, 60 * 60 * 1000);
      const oldFut1h = priorBefore(futRows, 60 * 60 * 1000);
      const oldSpot4h = priorBefore(spotRows, 4 * 60 * 60 * 1000);
      const oldFut4h = priorBefore(futRows, 4 * 60 * 60 * 1000);
      const firstCandle = candles.candles[0];
      const lastCandle = candles.candles[candles.candles.length - 1] || summary.latestCandle;
      return {
        spotRows, futRows, spot, fut,
        priceChange: pctChange(firstCandle?.close, lastCandle?.close),
        spotDepth1h: pctChange(depth25(oldSpot1h), depth25(spot)),
        futDepth1h: pctChange(depth25(oldFut1h), depth25(fut)),
        spotDepth4h: pctChange(depth25(oldSpot4h), depth25(spot)),
        futDepth4h: pctChange(depth25(oldFut4h), depth25(fut)),
        oi1h: pctChange(oldFut1h?.openInterest, fut?.openInterest),
        oi4h: pctChange(oldFut4h?.openInterest, fut?.openInterest),
        bidAskSpot25: bidAsk(spot, 25),
        bidAskSpot50: bidAsk(spot, 50),
        bidAskFut25: bidAsk(fut, 25),
        bidAskFut50: bidAsk(fut, 50),
      };
    }

    function tagClass(label) {
      if (label.includes("变薄") || label.includes("偏离")) return "warn";
      if (label.includes("拥挤") || label.includes("偏空")) return "bad";
      if (label.includes("偏多") || label.includes("平稳")) return "good";
      return "";
    }

    function thesis(summary, ctx) {
      const labels = summary.structureInsight?.labels || [];
      if (labels.includes("永续拥挤")) return "合约仓位正在放大，价格方向需要和 OI、资金费率一起看。";
      if (labels.includes("期现偏离")) return "永续和现货出现分歧，当前价格动作可能更多来自合约端。";
      if (labels.includes("流动性变薄")) return "近端深度变薄，价格更容易被订单推着跳。";
      if (labels.includes("盘口偏空")) return "近端卖盘/撤买更占优，上方或下方流动性不对称。";
      if (labels.includes("盘口偏多")) return "近端买盘更厚，短线下方承接相对强。";
      if (summary.primaryObservation) return "结构暂未给出强信号，先看价格趋势和波动状态。";
      return "暂无足够连续结构数据。";
    }

    function renderTop(summary, ctx) {
      const latest = summary.latestCandle;
      const obs = summary.primaryObservation;
      const labels = summary.structureInsight?.labels || ["暂无结构"];
      $("priceStrip").innerHTML =
        '<div class="label">' + summary.market + '</div>' +
        '<div class="price">' + fmtPrice(latest?.close) + '</div>' +
        '<div class="sub">' + state.interval + ' ' + fmtPct(ctx.priceChange) + '，4h ' + zhTrend(obs?.trend) + ' / ' + zhVol(obs?.volatility) + '</div>';
      $("thesisStrip").innerHTML =
        '<div class="label">机器读法</div><div class="thesis">' + escapeHtml(thesis(summary, ctx)) + '</div>' +
        '<div class="tags">' + labels.map((l) => '<span class="tag ' + tagClass(l) + '">' + escapeHtml(l) + '</span>').join("") + '</div>';
      $("pressureStrip").innerHTML =
        '<div class="label">压力概览</div>' +
        '<div class="mini-row" style="padding:8px 0 0; grid-template-columns:repeat(3,1fr)">' +
        '<div><div class="sub">现货深度1h</div><strong>' + fmtPct(ctx.spotDepth1h, 0) + '</strong></div>' +
        '<div><div class="sub">永续OI1h</div><strong>' + fmtPct(ctx.oi1h, 2) + '</strong></div>' +
        '<div><div class="sub">基差/资金</div><strong>' + fmtBps(ctx.fut?.basisBps) + '</strong><div class="sub">' + (ctx.fut?.fundingRate == null ? "n/a" : (ctx.fut.fundingRate * 100).toFixed(4) + "%") + '</div></div>' +
        '</div>';
    }

    function signalCell(value, detail, kind) {
      return '<div class="m-cell ' + (kind || "") + '"><strong>' + value + '</strong><span>' + detail + '</span></div>';
    }

    function classifyDepth(v) {
      if (v == null) return "";
      if (v <= -30) return "bad";
      if (v >= 30) return "good";
      return "";
    }

    function renderMatrix(summary, ctx) {
      const obs = summary.primaryObservation;
      const fut = ctx.fut;
      $("matrix").innerHTML = [
        '<div class="m-head"></div><div class="m-head">价格</div><div class="m-head">现货盘口</div><div class="m-head">永续盘口</div><div class="m-head">合约</div>',
        '<div class="m-row-title">当前</div>',
        signalCell(fmtPrice(summary.latestCandle?.close), state.interval + ' ' + fmtPct(ctx.priceChange), ctx.priceChange < 0 ? "bad" : ctx.priceChange > 0 ? "good" : ""),
        signalCell(compactUsd(depth25(ctx.spot)), 'bid ' + compactUsd(ctx.bidAskSpot25.bid) + ' / ask ' + compactUsd(ctx.bidAskSpot25.ask), ctx.spot?.imbalance25Bps < -0.25 ? "bad" : ctx.spot?.imbalance25Bps > 0.25 ? "good" : ""),
        signalCell(compactUsd(depth25(ctx.fut)), 'bid ' + compactUsd(ctx.bidAskFut25.bid) + ' / ask ' + compactUsd(ctx.bidAskFut25.ask), ctx.fut?.imbalance25Bps < -0.25 ? "bad" : ctx.fut?.imbalance25Bps > 0.25 ? "good" : ""),
        signalCell(fut ? fmtBps(fut.basisBps) : "n/a", 'OI ' + compactUsd(fut?.openInterest) + ' / funding ' + (fut?.fundingRate == null ? "n/a" : (fut.fundingRate * 100).toFixed(4) + "%"), Math.abs(fut?.basisBps || 0) >= 8 ? "warn" : ""),
        '<div class="m-row-title">1h变化</div>',
        signalCell(zhTrend(obs?.trend), zhVol(obs?.volatility), obs?.trend === "bearish" ? "bad" : obs?.trend === "bullish" ? "good" : ""),
        signalCell(fmtPct(ctx.spotDepth1h, 0), '25bps 总深度', classifyDepth(ctx.spotDepth1h)),
        signalCell(fmtPct(ctx.futDepth1h, 0), '25bps 总深度', classifyDepth(ctx.futDepth1h)),
        signalCell(fmtPct(ctx.oi1h, 2), 'OI 变化', ctx.oi1h >= 2 ? "warn" : ""),
        '<div class="m-row-title">4h变化</div>',
        signalCell(zhTrend(obs?.trend), '4h 主周期', obs?.trend === "bearish" ? "bad" : obs?.trend === "bullish" ? "good" : ""),
        signalCell(fmtPct(ctx.spotDepth4h, 0), '现货深度', classifyDepth(ctx.spotDepth4h)),
        signalCell(fmtPct(ctx.futDepth4h, 0), '永续深度', classifyDepth(ctx.futDepth4h)),
        signalCell(fmtPct(ctx.oi4h, 2), 'OI 变化', ctx.oi4h >= 2 ? "warn" : "")
      ].join("");
    }

    function depthBlock(title, m) {
      const max = Math.max(m?.depthBid50Bps || 0, m?.depthAsk50Bps || 0, 1);
      const row = (name, value, side) =>
        '<div class="barline"><span>' + name + '</span><div class="rail"><div class="fill ' + side + '" style="width:' + Math.max(3, (value || 0) / max * 100) + '%"></div></div><strong>' + compactUsd(value) + '</strong></div>';
      return '<div class="depth-block"><div class="label">' + title + '</div><div class="book-bars">' +
        row('买25', m?.depthBid25Bps, 'buy') + row('卖25', m?.depthAsk25Bps, 'sell') +
        row('买50', m?.depthBid50Bps, 'buy') + row('卖50', m?.depthAsk50Bps, 'sell') +
        '</div><div class="sub" style="margin-top:8px">imb ' + (m ? m.imbalance25Bps.toFixed(2) : 'n/a') + '，spread ' + (m ? m.spreadBps.toFixed(2) : 'n/a') + 'bps</div></div>';
    }

    function renderDepth(ctx) {
      $("depthGrid").innerHTML = depthBlock("现货 order book", ctx.spot) + depthBlock("永续 order book", ctx.fut);
    }

    function item(title, body, ts, severity) {
      return '<div class="item ' + (severity || "") + '"><div class="item-title">' + escapeHtml(title) + '</div><div class="item-body">' + escapeHtml(body || "") + '</div><div class="item-body">' + (ts ? fmtTs(ts) : "") + '</div></div>';
    }

    function renderSide(summary, alerts, observations) {
      const insight = summary.structureInsight;
      const notes = [];
      if (insight) {
        notes.push('<div><div class="tags">' + insight.labels.map((l) => '<span class="tag ' + tagClass(l) + '">' + escapeHtml(l) + '</span>').join("") + '</div></div>');
        for (const line of insight.abnormalLines || []) notes.push(item("结构原因", line, null));
      }
      $("structureNotes").innerHTML = notes.length ? notes.join("") : '<div class="muted">暂无结构解释</div>';
      $("updatedAt").textContent = fmtTs(Math.max(insight?.spot?.ts || 0, insight?.futures?.ts || 0));
      $("alerts").innerHTML = alerts.alerts.length ? alerts.alerts.slice().reverse().slice(0, 8).map((a) => item(a.title, a.body, a.ts, a.severity)).join("") : '<div class="muted">暂无提醒</div>';
      $("observations").innerHTML = observations.observations.length
        ? observations.observations.slice(-8).reverse().map((o) => item(o.interval + ' ' + zhTrend(o.trend) + ' / ' + zhVol(o.volatility), o.summary, o.ts)).join("")
        : '<div class="muted">暂无观察</div>';
    }

    function drawLineChart(canvas, series, opts = {}) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const pad = { left: 38, right: 8, top: 8, bottom: 20 };
      const all = series.flatMap((s) => s.data).filter((p) => Number.isFinite(p.value));
      if (all.length < 2) { ctx.fillStyle = "oklch(0.47 0.018 230)"; ctx.font = "12px sans-serif"; ctx.fillText("数据不足", 8, 20); return; }
      const minX = Math.min(...all.map((p) => p.ts));
      const maxX = Math.max(...all.map((p) => p.ts));
      let minY = Math.min(...all.map((p) => p.value));
      let maxY = Math.max(...all.map((p) => p.value));
      if (minY === maxY) { minY *= 0.99; maxY *= 1.01; }
      const yPad = (maxY - minY) * 0.1;
      minY -= yPad; maxY += yPad;
      const w = rect.width - pad.left - pad.right;
      const h = rect.height - pad.top - pad.bottom;
      const x = (ts) => pad.left + ((ts - minX) / Math.max(1, maxX - minX)) * w;
      const y = (v) => pad.top + (1 - (v - minY) / Math.max(1e-12, maxY - minY)) * h;
      ctx.strokeStyle = "oklch(0.88 0.012 225)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + h); ctx.lineTo(pad.left + w, pad.top + h); ctx.stroke();
      ctx.fillStyle = "oklch(0.47 0.018 230)"; ctx.font = "10px sans-serif";
      ctx.fillText(formatAxis(maxY, opts.axis), 2, pad.top + 4);
      ctx.fillText(formatAxis(minY, opts.axis), 2, pad.top + h);
      for (const s of series) {
        const data = s.data.filter((p) => Number.isFinite(p.value));
        ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
        data.forEach((p, i) => { const xx = x(p.ts), yy = y(p.value); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
        ctx.stroke();
      }
    }
    function formatAxis(v, axis) {
      if (axis === "usd") return compactUsd(v);
      if (axis === "pct") return v.toFixed(1);
      return fmtPrice(v);
    }
    function pctFromFirst(rows, getValue) {
      const first = rows.map(getValue).find((v) => Number.isFinite(v) && v !== 0);
      return rows.map((row) => ({ ts: row.ts, value: first ? ((getValue(row) - first) / first) * 100 : null }));
    }

    function renderCharts(candles, structure, ctx) {
      drawLineChart($("priceChart"), [{ color: "oklch(0.18 0.012 230)", data: candles.candles.map((c) => ({ ts: c.closeTime, value: c.close })) }]);
      drawLineChart($("bookChart"), [
        { color: "oklch(0.47 0.13 160)", data: ctx.spotRows.map((m) => ({ ts: m.ts, value: m.depthBid25Bps })) },
        { color: "oklch(0.55 0.16 25)", data: ctx.spotRows.map((m) => ({ ts: m.ts, value: m.depthAsk25Bps })) },
        { color: "oklch(0.48 0.13 260)", data: ctx.futRows.map((m) => ({ ts: m.ts, value: m.depthBid25Bps })) }
      ], { axis: "usd" });
      drawLineChart($("contractChart"), [
        { color: "oklch(0.48 0.13 260)", data: pctFromFirst(ctx.futRows, (m) => m.openInterest) },
        { color: "oklch(0.58 0.15 70)", data: ctx.futRows.map((m) => ({ ts: m.ts, value: m.basisBps })) },
        { color: "oklch(0.47 0.13 160)", data: ctx.futRows.map((m) => ({ ts: m.ts, value: m.fundingRate == null ? null : m.fundingRate * 10000 })) }
      ], { axis: "pct" });
    }

    async function refresh() {
      if (!state.market) return;
      try {
        const qs = 'market=' + encodeURIComponent(state.market) + '&hours=' + state.hours;
        const [summary, candles, structure, alerts, observations] = await Promise.all([
          getJson('/api/summary?' + qs + '&interval=' + state.interval),
          getJson('/api/candles?' + qs + '&interval=' + state.interval),
          getJson('/api/structure?' + qs),
          getJson('/api/alerts?' + qs),
          getJson('/api/observations?' + qs)
        ]);
        const ctx = computeContext(summary, candles, structure);
        renderTop(summary, ctx);
        renderMatrix(summary, ctx);
        renderDepth(ctx);
        renderSide(summary, alerts, observations);
        renderCharts(candles, structure, ctx);
      } catch (e) {
        document.querySelector("main").innerHTML = '<div class="panel error">' + escapeHtml(e.message || e) + '</div>';
      }
    }

    async function boot() {
      const data = await getJson('/api/markets');
      state.markets = data.markets;
      state.market = state.markets[0];
      renderMarketTabs();
      await refresh();
      setInterval(refresh, 60000);
    }
    window.addEventListener("resize", () => refresh());
    boot();
  </script>
</body>
</html>`;
