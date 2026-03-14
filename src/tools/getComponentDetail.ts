import type { ComponentScanner } from "../scanner/componentScanner.js";
import type { PropParser } from "../parser/propParser.js";
import type { CacheManager } from "../cache/cacheManager.js";
import type { Component, ComponentProps } from "../types.js";
import { ensureCatalog } from "./shared.js";

export interface ComponentDetail extends Component {
  props?: ComponentProps;
}

/**
 * Get detailed information about a specific component.
 * Uses indexed cache for O(1) lookup.
 */
export async function getComponentDetail(
  args: { name: string; file?: string },
  scanner: ComponentScanner,
  parser: PropParser,
  cache: CacheManager
): Promise<ComponentDetail | null> {
  const { name, file } = args;
  await ensureCatalog(scanner, cache);

  let matches = cache.getByName(name);

  if (file && matches.length > 1) {
    matches = matches.filter(
      (c) => c.relativePath.includes(file) || c.path.includes(file)
    );
  }

  if (matches.length === 0) return null;

  const component = matches[0];

  try {
    const props = await parser.parseFile(component.path);
    return {
      ...component,
      props: props || undefined,
    };
  } catch {
    return component;
  }
}
