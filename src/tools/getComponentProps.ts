import fs from "fs/promises";
import path from "path";
import type { PropParser } from "../parser/propParser.js";
import type { CacheManager } from "../cache/cacheManager.js";
import type { ComponentProps } from "../types.js";

export async function getComponentProps(
  componentPath: string,
  workspaceRoot: string,
  parser: PropParser,
  cache: CacheManager
): Promise<ComponentProps | null> {
  // Resolve full path
  const fullPath = path.isAbsolute(componentPath)
    ? componentPath
    : path.join(workspaceRoot, componentPath);

  try {
    // Read file content for cache key
    const content = await fs.readFile(fullPath, "utf-8");

    // Check cache
    const cached = await cache.getProps(fullPath, content);
    if (cached !== undefined) {
      return cached;
    }

    // Parse props
    const props = await parser.parseFile(fullPath);
    cache.setProps(fullPath, content, props);
    return props;
  } catch (error) {
    console.error(`Error getting props for ${componentPath}:`, error);
    return null;
  }
}