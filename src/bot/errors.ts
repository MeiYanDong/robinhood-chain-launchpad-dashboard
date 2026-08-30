export type BotErrorCode =
  | "CONFIG_INVALID"
  | "CONTRACT_INCOMPATIBLE"
  | "VERSION_NOT_AVAILABLE"
  | "LEDGER_TIMEOUT"
  | "LEDGER_UNAVAILABLE"
  | "LEDGER_HTTP_ERROR"
  | "DEBOX_AUTH_ERROR"
  | "DEBOX_RATE_LIMITED"
  | "DEBOX_NETWORK_ERROR"
  | "DEBOX_SEND_FAILED"
  | "QUERY_PLAN_INVALID"
  | "USER_INPUT_INVALID"
  | "OUT_OF_SCOPE"
  | "LLM_TIMEOUT"
  | "LLM_BUSY"
  | "LLM_BUDGET_EXHAUSTED"
  | "LLM_INVALID_OUTPUT"
  | "CHAT_RATE_LIMITED";

const USER_MESSAGES: Record<BotErrorCode, string> = {
  CONFIG_INVALID: "Bot 配置无效，服务尚未就绪。",
  CONTRACT_INCOMPATIBLE: "数据接口已变化，核心查询已安全暂停。",
  VERSION_NOT_AVAILABLE: "当前数据版本尚未提供这项能力。",
  LEDGER_TIMEOUT: "数据服务响应超时，请稍后再试。",
  LEDGER_UNAVAILABLE: "数据服务暂时不可用，请稍后用 /status 查看。",
  LEDGER_HTTP_ERROR: "数据服务暂时无法完成查询。",
  DEBOX_AUTH_ERROR: "Bot 身份验证失败，发送已暂停。",
  DEBOX_RATE_LIMITED: "消息平台繁忙，请稍后再试。",
  DEBOX_NETWORK_ERROR: "消息网络暂时不可用。",
  DEBOX_SEND_FAILED: "回复暂时没有发送成功。",
  QUERY_PLAN_INVALID: "我没能把问题安全转换成查询，请换成明确命令。",
  USER_INPUT_INVALID: "输入参数不符合支持范围，请查看 /help。",
  OUT_OF_SCOPE: "这个请求超出只读数据范围。",
  LLM_TIMEOUT: "自然语言解析超时，请改用明确命令。",
  LLM_BUSY: "自然语言解析正忙，请改用明确命令。",
  LLM_BUDGET_EXHAUSTED: "自然语言解析今日已暂停，请改用明确命令。",
  LLM_INVALID_OUTPUT: "自然语言解析结果不安全，请改用明确命令。",
  CHAT_RATE_LIMITED: "查询太频繁，请稍后再试。",
};

export class BotError extends Error {
  readonly userMessage: string;

  constructor(
    readonly code: BotErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "BotError";
    this.userMessage = USER_MESSAGES[code];
  }
}

export function toBotError(error: unknown, fallback: BotErrorCode): BotError {
  return error instanceof BotError ? error : new BotError(fallback);
}
