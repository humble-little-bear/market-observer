export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Market Observer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --ink: #17191c;
      --muted: #6b7280;
      --line: #d8dde6;
      --accent: #0f766e;
      --warn: #b45309;
      --danger: #b91c1c;
      --blue: #2563eb;
      --green: #0f9f6e;
      --red: #d23b3b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: rgba(247, 248, 250, 0.94);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(12px);
    }
    .bar {
      max-width: 1280px;
      margin: 0 auto;
      padding: 14px 18px;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 16px;
    }
    h1 { margin: 0; font-size: 18px; line-height: 1.1; }
    .tabs, .segmented {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    button {
      height: 34px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      border-radius: 6px;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    button.active {
      background: var(--ink);
      border-color: var(--ink);
      color: #fff;
    }
    main {
      max-width: 1280px;
      margin: 0 auto;
      padding: 16px 18px 28px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(6, minmax(120px, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }
    .metric, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric {
      min-height: 72px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .metric .label { color: var(--muted); font-size: 12px; }
    .metric .value { font-size: 20px; font-weight: 700; line-height: 1.1; }
    .metric .sub { color: var(--muted); font-size: 12px; }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(340px, 0.85fr);
      gap: 14px;
      align-items: start;
    }
    .stack { display: grid; gap: 14px; min-width: 0; }
    .panel { min-width: 0; overflow: hidden; }
    .panel-head {
      height: 42px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .panel h2 { margin: 0; font-size: 14px; }
    .chart-wrap { position: relative; height: 300px; padding: 10px; }
    .chart-wrap.compact { height: 220px; }
    canvas { display: block; width: 100%; height: 100%; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px; color: var(--muted); font-size: 12px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 99px; margin-right: 5px; }
    .events, .labels { padding: 10px 12px; display: grid; gap: 8px; }
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      width: fit-content;
      border-radius: 999px;
      padding: 3px 9px;
      background: #eef2f7;
      color: #111827;
      font-size: 12px;
      margin-right: 6px;
    }
    .tag.warn { background: #fff7ed; color: var(--warn); }
    .tag.danger { background: #fef2f2; color: var(--danger); }
    .event {
      border-left: 3px solid var(--line);
      padding-left: 9px;
      min-height: 44px;
    }
    .event.warn { border-left-color: var(--warn); }
    .event.critical { border-left-color: var(--danger); }
    .event-title { font-size: 13px; font-weight: 700; }
    .event-body { color: var(--muted); font-size: 12px; line-height: 1.35; white-space: pre-wrap; }
    .muted { color: var(--muted); }
    .error { color: var(--danger); padding: 16px; }
    @media (max-width: 980px) {
      .bar { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
      .chart-wrap { height: 260px; }
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
    <section class="metrics" id="metrics"></section>
    <section class="grid">
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <h2>价格</h2>
            <div class="segmented" id="intervalTabs">
              <button data-interval="15m" class="active">15m</button>
              <button data-interval="1h">1h</button>
              <button data-interval="4h">4h</button>
            </div>
          </div>
          <div class="chart-wrap"><canvas id="priceChart"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h2>深度 / 冲击</h2>
            <div class="legend">
              <span><i class="dot" style="background:var(--green)"></i>现货深度</span>
              <span><i class="dot" style="background:var(--blue)"></i>永续深度</span>
            </div>
          </div>
          <div class="chart-wrap compact"><canvas id="depthChart"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h2>合约</h2>
            <div class="legend">
              <span><i class="dot" style="background:var(--blue)"></i>OI</span>
              <span><i class="dot" style="background:var(--warn)"></i>基差 bps</span>
              <span><i class="dot" style="background:var(--green)"></i>资金费率 bps</span>
            </div>
          </div>
          <div class="chart-wrap compact"><canvas id="futuresChart"></canvas></div>
        </div>
      </div>
      <aside class="stack">
        <div class="panel">
          <div class="panel-head"><h2>结构标签</h2><span class="muted" id="updatedAt"></span></div>
          <div class="labels" id="labels"></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>最近提醒</h2></div>
          <div class="events" id="alerts"></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>观察记录</h2></div>
          <div class="events" id="observations"></div>
        </div>
      </aside>
    </section>
  </main>
  <script>
    const state = { market: null, hours: 24, interval: "15m", markets: [] };
    const $ = (id) => document.getElementById(id);
    const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
    const fmtPrice = (n) => n == null ? "n/a" : (Math.abs(n) >= 1000 ? Number(n).toFixed(2) : fmt.format(n));
    const fmtPct = (n) => n == null ? "n/a" : (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
    const fmtTs = (ts) => new Date(ts).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

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

    function metric(label, value, sub) {
      return '<div class="metric"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="sub">' + (sub || "") + '</div></div>';
    }

    function renderMetrics(summary) {
      const latest = summary.latestCandle;
      const fut = summary.structure?.futures;
      const spot = summary.structure?.spot;
      $("metrics").innerHTML = [
        metric("价格", fmtPrice(latest?.close), latest ? fmtTs(latest.closeTime) : "无数据"),
        metric("趋势", summary.primaryObservation ? zhTrend(summary.primaryObservation.trend) : "n/a", summary.primaryObservation ? zhVol(summary.primaryObservation.volatility) : ""),
        metric("现货25bps深度", spot ? compactUsd(spot.depthBid25Bps + spot.depthAsk25Bps) : "n/a", spot ? "imb " + spot.imbalance25Bps.toFixed(2) : ""),
        metric("永续25bps深度", fut ? compactUsd(fut.depthBid25Bps + fut.depthAsk25Bps) : "n/a", fut ? "imb " + fut.imbalance25Bps.toFixed(2) : ""),
        metric("基差 / 资金费率", fut ? fut.basisBps.toFixed(1) + "bps" : "n/a", fut?.fundingRate == null ? "" : (fut.fundingRate * 100).toFixed(4) + "%"),
        metric("Alert", String(summary.alertCount), "近 " + state.hours + " 小时")
      ].join("");
    }

    function zhTrend(v) { return v === "bullish" ? "多头" : v === "bearish" ? "空头" : "震荡"; }
    function zhVol(v) { return v === "high" ? "高波动" : v === "elevated" ? "波动升高" : v === "low" ? "低波动" : "正常"; }
    function compactUsd(v) {
      if (v == null) return "n/a";
      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "m";
      if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + "k";
      return v.toFixed(0);
    }

    function byVenue(metrics, venue) { return metrics.filter((m) => m.venue === venue); }
    function depthSeries(metrics, venue) {
      return byVenue(metrics, venue).map((m) => ({ ts: m.ts, value: m.depthBid25Bps + m.depthAsk25Bps }));
    }
    function pctFromFirst(rows, getValue) {
      const first = rows.map(getValue).find((v) => Number.isFinite(v) && v !== 0);
      return rows.map((row) => {
        const value = getValue(row);
        return { ts: row.ts, value: first ? ((value - first) / first) * 100 : null };
      });
    }

    function renderLabels(insight) {
      if (!insight) {
        $("labels").innerHTML = '<div class="muted">暂无结构数据</div>';
        return;
      }
      const tags = insight.labels.map((label) => '<span class="tag ' + tagClass(label) + '">' + label + '</span>').join("");
      const lines = insight.abnormalLines.map((line) => '<div class="event"><div class="event-body">' + escapeHtml(line) + '</div></div>').join("");
      $("labels").innerHTML = '<div>' + tags + '</div>' + (lines || '<div class="muted">暂无异常展开项</div>');
      $("updatedAt").textContent = insight.futures?.ts || insight.spot?.ts ? fmtTs(Math.max(insight.futures?.ts || 0, insight.spot?.ts || 0)) : "";
    }

    function tagClass(label) {
      if (label.includes("变薄") || label.includes("偏离")) return "warn";
      if (label.includes("拥挤")) return "danger";
      return "";
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function renderEvents(root, items, empty) {
      root.innerHTML = items.length ? items.map((item) =>
        '<div class="event ' + (item.severity || "") + '"><div class="event-title">' + escapeHtml(item.title) + '</div><div class="event-body">' + escapeHtml(item.body || item.summary || "") + '</div><div class="event-body">' + fmtTs(item.ts) + '</div></div>'
      ).join("") : '<div class="muted">' + empty + '</div>';
    }

    function drawLineChart(canvas, series, opts = {}) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const pad = { left: 52, right: 14, top: 14, bottom: 28 };
      const all = series.flatMap((s) => s.data).filter((p) => Number.isFinite(p.value));
      if (all.length < 2) {
        ctx.fillStyle = "#6b7280"; ctx.font = "13px sans-serif"; ctx.fillText("暂无足够数据", pad.left, pad.top + 18); return;
      }
      const minX = Math.min(...all.map((p) => p.ts));
      const maxX = Math.max(...all.map((p) => p.ts));
      let minY = Math.min(...all.map((p) => p.value));
      let maxY = Math.max(...all.map((p) => p.value));
      if (minY === maxY) { minY *= 0.99; maxY *= 1.01; }
      const yPad = (maxY - minY) * 0.08;
      minY -= yPad; maxY += yPad;
      const w = rect.width - pad.left - pad.right;
      const h = rect.height - pad.top - pad.bottom;
      const x = (ts) => pad.left + ((ts - minX) / Math.max(1, maxX - minX)) * w;
      const y = (v) => pad.top + (1 - (v - minY) / Math.max(1e-12, maxY - minY)) * h;
      ctx.strokeStyle = "#d8dde6"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const yy = pad.top + (h * i) / 3;
        ctx.moveTo(pad.left, yy); ctx.lineTo(rect.width - pad.right, yy);
      }
      ctx.stroke();
      ctx.fillStyle = "#6b7280"; ctx.font = "11px sans-serif";
      ctx.fillText(fmtAxis(maxY, opts.axis), 4, pad.top + 4);
      ctx.fillText(fmtAxis(minY, opts.axis), 4, pad.top + h);
      ctx.fillText(fmtTs(minX), pad.left, rect.height - 8);
      ctx.fillText(fmtTs(maxX), Math.max(pad.left, rect.width - 92), rect.height - 8);
      for (const s of series) {
        const data = s.data.filter((p) => Number.isFinite(p.value));
        ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
        data.forEach((p, i) => { const xx = x(p.ts), yy = y(p.value); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
        ctx.stroke();
      }
    }
    function fmtAxis(v, axis) {
      if (axis === "usd") return compactUsd(v);
      if (axis === "pct") return v.toFixed(2);
      return fmtPrice(v);
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
        renderMetrics(summary);
        renderLabels(summary.structureInsight);
        renderEvents($("alerts"), alerts.alerts.slice().reverse().slice(0, 10), "暂无提醒");
        renderEvents($("observations"), observations.observations.slice(-10).reverse().map((o) => ({ title: o.interval + " " + zhTrend(o.trend) + " / " + zhVol(o.volatility), body: o.summary, ts: o.ts })), "暂无观察");
        drawLineChart($("priceChart"), [{ color: "#17191c", data: candles.candles.map((c) => ({ ts: c.closeTime, value: c.close })) }]);
        drawLineChart($("depthChart"), [
          { color: "#0f9f6e", data: depthSeries(structure.metrics, "spot") },
          { color: "#2563eb", data: depthSeries(structure.metrics, "futures") }
        ], { axis: "usd" });
        const futuresRows = byVenue(structure.metrics, "futures");
        drawLineChart($("futuresChart"), [
          { color: "#2563eb", data: pctFromFirst(futuresRows, (m) => m.openInterest) },
          { color: "#b45309", data: futuresRows.map((m) => ({ ts: m.ts, value: m.basisBps })) },
          { color: "#0f9f6e", data: futuresRows.map((m) => ({ ts: m.ts, value: m.fundingRate == null ? null : m.fundingRate * 10000 })) }
        ], { axis: "pct" });
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
