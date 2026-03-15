# Component Intelligence

MCP server that gives Claude deep awareness of your frontend codebase — components, hooks, services, routes, data flow, the whole thing. Point it at a React or Vue project and it builds a catalog that Claude can query while it works.

## TLDR: Quick Start

1. **Configure VS Code** (via your MCP extension settings, e.g. `.vscode/mcp.json`):
   ```json
   {
     "mcpServers": {
       "component-intelligence": {
         "command": "node",
         "args": ["/absolute/path/to/component-intelligence/dist/server.js"],
         "env": {
           "WORKSPACE_ROOT": "/absolute/path/to/your/target/project"
         }
       }
     }
   }
   ```
2. **Restart VS Code and try these prompts:**
   - *"List all the components in my project."* (`list_all_components`)
   - *"What are the props for the Button component?"* (`get_component_props`)
   - *"Show me the data flow for the UserProfile component."* (`get_data_flow`)
   - *"Are there any dead components we can delete?"* (`find_dead_code`)

## What it does

Instead of Claude grep-ing around your codebase every time it needs to understand how things fit together, this server scans your project up front and exposes a set of tools for navigating the architecture. It understands:

- **Components, pages, hooks, services, adapters, contexts** — categorized by architecture layer
- **Props and interfaces** — parsed from TypeScript definitions
- **Dependency chains** — what uses what, upstream and downstream
- **Route maps** — React Router and Vue Router, including protected routes and nested layouts
- **Data flow** — traces the full path from component → hook → service → adapter → API endpoint
- **Dead code** — finds exported items that nothing imports

It auto-detects whether your project is React, Vue and sets up sensible scan targets accordingly. File watching keeps the cache fresh as you work.

## Setup

Add to your project's `.mcp.json` (or `~/.claude/mcp.json` for global):

```json
{
  "mcpServers": {
    "component-intelligence": {
      "command": "node",
      "args": ["/path/to/component-intelligence/dist/server.js"],
      "env": {
        "WORKSPACE_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

`WORKSPACE_ROOT` tells the server where your project lives. You can also pass it as a CLI arg (`node dist/server.js /path/to/project`). If neither is set, it defaults to two directories up from the server because that's where mine lives. Feel free to update if you have a common folder for MCPs.

## Configuration

Put a `.component-intelligence.json` in your project root to customize scanning. If you don't create one, the server auto-detects your framework and uses defaults for React or Vue based on what it finds.

```json
{
  "scanTargets": [
    { "dir": "src/components", "extensions": [".tsx"], "type": "component" },
    { "dir": "src/pages", "extensions": [".tsx"], "type": "page" },
    { "dir": "src/hooks", "extensions": [".ts", ".tsx"], "type": "hook" },
    { "dir": "src/services", "extensions": [".ts"], "type": "service" },
    { "dir": "src/adapters", "extensions": [".ts"], "type": "adapter" },
    { "dir": "src/contexts", "extensions": [".tsx"], "type": "context" }
  ],
  "routeFiles": ["src/App.tsx"],
  "aliases": {
    "@/": "src/"
  },
  "exclude": ["node_modules", "dist", "build", "__tests__", "*.test.*", "*.spec.*"]
}
```

| Field | What it does |
|-------|-------------|
| `scanTargets` | Directories to scan, what extensions to look for, and what architecture layer they belong to. Valid types: `component`, `page`, `hook`, `service`, `adapter`, `context`, `dto`, `type` |
| `routeFiles` | Entry points for route parsing (React Router or Vue Router) |
| `aliases` | Path aliases so the server can resolve imports like `@/components/Button` |
| `exclude` | Glob patterns to skip |

### Defaults by framework

**React** — scans `src/components` (.tsx), `src/pages` (.tsx), `src/hooks` (.ts/.tsx), `src/services` (.ts), `src/adapters` (.ts), `src/contexts` (.tsx). Routes from `src/App.tsx`.

**Vue** — scans `src/components` (.vue), `src/views` + `src/pages` (.vue), `src/composables` (.ts), `src/services` (.ts), `src/adapters` (.ts). Routes from `src/router/index.ts`.

## Tools

### `list_all_components`
Lists everything in the catalog organized by category and layer. Optionally filter by layer.

### `search_components`
Fuzzy search across the whole codebase by name, path, or keywords. Multi-token scoring, ranked by relevance.

### `get_component_props`
Returns the TypeScript prop interface for a component — prop names, types, required/optional, defaults, and JSDoc descriptions.

### `find_similar_components`
Describe what you're looking for in plain English and it finds matching components using keyword + structural matching (hooks used, child components, data fetching patterns, layer).

### `get_component_detail`
Full metadata dump for any item — props, hooks, state, children, event handlers, data fetching, accessibility info, API endpoints, architecture layer.

### `find_component_usages`
Find everywhere a component/hook/service is imported or rendered. Returns files, parent components, and line numbers. Good for impact analysis before making changes.

### `get_architecture_overview`
High-level view of the whole app — counts by layer, category breakdown, data flow chains, and the route map.

### `get_dependency_chain`
Traces upstream (what uses it) and downstream (what it depends on) for any item. Supports recursive depth 1-3.

### `get_route_map`
Full route → page → component mapping with protection status, hooks used, child components, dynamic segments, and nested routes.

### `get_hook_detail`
Deep dive on a hook/composable — parameters, return type, query keys, adapter calls, data fetching pattern, and which components use it.

### `find_dead_code`
Finds exported items that are never imported anywhere. Optionally filter by layer.

### `get_data_flow`
Traces the full data path: component → composable/hook → service → adapter → API endpoint. Saves you from manually chaining `get_component_detail` + `get_hook_detail` calls.
