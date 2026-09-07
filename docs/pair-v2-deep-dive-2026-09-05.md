# PAIR V2 深度调研

> 快照时间：2026-09-05 15:46:14（Asia/Shanghai）
> Robinhood Chain：区块 `54,953,008`，Chain ID `4663`
> 范围：官方公告、PAIR 官网与接口、RH-scan 已验证源码、Robinhood Chain RPC 事件与存储槽。动态数字只代表本次快照。

## 一句话结论

PAIR V2 确实已经上线，回购销毁、持有者分红、多钱包分账、CTO、WETH/USDG 配对都不是纯 PPT；但它目前更准确的定位是：**功能真实、上线极早、生产代码透明度不足、升级权高度集中、尚无公开独立审计证据的 beta 版本。**

尤其要纠正一个最容易影响估值的误解：

> V2 的“回购与销毁”是新发行项目币可选的费用模式，回购的是该项目币；它不是把 PAIR 全平台手续费全部拿去回购平台币 `$PAIR`。

当前正式 V2 配置为 1% 池费，其中 70%进入所选项目费用模式，30%归协议。因而某个项目选择回购模式时，理论最高新增回购资金约为该项目合资格成交额的 `1% × 70% = 0.7%`，不是 1%，更不是全平台成交额的 0.7%。实际回购还取决于费用是否被收集、keeper 是否执行、路由、滑点和链上成功回执。

## 证据等级

- **已确认**：链上存储、事件、余额/供应量或已验证源码可以交叉核验。
- **部分确认**：功能或早期版本已证明，但当前生产版本源码、完整拓扑或外部依赖尚未闭环。
- **未确认**：只有公告/前端文字，尚无独立链上或第三方证据。
- **与宣传有差异**：功能存在，但宣传语省略了关键比例、执行条件或权限边界。

## 公告逐条核验

