# Component Intelligence MCP Server

An MCP (Model Context Protocol) server for component intelligence.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build the server:
```bash
npm run build
```

3. Run the server:
```bash
npm start
```

## Development

To run in development mode with auto-rebuild:
```bash
npm run dev
```

## MCP Configuration

To use this server with an MCP client (like Claude Desktop), add it to your MCP settings file:

### macOS
Location: `~/Library/Application Support/Claude/claude_desktop_config.json`

### Windows
Location: `%APPDATA%\Claude\claude_desktop_config.json`

Configuration:
```json
{
  "mcpServers": {
    "component-intelligence": {
      "command": "node",
      "args": ["/absolute/path/to/component-inteligence/dist/server.js"]
    }
  }
}
```

## Adding Tools

To add new tools to your MCP server:

1. Add the tool definition to the `TOOLS` array in `src/index.ts`
2. Implement the tool logic in the `CallToolRequestSchema` handler
3. Rebuild the server with `npm run build`

## Example Tool

The server includes an example tool called `example_tool` that demonstrates the basic structure. Replace this with your own tools as needed.
