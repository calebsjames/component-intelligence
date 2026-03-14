import type { ComponentScanner } from "../scanner/componentScanner.js";
import type { CacheManager } from "../cache/cacheManager.js";
import type { ComponentCatalog } from "../types.js";
import { ensureCatalog } from "./shared.js";

export async function listAllComponents(
  scanner: ComponentScanner,
  cache: CacheManager
): Promise<ComponentCatalog> {
  return ensureCatalog(scanner, cache);
}