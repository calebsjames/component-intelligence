#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./config/configLoader.js";
import { ComponentScanner } from "./scanner/componentScanner.js";
import { PropParser } from "./parser/propParser.js";
import { CacheManager } from "./cache/cacheManager.js";
import { RouteAnalyzer } from "./analyzer/routeAnalyzer.js";
import { listAllComponents } from "./tools/listAllComponents.js";
import { searchComponents } from "./tools/searchComponents.js";
import { getComponentProps } from "./tools/getComponentProps.js";
import { findSimilarComponents } from "./tools/findSimilarComponents.js";
import { getComponentDetail } from "./tools/getComponentDetail.js";
import { findComponentUsages } from "./tools/findComponentUsages.js";
import { getArchitectureOverview } from "./tools/getArchitectureOverview.js";
import { getDependencyChain } from "./tools/getDependencyChain.js";
import { getRouteMap } from "./tools/getRouteMap.js";
import { getHookDetail } from "./tools/getHookDetail.js";
import { findDeadCode } from "./tools/findDeadCode.js";
import { getDataFlow } from "./tools/getDataFlow.js";

// Get workspace root from env, CLI arg, or fall back to parent of mcp-server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(
  process.env.WORKSPACE_ROOT || process.argv[2] || path.resolve(__dirname, "../../")
);

// Load configuration
const config = await loadConfig(WORKSPACE_ROOT);

// Initialize services with config
const scanner = new ComponentScanner(WORKSPACE_ROOT, config);
const parser = new PropParser();
const cache = new CacheManager();
const routeAnalyzer = new RouteAnalyzer(WORKSPACE_ROOT, config);

// MCP Tool Definitions
const TOOLS = [
  {
    name: "list_all_components",
    description:
      "List all items in the codebase catalog organized by category and architecture layer (components, pages, hooks, services, adapters, contexts). Returns names, paths, layer type, and metadata including child components, event handlers, data fetching patterns, and more.",
    inputSchema: {
      type: "object",
      properties: {
        layer: {
          type: "string",
          description:
            "Optional: filter by architecture layer (component, page, hook, service, adapter, context, dto, type)",
          enum: ["component", "page", "hook", "service", "adapter", "context", "dto", "type"],
        },
      },
      required: [],
    },
  },
  {
    name: "search_components",
    description:
      "Search across the full codebase (components, pages, hooks, services, adapters, DTOs, types) by name, path, description, or keywords. Uses fuzzy matching and multi-token scoring. Returns results ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Search query - component name, keyword, or multi-word phrase (e.g., "patient card", "handoff button")',
        },
        layer: {
          type: "string",
          description:
            "Optional: filter results to a specific architecture layer",
          enum: ["component", "page", "hook", "service", "adapter", "context", "dto", "type"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_component_props",
    description:
      "Get TypeScript prop interface for a specific component. Returns prop names, types, required status, default values, and JSDoc descriptions. Supports both interface and type alias prop definitions.",
    inputSchema: {
      type: "object",
      properties: {
        componentPath: {
          type: "string",
          description:
            'Relative path to component file from workspace root (e.g., "src/components/ui/button.tsx")',
        },
      },
      required: ["componentPath"],
    },
  },
  {
    name: "find_similar_components",
    description:
      "Find components similar to a natural language description using keyword AND structural matching. Scores based on name, hooks, child components, data fetching pattern, and architecture layer. Returns up to 15 results.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            'Natural language description (e.g., "button for submitting forms", "hook that fetches patient data")',
        },
      },
      required: ["description"],
    },
  },
  {
    name: "get_component_detail",
    description:
      "Get detailed information about a specific component, page, hook, service, or adapter by name. Returns full metadata including props, hooks, state, child components, event handlers, data fetching pattern, accessibility, API endpoints, and architecture layer.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            'Item name (e.g., "Button", "PatientDetail", "useHandoffState", "patientAdapter")',
        },
        file: {
          type: "string",
          description:
            "Optional file path to disambiguate if multiple items have the same name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "find_component_usages",
    description:
      "Find where a component, hook, or service is used (imported and rendered in templates/JSX) across the entire codebase. Searches components, pages, hooks, services, etc. Returns files, parent items, and line numbers with usage type (template, jsx, or import). Useful for impact analysis.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            'Name to search for (e.g., "Button", "useHandoffState", "patientService")',
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_architecture_overview",
    description:
      "Get a high-level overview of the entire application architecture. Returns counts by layer (components, pages, hooks, services, adapters, contexts), category breakdown, data flow chains (page -> hook -> service), and route map.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_dependency_chain",
    description:
      "Get the full dependency chain for any component, hook, or service. Returns both upstream (what uses it) and downstream (what it depends on) relationships. Supports recursive traversal with depth parameter (1-3). Useful for understanding impact of changes and tracing data flow.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            'Item name (e.g., "CompleteHandoffButton", "useHandoffState")',
        },
        depth: {
          type: "number",
          description:
            "Recursion depth (1-3, default 1). Depth 2+ includes nested dependsOn/usedBy on child nodes.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_route_map",
    description:
      "Get the complete route -> page -> component mapping. Returns all routes (React Router or Vue Router) with their page components, protection status, hooks/composables used, child components rendered, dynamic segments, and nested route hierarchy.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_hook_detail",
    description:
      "Get detailed information about a custom hook or Vue composable. Returns parameters, return type, query keys, adapter/service calls, data fetching pattern, and which components use this hook/composable.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'Hook name (e.g., "useHandoffState", "usePatientData")',
        },
      },
      required: ["name"],
    },
  },
  {
    name: "find_dead_code",
    description:
      "Find dead code — exported components, hooks, services, and adapters that are never imported or used anywhere else in the codebase. Returns unused exports with reasons explaining why they appear unused. Useful for codebase cleanup.",
    inputSchema: {
      type: "object",
      properties: {
        layer: {
          type: "string",
          description:
            "Optional: limit dead code search to a specific architecture layer",
          enum: ["component", "page", "hook", "service", "adapter", "context", "dto", "type"],
        },
      },
      required: [],
    },
  },
  {
    name: "get_data_flow",
    description:
      "Trace the full data path from a component through composables → services → adapters → API endpoints. Returns the complete chain with file paths. Replaces the common multi-step pattern of chaining get_component_detail + get_hook_detail + manual tracing.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            'Component or composable name (e.g., "ProjectModal", "useProjectModal")',
        },
      },
      required: ["name"],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: "component-intelligence",
    version: "2.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Setup file watcher for cache invalidation
