# Ledger ↔ Bot Contract v1

## 允许清单

| 方法 | 路径 | 受控参数 |
| --- | --- | --- |
| GET | /healthz | 无 |
| GET | /api/meta | 无 |
| GET | /api/overview | window 只能为 1、7、30 |
| GET | /api/platforms/:id | id 只能来自 meta 支持表，匹配小写 slug |
| GET | /api/coverage | 无 |
| GET | /api/sources | 无 |

## 硬拒绝

- 所有 POST/PUT/PATCH/DELETE，包括 `/api/refresh`；
- 用户、LLM 或事件传入的绝对 URL、host、scheme、query、路径；
- `..`、编码路径穿越、未知 endpoint；
- HTTP 3xx 自动跟随，尤其是跨源跳转；
- 直读 SQLite、导入 DashboardDatabase 或调用 collectors。

## 版本与运行规则

- `apiContractVersion` 是整数主版本；Bot v1 只接受 1。
- 数据 action 在首次/过期检查时必须读取 meta；版本不兼容仅保留 help 和受限 status。
- 默认单请求 timeout 3000ms；连接失败或 5xx 最多重试一次；4xx、3xx、合同/版本错误不重试。
- 同 endpoint+全部受控参数的并发请求共享 Promise。
- 成功响应最多缓存 15 秒；错误不长期缓存；缓存对象原样保留 targetDate、stale、warnings 和合同版本。
- JSON 在进入领域层前做严格运行时校验；缺关键字段或类型错误 fail closed。

## 错误映射

| 内部类别 | 用户态 |
| --- | --- |
| LEDGER_TIMEOUT / UNAVAILABLE | 数据服务暂时不可用；不输出数字 |
| CONTRACT_INCOMPATIBLE | 数据合同变化；核心查询暂停 |
| VERSION_NOT_AVAILABLE | 当前版本尚未提供该能力 |
| PLATFORM_NOT_SUPPORTED | 当前 Bot 尚未支持该平台 |
| INPUT_INVALID | 指出合法命令示例 |

任何映射都不得包含内部 host、端口、完整 URL、路径、堆栈或响应体。
