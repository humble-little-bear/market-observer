# Market Structure Methodology

这份文档解释 `market_metrics` 记录了什么、为什么先选这些维度，以及后续 agent 或人类该怎么读这些数据。

## 目标

K 线回答的是“价格已经怎么走了”。市场结构想补另一层问题：

- 现在这条价格路径是不是容易被打穿？
- 流动性是在变厚还是变薄？
- 现货和永续有没有明显分歧？
- 永续仓位和资金费率有没有显示拥挤？
- 当前波动更像自然趋势、流动性真空，还是杠杆挤压？

第一版只做记录和摘要，不直接把这些指标大量升级成 alert。原因是盘口/OI/资金费率都有很强的市场状态依赖，先积累几天样本，再定阈值会更稳。

## 数据面板

表：`market_metrics`

每次结构采样会为一个 symbol 记录两行：

- `venue = spot`
- `venue = futures`

字段：

- `mid_price`：盘口中间价，`(best_bid + best_ask) / 2`。
- `best_bid` / `best_ask`：最优买一/卖一。
- `spread_bps`：买卖价差，单位 bps。越大代表立即成交成本越高。
- `depth_bid_25_bps` / `depth_ask_25_bps`：距离 mid 25bps 内的买盘/卖盘 quote 深度。
- `depth_bid_50_bps` / `depth_ask_50_bps`：距离 mid 50bps 内的买盘/卖盘 quote 深度。
- `imbalance_25_bps`：25bps 内盘口偏斜，`(bid_depth - ask_depth) / (bid_depth + ask_depth)`。
- `slippage_buy_10k_bps` / `slippage_sell_10k_bps`：用 `STRUCTURE_SLIPPAGE_NOTIONAL` 估算市价买/卖的冲击成本。
- `open_interest`：永续合约未平仓量，只记录在 `futures` 行。
- `funding_rate`：最近一条资金费率，只记录在 `futures` 行。
- `basis_bps`：永续 mid 相对现货 mid 的溢价，`(futures_mid - spot_mid) / spot_mid * 10000`。

## 为什么选这些

### 1. Spread: 最直接的交易摩擦

Spread 是市场愿意立刻成交的最小成本。价格没怎么动但 spread 变宽，通常说明做市深度在撤，或者市场在等待信息落地。

### 2. Depth within bps: 可成交的缓冲垫

只看盘口总深度容易被远离价格的挂单污染。25bps/50bps 是“当前价格附近能吸收多少交易”的简化刻度。

可读法：

- bid/ask 两边都变薄：流动性枯竭，价格更容易跳。
- bid 变薄、ask 变厚：下行更容易。
- bid 变厚、ask 变薄：上行更容易。

### 3. Imbalance: 近端订单簿偏斜

`imbalance_25_bps` 在 `-1..1` 之间：

- 接近 `1`：近端买盘更厚。
- 接近 `-1`：近端卖盘更厚。
- 接近 `0`：两边相对均衡。

它不能单独预测方向，因为挂单会撤，也可能是诱导性流动性。更适合作为价格突破或急跌时的解释变量。

### 4. Slippage: 把盘口翻译成真实成交成本

Depth 是静态量，slippage 更接近“现在用一笔固定资金冲进去要付多少钱”。第一版默认 `10,000 USDT`，适合作为个人观察尺度。

可读法：

- buy/sell slippage 都升高：整体流动性变差。
- buy slippage 显著高于 sell：上方卖盘更薄。
- sell slippage 显著高于 buy：下方买盘更薄。

### 5. Open Interest: 杠杆仓位是否在堆

OI 单独看意义不大，必须和价格一起看：

- 价格涨 + OI 涨：新增杠杆顺势进入，趋势可能更强，但也更拥挤。
- 价格涨 + OI 跌：空头回补或仓位退出，持续性需要打问号。
- 价格跌 + OI 涨：新增空头或多头被动扛单，后续挤压风险上升。
- 价格跌 + OI 跌：去杠杆或平仓释放，可能是清算后的降温。

第一版先记录最新 OI；后续可以在 1h/4h 窗口上计算 OI 变化率。

### 6. Funding and Basis: 永续拥挤度

Funding 和 basis 都描述永续和现货的关系。