| 官方说法 | 结论 | 核验结果 |
|---|---|---|
| PAIR V2 已发布 | **已确认** | 官方账号于 2026-09-05 发布 [V2 公告](https://x.com/pairdotfund/status/2096121934274777580)；正式 release 的链上部署早于公告，当前已有真实发行事件。 |
| 回购与销毁 | **部分确认** | 早期 proof release 已成功把报价资产换成项目币并调用真实 `_burn`；正式 release 已产生回购桶余额，但截至快照其执行器尚无 `BuybackExecuted` 事件。 |
| “所有费用自动回购并销毁” | **与宣传有差异** | 这是项目可选模式，不覆盖所有 V2 项目；1%池费按 70%模式 / 30%协议分配；收集和回购分两步，依赖额外交易/keeper，不是每笔 swap 同步回购。 |
| 持有者奖励/分红 | **已确认但规则不透明** | 正式 release 已出现 4 笔 `HolderDistributionClaimed`；但当前 holder handler/vault 源码未验证，资格、排除地址、权重和时间规则尚不能独立审计。 |
| 最多 5 个费用接收钱包 | **已确认** | 发射页允许 1–5 个唯一地址，比例必须合计 10,000 bps；早期已验证 vault factory 源码也执行这一约束。当前 UI 将 Creator Fees 与 Fee Sharing 作为同一链上模式的两个预设。 |
| 地址以 5555 结尾 | **已确认** | V2 token factory 使用 CREATE2 搜索末 16 bit 为 `0x5555` 的地址；当前 V2 代币确实如此。它只是品牌后缀，平均约尝试 65,536 个 salt，不是防伪或安全证明。 |
| CTO / 社区接管 | **部分确认、管理员门控** | 官方提供 [CTO 申请表](https://x.com/pairdotfund/status/2096121936678195243)。链上操作本质是给符合条件的 Fee Sharing 项目追加新的未来费用 epoch；普通用户不能自行接管，当前必须由 fee-policy registry owner 执行。它不等于拿到代币合约所有权，也不追溯改变旧 epoch。 |
| ETH 与 USDG 已可配对 | **已确认** | [可用报价资产接口](https://pair.fund/api/stock-tokens) 已返回 WETH/USDG；链上和公开索引里都已有使用两者的 V2 测试/proof 发行。技术可用已确认，真实采用仍很早。 |
| Basedbot、GMGN 等终端已上线/即将同步 | **未完成** | 最新 V2 token 的官方诊断仍包含 `external_terminal_support_unverified` 与 `awaiting_external_route_activation`。应按“正在对接”理解，不能按“全部终端已完成索引”理解。 |
| V2 合约已验证并开源 | **只对公告中的早期地址成立** | 公告列出的 3 个地址在 RH-scan 为 exact-match verified；但当前正式 release 的核心组件与 launchpad 当前实现仍未验证，官方 GitHub 账户当前也没有公开仓库。 |
| 已审计 | **没有找到公开证据** | 截至快照，在官方文档、官方 X、公告链接和官方 GitHub 中均未找到审计机构、报告、审计范围、commit/hash 或修复说明。源码验证不等于安全审计。 |

## V2 到底改变了什么

V2 不是重新做了一条链，也不是 PAIR 平台币的“V2 代币”。它是在现有 V5 launchpad 上增加一层 **Launch V2 发行与费用策略系统**。

每个新项目在发行时选择一种费用去向：

1. **Buyback & Burn**：把该项目的 quote-asset 模式份额积累到 vault，之后换成该项目币并销毁。
2. **Holder Rewards**：把 quote-asset 模式份额计入 holder vault，由符合条件的持有人领取。
3. **Creator Fees**：把模式份额给创建者钱包。
4. **Fee Sharing**：把模式份额永久按比例分给最多 5 个钱包；创建者钱包固定为第一个接收人。

链上 `modeId` 实际只有三类：Fee Sharing=`1`、Buyback & Burn=`2`、Holder Distribution=`3`。Creator Fees 是 Fee Sharing 的单钱包 100% 预设，不是第四套独立合约模式。

### 费用闭环

```text
项目币交易
  └─ 1% Uniswap 池费
       ├─ 70%：项目选择的 mode share
       │    ├─ 回购桶 → keeper/executor → 买入该项目币 → _burn
       │    ├─ holder vault → 符合条件者 claim
       │    └─ creator / 最多 5 钱包按 epoch 领取
       └─ 30%：protocol share（最终经济去向仍需继续追踪）
```

这里有三个重要边界：

- **回购对象是新发项目币，不是 `$PAIR`。** PAIR 平台币只可能从平台采用、叙事和协议收入中间接受益；当前没有证据表明 V2 的 70% mode share 会回购 `$PAIR`。
- **“自动”不等于同一笔交易内自动完成。** swap 先让费用在锁仓头寸中累积，随后由 collection/sweep 记入 vault，再由外部 keeper 或任何满足约束的调用者执行回购。早期已验证 executor 源码甚至明确写着“never invoked by a hook”。
- **成交额乘费率只等于理论新增，不等于待回购余额。** 必须分别看已产生、已收集、当前 bucket、已执行、实际买入和实际 burn。

## 当前真实执行数据

### 1. 正式 release 的发行数量与模式

当前官网认证的 standard-route release 为：

- `releaseId`: `0x85ec0ee2...e9cebd`
- 部署区块：`54,695,970`（2026-09-05 08:34:22，Asia/Shanghai）
- 官方 live attestation：[consumer-live](https://pair.fund/api/v5-v2/standard-route/consumer-live?releaseId=0x85ec0ee2de653cc6695b022063c2dec735634e629961db989275797609e9cebd&manifestSha256=df121499c083fc848a915101abf6dc121c0c83ca75ea1c28b0f81010ac10a83b&fresh=1)

从该 coordinator 的 `CanonicalProjectLaunched` 事件重放，快照时共有 **14 个正式 release 发行**：

| 模式 | 数量 |
|---|---:|
| Holder Distribution | 6 |
| Buyback & Burn | 5 |
| Fee Sharing / Creator | 3 |

这说明三类模式都已经产生真实发行，但数量仍太少，不足以判断长期留存和商业质量。

### 2. 公开 V2 市场采用

完整翻页读取 [官方 token API](https://pair.fund/api/tokens?page=1&limit=50&sort=newest) 后：

- 全站公开 token：1,915 个；
- 被标记为 V2：17 个，其中相当一部分名称明显为 test/proof；
- 有可用市场数据：8 个；
- 这 8 个的 24H 成交额合计约 **$21,433.09**；
- 市值简单求和约 **$36,428**；
- [官方平台统计](https://pair.fund/api/stats/protocol) 的滚动 24H 总成交额为 **$34,271,566.45**。

公开 V2 成交额约占平台滚动 24H 的 **0.0625%**。这是公开索引下限，不是完整链上市场份额：隐藏、测试、未索引代币以及两个接口的刷新时点都会造成误差。但即使考虑误差，当前 V2 仍属于刚发布阶段，尚未形成可观的真实份额。

### 3. 回购模式：能工作，但正式 release 尚未实际回购

早期 proof token [`0x6787...5555`](https://rh-scan.com/address/0x6787c7b5612c90256f775efc48d0e93910555555) 已有一笔回购交易 [`0xb818...c4ed`](https://rh-scan.com/tx/0xb818c1fbad0ba10ebb314058c86a9acf1ffa1ce0ffb288b3a7a6de1ab7f3c4ed)，产生两条 `BuybackExecuted`：

- 使用 WETH 回购并 burn `61,135.550821832041706661` 个项目币；
- 使用 USDG 回购并 burn `63,682.963084592226902383` 个项目币；
- 合计 burn `124,818.513906424268609044`；
- `totalSupply` 从 10 亿下降到 `999,875,181.486093575731390956`。

这证明旧 proof graph 的“买入后真实减供应量”可以执行，销毁不是简单把币转进普通钱包。

但在当前正式 release 中：

- buyback executor [`0x8fea...1a0c`](https://rh-scan.com/address/0x8fea00440300bb2d3e9377b995e6f62fe99c1a0c) 截至区块 `54,953,008` 的 `BuybackExecuted` 数量为 **0**；
- 某个当前回购模式项目 [`0x88ef...5555`](https://rh-scan.com/address/0x88ef466ab707ca7d259c579377b1fbfafaab5555) 已收集 `0.003788940789071747 AAPL` quote fee；
- 其中 `0.002652258552350222 AAPL`，即精确 70%，仍在 epoch 1 buyback bucket；30%协议份额为 `0.001136682236721524 AAPL`；
- 该项目 `totalSupply` 仍是完整 10 亿。

所以当前最准确的表述是：**正式 V2 已开始积累待回购资金，但尚未观察到正式 release 的第一次回购销毁。**

### 4. Holder Rewards：已有真实领取

当前正式 release 已观察到 4 笔 `HolderDistributionClaimed`：

- `0.002640696191874062 AAPL`；
- 合计 `0.001219107757900582 SPY`，分三笔领取。

对应交易：[AAPL claim](https://rh-scan.com/tx/0xb5cb5d6cc62e3912e652e4cab8d660ff85bf0fbf33c9af64e266dcea37cb4ff8)、[SPY claim 1](https://rh-scan.com/tx/0xec6490c68ac1fe219d9386a9f6862d5b994f872eaef47eb1f5eb33e471deac4f)、[SPY claim 2](https://rh-scan.com/tx/0x093d8719cf41be6a7c4f0cac9c1eb885e8736d930566582d4f614d6289a3be3f)、[SPY claim 3](https://rh-scan.com/tx/0x26b6a51a2056743a4c4b26d978d1b04b5798de1772cf81444b94f8b9cd1ddba4)。

这证明分红不是单纯前端展示。不过，“支持持有时长”的公告措辞不能被解释成“持有越久权重越高”；当前 active holder 合约源码未公开，确切资格算法仍为未知。

## “开源”为什么只算部分成立

官方 [合约地址公告](https://x.com/pairdotfund/status/2096121938762699239) 给出：

1. [`0xEFb9...c47C`](https://rh-scan.com/address/0xEFb9c88343BeD4e96910B71964709ed5c12dc47C#code)：`PairTokenV5LaunchV2`；
2. [`0xC23a...B131`](https://rh-scan.com/address/0xC23a3838aE07D86c62e632F82DBFFb40B231B131#code)：`PairTokenV5LaunchV2Factory`；
3. [`0x026d...147E`](https://rh-scan.com/address/0x026dDF581c09703095e905681aE060c543e8147E#code)：`PairV5LaunchV2FeeSharingVaultFactory`。

三者都在 RH-scan 获得 exact-match source verification，创建于 2026-09-03 13:35 左右，源码本身可以审阅。但它们并不是一套完整、当前正在使用的生产拓扑：

- `0xEFb9` 的 `factory()` 指向 `0x3695...5236`，不是公告中的 `0xC23a`；
- `0xC23a` 的 `implementation()` 指向另一个 token implementation `0x341e...983e`；
- `0xC23a` 与 `0x026d` 同属 coordinator `0x0d2d...878b`；
- 当前正式 release 使用的则是 `0xf98b...25d` coordinator、`0xece4...e3a` factory、`0xd2f7...00c0` hook 和 `0x8fea...1a0c` executor。

也就是说，公告把两个早期开发分支中的三个合约列在了一起，却没有给出当前 production release 的完整 manifest。它未必代表恶意，但不足以支持“当前 V2 全栈已经开源”的结论。

截至快照，[官方 GitHub 账号](https://github.com/pairdotfund) 显示 **0 个公开仓库**。因此外部研究者还无法从一个带 commit、测试、部署脚本和 release tag 的仓库复现当前版本。

## 当前生产拓扑与权限风险

```text
用户 / 前端
  └─ PairLaunchpadV5 UUPS Proxy 0x8660...
       ├─ 当前 implementation 0xe8c5...（未验证源码）
       └─ Launch V2 current release
            ├─ Mode Registry 0xda5c...（未验证）
            ├─ Coordinator 0xf98b...（未验证）
            ├─ Token Factory 0xece4...（未验证）
            ├─ Hook 0xd2f7...（未验证）
            ├─ Buyback Executor 0x8fea...（未验证）
            └─ Aggregator 0xe6c5...（未验证）
```

### 1. 官方文档已经落后于链上

[PAIR Docs](https://pair.fund/docs) 仍把 `0x1559...b12c` 列为 launchpad implementation；但代理 [`0x8660...Ae62`](https://rh-scan.com/address/0x8660A7F019C7943b0b0A91B8E39AFf3b6DB6Ae62) 的 EIP-1967 implementation slot 当前实际为 [`0xe8c5...59f7`](https://rh-scan.com/address/0xe8c58470be6e09b3b9cca518f6d264e14f4359f7)，且后者未验证源码。

### 2. 升级权最终落在单一 EOA

实时读取显示：

- launchpad proxy 的 `owner()`：`0x3Da4...5656`（未验证的 upgrade-controller 合约）；
- 该 controller 的 `owner()`：EOA `0x18fe...00ea`；
- 尚未发现 multisig 或 timelock 证据。

从 2026-09-02 08:26 到 2026-09-04 20:20，该代理发生 **13 次 `Upgraded` 事件**，包括数次快速回滚。高频升级在发布期可以是快速修 bug，但也意味着行为仍高度可变，不能把昨天审过的实现自动当成今天的生产代码。

这不是 RUG 的直接证据；它代表的是**可升级面大、单点权限强、公开验证跟不上发布速度**。在 active 源码未验证前，也不能安全断言 controller 对既有 vault 和项目币的所有能力边界。

### 3. 5555 不能当官方身份认证

任何开发者都可以暴力搜索 CREATE2 salt，使地址后四位为 `5555`。识别官方 V2 代币必须同时核验：

- 是否由当前 canonical coordinator/factory 的发行事件产生；
- 对应 releaseId、modeId、vault 和 handler 是否匹配 live registry；
- 发行交易与官网索引是否一致。

只看地址后缀会被仿冒。

## 对 `$PAIR` 价值的真实影响

### 正面

- 项目方不再只有单一费用模型，可以选择通缩、持有人现金流或团队/社区分账，产品差异明显增强。
- Holder Rewards 和 CTO 给社区提供了更强运营叙事，可能提高发行量、留存和交易活跃度。
- 协议拿走 1%池费中的 30%，相当于合资格 V2 成交额约 0.3%的协议毛收入潜力。

### 不能直接成立的推论

- **V2 成交额 × 0.7% 不是 `$PAIR` 回购额。** 它是各项目自身选择回购模式时的项目币潜在回购额。
- **协议 0.3%收入不等于 `$PAIR` 持有人收入。** 30%协议份额最终进入哪个地址、是否回购 PAIR、是否覆盖 keeper/运营成本，目前没有形成完整、公开、可审计的资金闭环。
- **功能上线不等于已经获得市场份额。** 当前公开 V2 量只占平台 24H 约 0.06%，且大批名称仍像内部测试。

因此，V2 对 `$PAIR` 目前是“产品与叙事利好”，尚不是“可量化的 PAIR 代币现金流利好”。只有当 V2 成交占比上升、协议份额去向明确、生产回购持续执行时，才适合上调基本面估值。

## 当前风险评级

| 维度 | 评级 | 原因 |
|---|---|---|
| 功能真实性 | 中高 | 三类模式已有真实发行；回购旧 proof 与 holder claim 均有链上回执。 |
| 当前回购成熟度 | 低 | 正式 release 已有 bucket，但 executor 仍为 0 次执行。 |
| 生产源码透明度 | 低 | 公告地址是早期分支；当前 active graph 核心组件未验证。 |
| 独立安全审计 | 未知/低 | 未发现可核验审计报告、范围与 commit。 |
| 权限去中心化 | 低 | UUPS 升级链最终由单一 EOA 控制，未发现 timelock/multisig。 |
| 市场采用 | 很早 | 公开 V2 量约占平台 24H 0.06%，样本中测试/proof 比例高。 |
| 综合判断 | **中高风险 beta** | 不是“已证明 RUG”，也还远不到“成熟、完全开源、已审计”。 |

## 接下来最值得监控的 8 个指标

1. **当前 release 身份**：releaseId、manifest hash、active registry 与所有组件地址。
2. **源码状态**：代理当前 implementation、registry、coordinator、hook、executor 是否 exact-match verified。
3. **升级风险**：`Upgraded` 事件、implementation 变化、owner/controller 变化、是否加入 multisig/timelock。
4. **每个项目的 mode**：modeId、version、vault、policy epoch，避免把 Creator/Holder/Fee Sharing 算成回购。
5. **回购漏斗**：理论 fee → 已 collect → mode share → buyback bucket → executed input → bought → burned。
6. **执行延迟与积压**：bucket 年龄、最后执行时间、失败交易、keeper 在线率；这比“理论 0.7%”更能判断短期买压。
7. **协议 30%去向**：协议地址余额、转出、运营成本、是否进入 `$PAIR` 回购/金库；没有回执就保持 UNKNOWN。
8. **采用质量**：V2 非测试项目数、独立创建者、成交额、流动性、持有人、7/30日留存，以及 V2 占 PAIR 平台份额。

## 对当前 Radar 页的建议

现有“资金闭环”页不能把 V1 的 PAIR 平台回购与 V2 项目币回购混在一起。建议新增独立的 **PAIR V2** 页面或明确分区：

- 顶部显示 active release、源码覆盖率、audit 状态、upgrade authority 和最近升级；
- 发行列表显示 token、mode、quote、volume、1% fee、70% mode share、30% protocol share；
- Buyback 页面逐笔列出 `FeesCollected`、bucket、`BuybackExecuted`、burn 与待执行时长；
- Holder 页面逐笔列出 accrued、claimed、claimant 和规则可验证性；
- CTO 页面显示旧/新 epoch、执行者、未来接收人变化，不把它标成“项目所有权转移”；
- 所有数字标注 `observed / calculated / pending / unknown`，并与 releaseId 和 blockNumber 绑定。

在 active graph 开源、首次正式回购发生、协议 30%去向被追清之前，不应在页面上使用“全部自动回购”“已审计”或“PAIR 获得 0.7%买压”这类确定性表述。

## 主要来源

- [PAIR V2 官方公告](https://x.com/pairdotfund/status/2096121934274777580)
- [CTO 官方公告](https://x.com/pairdotfund/status/2096121936678195243)
- [V2 合约地址官方公告](https://x.com/pairdotfund/status/2096121938762699239)
- [PAIR 官方文档](https://pair.fund/docs)
- [正式 standard-route live attestation](https://pair.fund/api/v5-v2/standard-route/consumer-live?releaseId=0x85ec0ee2de653cc6695b022063c2dec735634e629961db989275797609e9cebd&manifestSha256=df121499c083fc848a915101abf6dc121c0c83ca75ea1c28b0f81010ac10a83b&fresh=1)
- [Native-fee / holder graph attestation](https://pair.fund/api/v5-v2/native-fee/consumer-live)
- [PAIR protocol stats](https://pair.fund/api/stats/protocol)
- [PAIR token API](https://pair.fund/api/tokens?page=1&limit=50&sort=newest)
- [官方 GitHub 账号](https://github.com/pairdotfund)
- [Launchpad proxy on RH-scan](https://rh-scan.com/address/0x8660A7F019C7943b0b0A91B8E39AFf3b6DB6Ae62)
