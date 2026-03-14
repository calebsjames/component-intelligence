import type { ComponentScanner } from "../scanner/componentScanner.js";
import type { CacheManager } from "../cache/cacheManager.js";
import type { ComponentCatalog, Component } from "../types.js";

export async function ensureCatalog(
  scanner: ComponentScanner,
  cache: CacheManager
): Promise<ComponentCatalog> {
  const cached = cache.getCatalog();
  if (cached) return cached;

  const catalog = await scanner.scan();
  cache.setCatalog(catalog);
  return catalog;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function collectUnique(
  items: Component[],
  excludeName: string
): { name: string; relativePath: string; architectureLayer: string }[] {
  const excludeLower = excludeName.toLowerCase();
  const seen = new Set<string>();
  const result: { name: string; relativePath: string; architectureLayer: string }[] = [];

  for (const item of items) {
    const lower = item.name.toLowerCase();
    if (lower === excludeLower) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push({
      name: item.name,
      relativePath: item.relativePath,
      architectureLayer: item.architectureLayer,
    });
  }

  return result;
}
