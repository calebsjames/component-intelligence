import fs from "fs/promises";
import path from "path";
import type { ProjectConfig, ScanTarget } from "../types.js";

const CONFIG_FILENAME = ".component-intelligence.json";

const DEFAULT_SCAN_TARGETS: ScanTarget[] = [
  { dir: "src/components", extensions: [".tsx"], type: "component" },
  { dir: "src/pages", extensions: [".tsx"], type: "page" },
  { dir: "src/hooks", extensions: [".ts", ".tsx"], type: "hook" },
  { dir: "src/services", extensions: [".ts"], type: "service" },
  { dir: "src/adapters", extensions: [".ts"], type: "adapter" },
  { dir: "src/contexts", extensions: [".tsx"], type: "context" },
];

const DEFAULT_CONFIG: ProjectConfig = {
  scanTargets: DEFAULT_SCAN_TARGETS,
  routeFiles: ["src/App.tsx"],
  aliases: { "@/": "src/" },
  exclude: ["node_modules", "dist", "build", "__tests__", "*.test.*", "*.spec.*"],
};

/**
 * Load project configuration from .component-intelligence.json
 * Falls back to defaults if file doesn't exist
 */
export async function loadConfig(workspaceRoot: string): Promise<ProjectConfig> {
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const userConfig: ProjectConfig = JSON.parse(content);

    // Merge with defaults
    return {
      scanTargets: userConfig.scanTargets || DEFAULT_CONFIG.scanTargets,
      routeFiles: userConfig.routeFiles || DEFAULT_CONFIG.routeFiles,
      aliases: { ...DEFAULT_CONFIG.aliases, ...userConfig.aliases },
      exclude: userConfig.exclude || DEFAULT_CONFIG.exclude,
      phiCompliance: {
        ...DEFAULT_CONFIG.phiCompliance,
        ...userConfig.phiCompliance,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export { DEFAULT_SCAN_TARGETS };
