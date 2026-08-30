# DeBox 官方信息复核｜2026-08-31

- 证据等级：`official_current`
- 核对日期：2026-08-31（Asia/Shanghai）
- 范围：真实 DeBox 封闭试用开始前的账号、Bot、收消息、SDK、权限与 Grant 规则
- 边界：这是公开官方页面复核，不是登录后 BotMother 页面、真实 Bot、凭证或消息回执

## 官方来源

- Bot 总览：https://docs.debox.pro/APIs/BotGuide/
- OpenAPI：https://docs.debox.pro/ApiOnePage/
- Node.js SDK：https://docs.debox.pro/NODE-SDK/
- 官方 Node.js SDK 仓库：https://github.com/debox-pro/debox-chat-nodejs-sdk
- Grant：https://docs.debox.pro/OpenPlatformGrant/
- 账号注册教程：https://support.debox.pro/en/guides/account-security/register-debox-account/
- Web App：https://app.debox.pro/

## 与 plan.md 一致的当前规则

- Bot 仍通过 BotMother 创建；每个账号最多 5 个，已创建 Bot 当前不能删除。
- Bot 创建后取得 App Key 与 App Secret；两者只能存放在可信后端，不能进入 H5、公开仓库、日志或截图。
- Long Polling 与 Webhook 严格互斥；使用 `getUpdates` 前必须清空 Webhook。
- 封闭试用可以继续采用 Long Polling，不需要公网入站、域名、TLS、Nginx location 或新防火墙端口。
- “监听群消息”“订阅号”“发布机器人”仍需平台审核；公开发布前要准备使用说明并发送到审核群。
- 图片能力仍可能涉及 Bot Lv.2；价格与支付方式以 DeBox App 当时页面为准。
- Grant 仍要求至少一项真实 DeBox 能力接入以及 Demo、路线图、里程碑、运营和使用证明；没有固定获批或固定金额承诺。

## 账号入口结论

- DeBox 账号不是传统用户名密码注册。官方当前流程是在手机 DeBox App 中创建或导入钱包并完成账户资料；Web App 使用钱包连接登录。
- 官方注册教程要求恢复词只由用户离线保存，不能截图或发送给任何人。
- 本项目应使用新的零资产专用项目账号，不导入个人主钱包，也不向 Codex 提供恢复词、私钥、PIN、Cookie 或登录验证码。
- 账号创建完成后，先在 BotMother 执行 `/mybots` 核对配额；在头像、简介、支持入口和不可逆检查完成前，不执行 `/newbot`。

## 当前未知

- 公开文档没有给出 Bot 创建页的固定价格或 OpenAPI 调用价格表；真正创建前必须以登录后的 BotMother 页面为准，出现任何支付步骤即停止并请用户确认。
- 官方 Node.js SDK 仓库当前 package metadata 为 `0.1.0`、MIT，但没有稳定 Release；仍需完成源码、许可证文件、依赖、漏洞、日志和 offset/ack 行为审查后才能锁定 commit。

## 结论

P2-001、P2-002 与 P2-003 的公开官方复核完成。Long Polling 文本封测方向没有发现必须改成 Webhook 的新规则；真实事件结构、BotMother 登录后页面、配额、价格和消息投递仍只能在账号与 Bot 存在后验证。
