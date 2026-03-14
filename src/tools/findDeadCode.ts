import fs from "fs/promises";
import type { ComponentScanner } from "../scanner/componentScanner.js";
import type { CacheManager } from "../cache/cacheManager.js";
import type { DeadCodeEntry, Component } from "../types.js";
import { ensureCatalog, escapeRegex } from "./shared.js";

export interface DeadCodeReport {
  unusedExports: DeadCodeEntry[];
  totalScanned: number;
  totalUnused: number;
}

/**
 * Find dead code — exported symbols that are never imported/used anywhere else.
 * Uses the indexed cache for O(1) lookups per symbol.
 */
export async function findDeadCode(
  scanner: ComponentScanner,
  cache: CacheManager,
  workspaceRoot: string,
  options?: { layer?: string }
): Promise<DeadCodeReport> {
  const catalog = await ensureCatalog(scanner, cache);

  let candidates = catalog.components;
  if (options?.layer) {
    candidates = candidates.filter((c) => c.architectureLayer === options.layer);
  }

  const unusedExports: DeadCodeEntry[] = [];

  for (const component of candidates) {
    if (component.architectureLayer === "page" && component.routePath) continue;

    const nameLower = component.name.toLowerCase();
    const externalImporters = cache.getImportersOf(component.name).filter(
      (c) => c.name.toLowerCase() !== nameLower
    );
    const externalRenderers = cache.getRenderersOf(component.name).filter(
      (c) => c.name.toLowerCase() !== nameLower
    );

    const hookUsers =
      component.architectureLayer === "hook"
        ? catalog.components.filter(
            (c) =>
              c.name.toLowerCase() !== nameLower &&
              c.hooks?.some((h) => h.toLowerCase() === nameLower)
          )
        : [];

    const totalUsages =
      externalImporters.length + externalRenderers.length + hookUsers.length;

    if (totalUsages > 0) continue;

    const hasFileReference = await checkFileReferences(
      component,
      catalog.components,
      workspaceRoot
    );

    if (hasFileReference) continue;

    unusedExports.push({
      name: component.name,
      relativePath: component.relativePath,
      architectureLayer: component.architectureLayer,
      exportType: component.exportType || "none",
      reason: buildReason(component),
    });
  }

  return {
    unusedExports: unusedExports.sort((a, b) => a.name.localeCompare(b.name)),
    totalScanned: candidates.length,
    totalUnused: unusedExports.length,
  };
}

async function checkFileReferences(
  target: Component,
  allComponents: Component[],
  _workspaceRoot: string
): Promise<boolean> {
  const refRegex = new RegExp(`\\b${escapeRegex(target.name)}\\b`);

  for (const component of allComponents) {
    if (component.name === target.name) continue;

    try {
      const content = await fs.readFile(component.path, "utf-8");
      if (refRegex.test(content)) return true;
    } catch {
      // Skip files that can't be read
    }
  }

  return false;
}

function buildReason(component: Component): string {
  const layer = component.architectureLayer;

  switch (layer) {
    case "component":
      return `Component "${component.name}" is exported but never imported or rendered by any other file`;
    case "hook":
      return `Hook "${component.name}" is exported but never called by any component, page, or other hook`;
    case "service":
      return `Service "${component.name}" is exported but never imported by any hook or other service`;
    case "adapter":
      return `Adapter "${component.name}" is exported but never imported by any service or hook`;
    case "context":
      return `Context "${component.name}" is exported but never used as a provider in any component`;
    case "page":
      return `Page "${component.name}" is exported but has no route and is not imported anywhere`;
    default:
      return `"${component.name}" is exported but never used anywhere in the codebase`;
  }
}