let stopWatching: (() => void) | null = null;

scanner
  .watch(() => {
    console.error("File change detected, invalidating cache...");
    cache.invalidateCatalog();
  })
  .then((stop: () => void) => {
    stopWatching = stop;
  });

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

function jsonResponse(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function requireStringArg(args: Record<string, unknown> | undefined, key: string): string {
  if (!args || typeof args[key] !== "string") {
    throw new Error(`Missing required argument: ${key} (string)`);
  }
  return args[key] as string;
}

async function handleToolCall(name: string, args?: Record<string, unknown>) {
  switch (name) {
    case "list_all_components": {
      const result = await listAllComponents(scanner, cache);
      if (!args?.layer || typeof args.layer !== "string") return result;
      const components = result.components.filter(
        (c: any) => c.architectureLayer === args.layer
      );
      return { ...result, components, totalCount: components.length };
    }

    case "search_components":
      return searchComponents(requireStringArg(args, "query"), scanner, cache, {
        layer: args?.layer as
          | "component" | "page" | "hook" | "service" | "adapter" | "context" | "dto" | "type"
          | undefined,
      });

    case "get_component_props":
      return getComponentProps(
        requireStringArg(args, "componentPath"), WORKSPACE_ROOT, parser, cache
      );

    case "find_similar_components":
      return findSimilarComponents(
        requireStringArg(args, "description"), scanner, cache
      );

    case "get_component_detail":
      return getComponentDetail(
        { name: requireStringArg(args, "name"), file: args?.file as string | undefined },
        scanner, parser, cache
      );

    case "find_component_usages":
      return findComponentUsages(
        { name: requireStringArg(args, "name") }, scanner, cache, WORKSPACE_ROOT
      );

    case "get_architecture_overview":
      return getArchitectureOverview(scanner, cache, routeAnalyzer);

    case "get_dependency_chain":
      return getDependencyChain(
        { name: requireStringArg(args, "name"), depth: args?.depth as number | undefined },
        scanner, cache
      );

    case "get_route_map":
      return getRouteMap(routeAnalyzer, scanner, cache);

    case "get_hook_detail":
      return getHookDetail(
        { name: requireStringArg(args, "name") }, scanner, cache
      );

    case "find_dead_code":
      return findDeadCode(
        scanner, cache, WORKSPACE_ROOT,
        { layer: args?.layer as string | undefined },
        routeAnalyzer
      );

    case "get_data_flow":
      return getDataFlow(
        { name: requireStringArg(args, "name") },
        scanner, cache
      );

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleToolCall(name, args);
    return jsonResponse(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    "Component Intelligence MCP Server running on stdio"
  );
  console.error(`Workspace: ${WORKSPACE_ROOT}`);
  console.error(`Config: ${JSON.stringify({
    scanTargets: config.scanTargets?.length,
    routeFiles: config.routeFiles,
    aliases: config.aliases,
    exclude: config.exclude?.length,
  })}`);
}

// Cleanup on exit
function shutdown() {
  stopWatching?.();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
