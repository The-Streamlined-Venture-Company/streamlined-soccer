# PitchMaster Pro MCP Server

MCP (Model Context Protocol) server for managing your football/soccer player database via Claude Desktop, Claude Code, or any MCP-compatible client.

## Features

8 tools for complete player management:

| Tool | Description |
|------|-------------|
| `list_players` | Query players with filtering/sorting |
| `get_player` | Find player by name or ID |
| `add_player` | Create new player |
| `update_player` | Modify existing player |
| `delete_player` | Remove player (requires confirmation) |
| `get_stats` | Database statistics |
| `bulk_add_players` | Mass import players |
| `search_players` | Fuzzy search by name/aliases |

## Setup

### 1. Install Dependencies

```bash
cd mcp-server
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Get Your Supabase Credentials

You need:
- **SUPABASE_URL**: Your project URL (e.g., `https://xxxx.supabase.co`)
- **SUPABASE_SERVICE_ROLE_KEY**: Service role key from Settings > API

### 4. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "streamlined-soccer": {
      "command": "node",
      "args": ["/Users/zeemkane/Documents/Apps/streamlined soccer/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://jgjjnpofbpvekdvdzbgb.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key-here"
      }
    }
  }
}
```

### 5. Restart Claude Desktop

Quit and reopen Claude Desktop. You should see the tools available.

## Usage Examples

Once configured, you can ask Claude:

- "Show me all players"
- "Add Mo with rating 75"
- "Update John's position to midfield"
- "Who are the top 5 players?"
- "Delete Sarah" (will ask for confirmation)
- "Add these players: Ahmed 80, Sara 70, Mike 65"

## Development

### Run in watch mode
```bash
npm run dev
```

### Test with MCP Inspector
```bash
npm run inspect
```

## Architecture

This MCP server shares the same database handlers as the web app's Edge Function. Changes to `shared/handlers.ts` automatically apply to both:

```
shared/
├── types.ts         # TypeScript interfaces
├── tool-schemas.ts  # Tool definitions (JSON Schema)
├── handlers.ts      # Database operations (THE SOURCE OF TRUTH)
└── index.ts         # Barrel export

mcp-server/
├── src/
│   ├── index.ts     # MCP server entry point
│   └── supabase.ts  # Supabase client for Node.js
└── dist/            # Compiled output
```

## Troubleshooting

### "Missing environment variables" error
Make sure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in your Claude Desktop config.

### Tools not appearing in Claude
1. Check the config file path is correct
2. Make sure you've built the project (`npm run build`)
3. Restart Claude Desktop completely (quit, not just close window)

### Database connection issues
Verify your Supabase credentials are correct and the service role key has access to the `soccer` schema.

## Claude Code Integration

You can also use this MCP server with Claude Code. Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "streamlined-soccer": {
      "command": "node",
      "args": ["/Users/zeemkane/Documents/Apps/streamlined soccer/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://jgjjnpofbpvekdvdzbgb.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key-here"
      }
    }
  }
}
```
