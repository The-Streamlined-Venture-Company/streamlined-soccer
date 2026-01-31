/**
 * Streamlined Soccer MCP Server
 *
 * A thin MCP client that forwards all tool calls to the central Tools API.
 *
 * Update the Edge Function once → Updates here instantly (no rebuild needed).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ============================================================================
// Configuration
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("Error: SUPABASE_URL environment variable is required");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required");
  process.exit(1);
}

// Tools API endpoint
const TOOLS_API_URL = `${SUPABASE_URL}/functions/v1/tools-api`;

// ============================================================================
// API Client
// ============================================================================

interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

async function callToolsApi(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await fetch(TOOLS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ tool, args }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error (${response.status}):`, errorText);
      return { success: false, error: `API error: ${response.status}` };
    }

    const result = await response.json();
    return result as ToolResult;
  } catch (err) {
    console.error('Failed to call Tools API:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to call Tools API'
    };
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new McpServer({
  name: "streamlined-soccer",
  version: "1.0.0",
});

// ============================================================================
// Tool Registrations
// ============================================================================

// list_players
server.tool(
  "list_players",
  "List all players with optional filtering and sorting",
  {
    status: z.enum(['all', 'regular', 'newbie', 'inactive']).optional().describe('Filter by player status'),
    position: z.enum(['all', 'attacking', 'midfield', 'defensive', 'everywhere']).optional().describe('Filter by position'),
    search: z.string().optional().describe('Search by player name'),
    limit: z.number().optional().describe('Maximum results to return'),
    sortBy: z.enum(['name', 'overall_score', 'created_at']).optional().describe('Sort field'),
    sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort order'),
  },
  async (args) => {
    const result = await callToolsApi('list_players', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// get_player
server.tool(
  "get_player",
  "Get detailed information about a specific player by name or ID",
  {
    name: z.string().optional().describe('Player name (partial match supported)'),
    id: z.string().optional().describe('Player UUID'),
  },
  async (args) => {
    const result = await callToolsApi('get_player', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// start_add_player - Phase 1: Get name, return skill questions
server.tool(
  "start_add_player",
  "Start adding a new player. Returns skill questions to show the user. MUST use this first, then complete_add_player after user provides skills.",
  {
    name: z.string().describe('Player name'),
  },
  async (args) => {
    const result = await callToolsApi('start_add_player', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// complete_add_player - Phase 2: Add with user-provided skills (ALL REQUIRED)
server.tool(
  "complete_add_player",
  "Complete adding a player. ALL skill ratings, position, and linchpin status are REQUIRED and must come from user input. Do NOT invent values.",
  {
    name: z.string().describe('Player name'),
    shooting: z.number().min(1).max(10).describe('Shooting 1-10 (REQUIRED from user)'),
    passing: z.number().min(1).max(10).describe('Passing 1-10 (REQUIRED from user)'),
    ball_control: z.number().min(1).max(10).describe('Ball control 1-10 (REQUIRED from user)'),
    playmaking: z.number().min(1).max(10).describe('Playmaking 1-10 (REQUIRED from user)'),
    defending: z.number().min(1).max(10).describe('Defending 1-10 (REQUIRED from user)'),
    fitness: z.number().min(1).max(10).describe('Fitness 1-10 (REQUIRED from user)'),
    preferred_position: z.enum(['attacking', 'midfield', 'defensive', 'everywhere']).describe('Position (REQUIRED from user)'),
    is_linchpin: z.boolean().describe('Is key player who should be split across teams? (REQUIRED from user)'),
    status: z.enum(['regular', 'newbie', 'inactive']).optional().describe('Player status'),
  },
  async (args) => {
    const result = await callToolsApi('complete_add_player', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// update_player
server.tool(
  "update_player",
  "Update an existing player's information. Find player by name or ID.",
  {
    name: z.string().optional().describe('Current player name to find'),
    id: z.string().optional().describe('Player UUID to find'),
    new_name: z.string().optional().describe('New name for the player'),
    status: z.enum(['regular', 'newbie', 'inactive']).optional().describe('New status'),
    preferred_position: z.enum(['attacking', 'midfield', 'defensive', 'everywhere']).optional().describe('New position'),
    shooting: z.number().optional(),
    passing: z.number().optional(),
    ball_control: z.number().optional(),
    playmaking: z.number().optional(),
    defending: z.number().optional(),
    fitness: z.number().optional(),
    overall_score: z.number().optional().describe('Set overall score (derives individual skills)'),
    is_linchpin: z.boolean().optional(),
    aliases: z.array(z.string()).optional(),
    notes: z.string().optional(),
  },
  async (args) => {
    const result = await callToolsApi('update_player', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// delete_player
server.tool(
  "delete_player",
  "Delete a player from the database. Requires confirmation.",
  {
    name: z.string().optional().describe('Player name to delete'),
    id: z.string().optional().describe('Player UUID to delete'),
    confirm: z.boolean().optional().describe('Set true to confirm deletion'),
  },
  async (args) => {
    const result = await callToolsApi('delete_player', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// get_stats
server.tool(
  "get_stats",
  "Get statistics about the player database",
  {
    type: z.enum(['overview', 'top_players', 'position_breakdown']).optional().describe('Type of statistics'),
    limit: z.number().optional().describe('Number of top players to show'),
  },
  async (args) => {
    const result = await callToolsApi('get_stats', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// NOTE: bulk_add_players removed to prevent Claude from bypassing the two-phase add flow

// search_players
server.tool(
  "search_players",
  "Search for players by name or alias",
  {
    query: z.string().describe('Search query (matches name and aliases)'),
  },
  async (args) => {
    const result = await callToolsApi('search_players', args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  console.error("Starting Streamlined Soccer MCP Server...");
  console.error(`Tools API: ${TOOLS_API_URL}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("MCP Server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
