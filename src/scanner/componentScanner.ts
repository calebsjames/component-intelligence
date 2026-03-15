import fs from "fs/promises";
import path from "path";
import { ComponentAnalyzer } from "../analyzer/componentAnalyzer.js";
import type {
  Component,
  ComponentCatalog,
  ScanTarget,
  ArchitectureLayer,
  ProjectConfig,
} from "../types.js";
import { DEFAULT_SCAN_TARGETS } from "../config/configLoader.js";

/**
 * Component Scanner
 * Recursively scans multiple directories and builds a catalog of all
 * React components, pages, hooks, services, adapters, and contexts
 */
export class ComponentScanner {
  private workspaceRoot: string;
  private scanTargets: ScanTarget[];
  private analyzer: ComponentAnalyzer;
  private excludePatterns: string[];

  constructor(workspaceRoot: string, config?: ProjectConfig) {
    this.workspaceRoot = workspaceRoot;
    this.scanTargets = config?.scanTargets || DEFAULT_SCAN_TARGETS;
    this.analyzer = new ComponentAnalyzer(config);
    this.excludePatterns = config?.exclude || [
      "node_modules", "dist", "build", "__tests__", "*.test.*", "*.spec.*",
    ];
  }

  /**
   * Scan all targets and build catalog
   */
  async scan(): Promise<ComponentCatalog> {
    const allComponents: Component[] = [];

    for (const target of this.scanTargets) {
      const targetDir = path.join(this.workspaceRoot, target.dir);
      try {
        await fs.access(targetDir);
        const components = await this.scanDirectory(
          targetDir,
          target,
          undefined
        );
        allComponents.push(...components);
      } catch {
        // Directory doesn't exist, skip
      }
    }

    // Organize by category
    const categories: Record<string, Component[]> = {};
    for (const component of allComponents) {
      if (!categories[component.category]) {
        categories[component.category] = [];
      }
      categories[component.category].push(component);
    }

    // Sort each category alphabetically (case-insensitive)
    for (const category in categories) {
      categories[category].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
    }

    return {
      components: allComponents,
      categories,
      totalCount: allComponents.length,
      lastScanned: Date.now(),
    };
  }

  /**
   * Recursively scan directory for matching files
   */
  private async scanDirectory(
    dir: string,
    target: ScanTarget,
    parentCategory?: string
  ): Promise<Component[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
      return [];
    }

    const components: Component[] = [];

    for (const entry of entries) {
      if (this.isExcluded(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const category = this.determineCategory(fullPath, target);
        const subComponents = await this.scanDirectory(fullPath, target, category);
        components.push(...subComponents);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!target.extensions.some((ext) => entry.name.endsWith(ext))) continue;

      let content: string;
      try {
        content = await fs.readFile(fullPath, "utf-8");
      } catch {
        continue;
      }

      const stats = await fs.stat(fullPath);
      const category = parentCategory || this.determineCategory(fullPath, target);
      const relativePath = path.relative(this.workspaceRoot, fullPath);
      const fileBaseName = entry.name.replace(/\.(vue|tsx?|jsx?)$/, "");
      const componentName = this.extractExportedName(content, fileBaseName) || fileBaseName;
      const analysis = await this.analyzer.analyzeComponent(fullPath, componentName, target.type);

      const component: Component = {
        name: componentName,
        path: fullPath,
        relativePath,
        category,
        architectureLayer: target.type,
        lastModified: stats.mtimeMs,
        ...analysis,
      };

      // Track filename alias when defineComponent name differs from filename
      if (componentName !== fileBaseName && fileBaseName !== componentName) {
        (component as any).fileAlias = fileBaseName;
      }

      components.push(component);
    }

    return components;
  }

  /**
   * Check if a filename matches any exclude pattern
   */
  private isExcluded(name: string): boolean {
    return this.excludePatterns.some((pattern) => {
      if (!pattern.includes("*")) return name === pattern;
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      return regex.test(name);
    });
  }

  /**
   * Extract the actual exported symbol name from file content.
   */
  private static EXPORT_PATTERNS: RegExp[] = [
    /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)\b/,
    /export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9]*)\s*[=:]/,
    /export\s+default\s+class\s+([A-Z][A-Za-z0-9]*)\b/,
    /export\s+(?:default\s+)?function\s+(use[A-Z][A-Za-z0-9]*)\b/,
    /export\s+const\s+(use[A-Z][A-Za-z0-9]*)\s*[=:]/,
    /export\s+class\s+([A-Za-z][A-Za-z0-9]*)\b/,
    /export\s+(?:async\s+)?function\s+([a-zA-Z][A-Za-z0-9]*)\b/,
  ];

  private extractExportedName(
    content: string,
    fileBaseName: string
  ): string | null {
    for (const pattern of ComponentScanner.EXPORT_PATTERNS) {
      const match = content.match(pattern);
      if (match) return match[1];
    }

    // Vue: defineComponent({ name: "ComponentName" })
    const defineComponentName = content.match(
      /defineComponent\(\s*\{[^}]*name:\s*["']([A-Za-z][A-Za-z0-9]*)["']/
    );
    if (defineComponentName) return defineComponentName[1];

    return null;
  }

  /**
   * Determine component category based on file path and scan target
   */
  private determineCategory(filePath: string, target: ScanTarget): string {
    const targetDir = path.join(this.workspaceRoot, target.dir);
    const relativePath = path.relative(targetDir, filePath);
    const parts = relativePath.split(path.sep);

    if (target.type === "component") {
      if (parts[0] === "ui") return "ui-primitives";
      if (parts.length > 1) return this.toCategoryName(parts[0]);
      return "root";
    }

    if (parts.length > 1) {
      return `${target.type}:${this.toCategoryName(parts[0])}`;
    }

    return target.type;
  }

  /**
   * Convert directory name to category name (PascalCase to kebab-case)
   */
  private toCategoryName(dirName: string): string {
    return dirName
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");
  }

  /**
   * Watch for file changes across all scan targets and invalidate cache
   */
  async watch(onChange: () => void): Promise<() => void> {
    const stopFunctions: (() => void)[] = [];

    for (const target of this.scanTargets) {
      const targetDir = path.join(this.workspaceRoot, target.dir);
      try {
        await fs.access(targetDir);
        const watcher = fs.watch(targetDir, { recursive: true });
        let stopped = false;

        (async () => {
          try {
            for await (const event of watcher) {
              if (stopped) break;
              if (
                event.filename &&
                target.extensions.some((ext) =>
                  event.filename!.endsWith(ext)
                )
              ) {
                onChange();
              }
            }
          } catch (error) {
            if (!stopped) {
              console.error(
                `File watcher error for ${target.dir}:`,
                error
              );
            }
          }
        })();

        stopFunctions.push(() => {
          stopped = true;
          (watcher as unknown as { close?: () => void }).close?.();
        });
      } catch {
        // Directory doesn't exist, skip watcher
      }
    }

    return () => {
      for (const stop of stopFunctions) {
        stop();
      }
    };
  }
}
