# 查询与采集隔离（0.15.0）

## 运行结构

Nginx → 127.0.0.1:4175 独立 query 服务 → 127.0.0.1:4176 collector。
query 不读取数据库或来源凭证；静态文件独立提供。常用 GET 每 5 秒后台刷新，缓存有效期
60 秒。未缓存 GET 最多等待 15 秒；过期缓存无法更新时返回明确 503。查询并发上限 6，单响应
上限 8 MiB，超限明确失败。POST 保留既有刷新能力与 Nginx 权限，不产生新的交易能力。

预热清单覆盖发射台经营、龙头、PAIR Alpha、PAIR V2、项目方发行与资金闭环的默认首屏请求。
60 秒只是 collector 忙碌时的只读容错上限；响应仍保留自身的 `observedAt`、`stale` 和来源状态，
不会把缺失值补成零，也不会把 POST 刷新结果缓存为成功。

服务器内部的 economics 定时重建不经过有并发上限的 query 网关，而是直连只监听本机
`127.0.0.1:4176` 的 collector；遇到临时网络错误或 HTTP 5xx 时，每 30 秒有界重试，最多
重试 5 次。成功响应正文不写入 journal，只保留任务结果与错误。公网刷新仍经 Nginx 与 query
网关执行原有限流和权限规则。

监控和经济采集仍在同一 collector 进程，隔离的是公开查询事件循环；本版不承诺多个采集模块
之间具备进程级隔离。query 和 collector 同机，主机故障仍是共同故障点。

## 数据质量

- 同一平台、来源的成交量在前一天至少 100 万美元后突然为 0，标记待核验；此规则是质量哨兵，
  不是判定零值必然错误。原值保留，不进入汇总、三强份额或估值；普通明确零值保留。
- `dataQuality` 分别表示快照是否新、三家同日数据是否完整、估值是否可用，不能只看 HTTP 200。
- 市场及链上供应量观测超过 30 分钟、持有人超过 150 分钟时，当前值置未知并保留历史原值。
- Long 平台总量缺失时不以活跃代币样本填充；迟到日不能以滚动 24H 替代。

## 存储

`MONITOR_DATABASE_PATH` 将 PAIR V2/Alpha/DEV 表移入 monitor.sqlite，其余模块沿用原数据库。
用 scripts/split-monitor-database.py 在 sole writer 停止时复制并验证外键、完整性和逐表行数。
旧的大型看板缓存留在原库；活动历史市场点只保存回放字段，完整当前状态保留在 pair_v2_tokens，
事件和信号证据保持完整。旧的逐币完整历史 JSON 留在原库，迁移不会删除原库。
不得在双库启用后简单切回旧数据库游标，否则可能漏事件或重复投递。

## 发布和恢复

发布前完整 verify；保存源文件清单和 SHA-256，以明确脏工作树来源。新 release 复用已有依赖
前必须核对 lockfile dependencies；不能把 macOS node_modules 上传至 Linux。

停止相关 timers 与 collector 后执行迁移。先完成副本校验，再原子切换 current，启动 collector
和 query。验证版本、GET 合同、通知队列和游标继续前进，最后恢复先前 active timers。

如果新 collector 尚未运行，恢复原 unit/current 即可。如果已经写入 monitor.sqlite，必须先
停止 writer，再用 scripts/restore-monitor-database.py 合并新增运行、游标、状态和 outbox 到旧库，
保留旧的大型缓存与原有历史 JSON，验证后才启动旧 release。不要删除新 monitor.sqlite。
物理回收旧数据和新增付费资源不包含在本版操作中。
