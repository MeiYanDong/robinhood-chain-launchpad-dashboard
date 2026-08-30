import { BotError } from "../errors.js";

export function buildDetailUrl(baseUrl: string | null, controlledPath: string): string | null {
  if (baseUrl === null) return null;
  if (!/^\/platforms\/[a-z0-9-]+$/.test(controlledPath)) throw new BotError("USER_INPUT_INVALID");
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new BotError("CONFIG_INVALID");
  }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new BotError("CONFIG_INVALID");
  return new URL(controlledPath, new URL("/", base)).toString();
}