- funding 明显为正：多头愿意付费持仓，市场偏多且可能拥挤。
- funding 明显为负：空头愿意付费持仓，市场偏空且可能拥挤。
- futures basis 明显为正：永续相对现货溢价。
- futures basis 明显为负：永续相对现货折价。

它们不是方向信号，更像“哪一边已经付出了拥挤成本”的温度计。

## 组合读法

### 流动性真空

特征：

- spread 变宽。
- 25bps/50bps depth 同时下降。
- 10k slippage 上升。
- 价格出现 15m sharp move。

解释：价格移动可能不是“观点突然一致”，而是近端流动性撤退后被订单推着走。

### 杠杆拥挤

特征：

- OI 上升。
- funding/basis 朝一个方向明显偏。
- 价格也同向移动。

解释：趋势可能更强，但反向清算/挤压风险也更高。

### 现货确认 vs 永续拉扯

特征：

- 现货深度健康，永续 basis/funding 偏离不大：走势更像现货共识。
- 永续 basis/funding 偏离明显，但现货深度没有跟上：走势更像合约端杠杆拉扯。

### 假突破候选

特征：

- 价格突破。
- OI 快速上升。
- funding/basis 变拥挤。
- 现货 depth 没有同步变厚，或 slippage 变差。

解释：不是一定失败，但值得后续 alert 层更谨慎地标注“杠杆驱动”。

## 窗口对比和结构标签

`structure/insights` 会把最新结构指标和 15m、1h、4h 前的最近采样点做比较，生成窗口变化率和中文标签。

窗口变化：

- `spotDepth25Pct`：现货 25bps 总深度变化。
- `futuresDepth25Pct`：永续 25bps 总深度变化。
- `spotSlippagePct` / `futuresSlippagePct`：10k 冲击成本变化。
- `openInterestPct`：永续 OI 变化。
- `basisBpsChange`：期现基差变化，单位 bps。
- `fundingRateChange`：资金费率变化。

标签：

- `流动性变薄`：1h 或 4h 内，现货/永续 25bps 深度下降超过 30%，或 10k 冲击成本上升超过 50%。
- `永续拥挤`：1h 或 4h OI 上升超过 2%，且资金费率或期现基差已经明显偏离。
- `期现偏离`：永续相对现货基差绝对值超过 8bps。
- `盘口偏多` / `盘口偏空`：现货和永续近端 25bps order book imbalance 平均明显偏向一侧。
- `结构平稳`：没有触发上述结构异常。

这些标签会出现在 `status` 和 6 小时 digest 里。digest 默认只显示标签；只有异常标签出现时，才展开关键原因，避免手环/手机消息太长。

## 组合 alert

结构指标不会单独推送。alert 层只在价格和结构共振时产生 `structure_combo`：

- 价格急涨/急跌 + `流动性变薄`：标注为流动性真空下的价格动作。
- 有方向趋势 + `永续拥挤`：标注为杠杆仓位拥挤的趋势。
- 价格急涨/急跌 + `期现偏离`：标注为合约和现货拉扯。

这样设计是为了减少噪声：funding、OI、盘口偏斜本身都容易误报，和价格动作合并后再推送，信噪比会更高。

## 采样策略

默认：

```bash
STRUCTURE_MARKETS=BTCUSDT,ETHUSDT,SOLUSDT
STRUCTURE_INTERVAL_MS=300000
STRUCTURE_DEPTH_LIMIT=100
STRUCTURE_SLIPPAGE_NOTIONAL=10000
```

选择理由：

- BTC/ETH/SOL 是流动性足够好的核心资产，适合作为第一批市场结构样本。
- 5 分钟一次能看见状态变化，又不会接近 Binance public rate limit。
- depth limit 100 对个人观察足够轻；后续如果要更精细的冲击成本，再升到 500。
- REST snapshot 比 WebSocket order book 更简单，适合第一版长期稳定运行。

## 后续演进

优先级从高到低：

1. 观察一周 `structure_combo` 的实际触发频率，再调阈值。
2. 把 `structure/insights` 输出成 JSON 给后续 agent 使用。
3. 增加“异常持续时间”：不是只看最新窗口，而是看标签已经连续存在多久。
4. 如果 REST snapshot 不够，再引入 WebSocket order book，但需要先设计重连、校验和降级策略。
5. 引入新闻/agent 时，把市场结构作为事实层输入，而不是让 agent 直接从价格文本里猜流动性。
