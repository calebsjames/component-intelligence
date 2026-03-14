import type { ComponentScanner } from "../scanner/componentScanner.js";
import type { CacheManager } from "../cache/cacheManager.js";
import type { ArchitectureLayer } from "../types.js";
import { ensureCatalog, collectUnique } from "./shared.js";

export interface DependencyNode {
  name: string;
  relativePath: string;
  architectureLayer: ArchitectureLayer;
}

export interface DependencyChain {
  target: DependencyNode;
  dependsOn: DependencyNode[];
  usedBy: DependencyNode[];
}

/**
 * Get the full dependency chain for a component/hook/service.
 * Uses indexed cache for O(1) lookups instead of O(n) scans.
 */
export async function getDependencyChain(
  args: { name: string },
  scanner: ComponentScanner,
  cache: CacheManager
): Promise<DependencyChain | null> {
  await ensureCatalog(scanner, cache);

  const matches = cache.getByName(args.name);
  const target = matches[0];
  if (!target) return null;

  const targetNode: DependencyNode = {
    name: target.name,
    relativePath: target.relativePath,
    architectureLayer: target.architectureLayer,
  };

  const dependsOn = collectDownstream(target, cache);

  const importers = cache.getImportersOf(target.name);
  const renderers = cache.getRenderersOf(target.name);
  const usedBy = collectUnique(
    [...importers, ...renderers],
    target.name
  ) as DependencyNode[];

  return { target: targetNode, dependsOn, usedBy };
}

function collectDownstream(
  target: { imports?: { names: string[] }[]; childComponents?: string[] },
  cache: CacheManager
): DependencyNode[] {
  const result: DependencyNode[] = [];
  const seen = new Set<string>();

  const addDeps = (names: string[]) => {
    for (const name of names) {
      if (seen.has(name.toLowerCase())) continue;
      const deps = cache.getByName(name);
      for (const dep of deps) {
        seen.add(dep.name.toLowerCase());
        result.push({
          name: dep.name,
          relativePath: dep.relativePath,
          architectureLayer: dep.architectureLayer,
        });
      }
    }
  };

  if (target.imports) {
    for (const imp of target.imports) {
      addDeps(imp.names);
    }
  }

  if (target.childComponents) {
    addDeps(target.childComponents);
  }

  return result;
}
