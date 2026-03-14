import fs from "fs/promises";
import type { ComponentScanner } from "../scanner/componentScanner.js";
import type { CacheManager } from "../cache/cacheManager.js";
import { ensureCatalog, escapeRegex } from "./shared.js";

export interface ComponentUsage {
  file: string;
  component: string;
  line: number;
  usageType: "jsx" | "import";
}

/**
 * Find all components that use (import and render) a specific component.
 * Uses indexed cache for fast initial lookup, then scans files for line numbers.
 */
export async function findComponentUsages(
  args: { name: string },
  scanner: ComponentScanner,
  cache: CacheManager,
  workspaceRoot: string
): Promise<ComponentUsage[]> {
  const { name } = args;
  const catalog = await ensureCatalog(scanner, cache);

  const usages: ComponentUsage[] = [];
  const escapedName = escapeRegex(name);
  const jsxRegex = new RegExp(`<${escapedName}[\\s/>]`, "g");
  const importRegex = new RegExp(
    `import\\s+(?:.*\\{[^}]*\\b${escapedName}\\b[^}]*\\}|${escapedName})\\s+from`,
    "g"
  );

  const importers = cache.getImportersOf(name);
  const renderers = cache.getRenderersOf(name);

  const candidateSet = new Map<string, { path: string; relativePath: string; name: string }>();
  for (const comp of [...importers, ...renderers]) {
    if (comp.name.toLowerCase() === name.toLowerCase()) continue;
    candidateSet.set(comp.path, {
      path: comp.path,
      relativePath: comp.relativePath,
      name: comp.name,
    });
  }

  for (const candidate of candidateSet.values()) {
    scanFileForUsages(
      await readFileSafe(candidate.path),
      candidate.relativePath,
      candidate.name,
      jsxRegex,
      importRegex,
      usages
    );
  }

  if (name.startsWith("use")) {
    const hookCallRegex = new RegExp(`\\b${escapedName}\\s*\\(`, "g");

    for (const comp of catalog.components) {
      if (comp.name.toLowerCase() === name.toLowerCase()) continue;
      if (candidateSet.has(comp.path)) continue;
      if (!comp.hooks?.some((h) => h.toLowerCase() === name.toLowerCase())) continue;

      const content = await readFileSafe(comp.path);
      if (!content) continue;

      const lines = content.split("\n");
      for (let idx = 0; idx < lines.length; idx++) {
        hookCallRegex.lastIndex = 0;
        if (!hookCallRegex.test(lines[idx])) continue;
        usages.push({
          file: comp.relativePath,
          component: comp.name,
          line: idx + 1,
          usageType: "import",
        });
      }
    }
  }

  const seen = new Set<string>();
  return usages.filter((u) => {
    const key = `${u.file}:${u.line}:${u.usageType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function scanFileForUsages(
  content: string | null,
  relativePath: string,
  componentName: string,
  jsxRegex: RegExp,
  importRegex: RegExp,
  usages: ComponentUsage[]
): void {
  if (!content) {
    usages.push({
      file: relativePath,
      component: componentName,
      line: 0,
      usageType: "jsx",
    });
    return;
  }

  const lines = content.split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    for (const [regex, type] of [[jsxRegex, "jsx"], [importRegex, "import"]] as const) {
      regex.lastIndex = 0;
      if (!regex.test(line)) continue;
      usages.push({
        file: relativePath,
        component: componentName,
        line: idx + 1,
        usageType: type,
      });
    }
  }
}
