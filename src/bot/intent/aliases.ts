import { PLATFORM_REGISTRY } from "../../config/platforms.js";
import type { PlatformConfig } from "../../domain/types.js";

export interface PlatformAliasEntry {
  id: string;
  name: string;
  aliases: string[];
}

export type AliasResolution =
  | { kind: "found"; platformId: string }
  | { kind: "ambiguous"; platformIds: string[] }
  | { kind: "missing" };

export function normalizeAlias(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function platformCatalog(
  platforms: PlatformConfig[] = PLATFORM_REGISTRY,
): PlatformAliasEntry[] {
  return platforms.map((platform) => ({
    id: platform.id,
    name: platform.name,
    aliases: [...new Set([platform.id, platform.name, ...platform.aliases])],
  }));
}

export function resolvePlatformAlias(
  value: string,
  catalog: PlatformAliasEntry[] = platformCatalog(),
): AliasResolution {
  const normalized = normalizeAlias(value);
  const matches = catalog
    .filter((entry) => entry.aliases.some((alias) => normalizeAlias(alias) === normalized))
    .map((entry) => entry.id)
    .sort();
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous", platformIds: matches };
  return { kind: "found", platformId: matches[0] as string };
}
