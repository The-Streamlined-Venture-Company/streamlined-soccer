/**
 * Tool schemas for the Unified AI Command System
 *
 * These schemas are used by:
 * - MCP Server: Exposed as tools with JSON Schema format
 * - Edge Function: Converted to Gemini function declarations
 *
 * Format is JSON Schema compliant, which both MCP and Gemini support
 */

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
}

export interface PropertySchema {
  type: string;
  description?: string;  // Optional for nested items
  enum?: string[];
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
  required?: string[];
  default?: unknown;
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'list_players',
    description: 'List all players in the database. Can filter by status, position, or search by name.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['regular', 'newbie', 'inactive', 'all'],
          description: "Filter by player status. Use 'all' to show all players."
        },
        position: {
          type: 'string',
          enum: ['attacking', 'midfield', 'defensive', 'everywhere', 'all'],
          description: "Filter by preferred position. Use 'all' for any position."
        },
        search: {
          type: 'string',
          description: 'Search players by name (partial match)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of players to return (default 20)'
        },
        sortBy: {
          type: 'string',
          enum: ['name', 'overall_score', 'created_at'],
          description: 'Sort results by this field'
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (ascending or descending)'
        }
      }
    }
  },
  {
    name: 'get_player',
    description: 'Get detailed information about a specific player by name or ID',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Player name (partial match supported)'
        },
        id: {
          type: 'string',
          description: 'Player UUID'
        }
      }
    }
  },
  {
    name: 'add_player',
    description: 'Add a new player to the database. If no skills or overall_score are provided, returns skill questions to ask the user. Set confirm_defaults=true to skip questions and use default values.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Player name (required)'
        },
        status: {
          type: 'string',
          enum: ['regular', 'newbie', 'inactive'],
          description: 'Player status (default: regular)'
        },
        preferred_position: {
          type: 'string',
          enum: ['attacking', 'midfield', 'defensive', 'everywhere'],
          description: 'Preferred position (default: everywhere)'
        },
        shooting: {
          type: 'number',
          description: 'Shooting skill 0-10 (default: 5)'
        },
        passing: {
          type: 'number',
          description: 'Passing skill 0-10 (default: 5)'
        },
        ball_control: {
          type: 'number',
          description: 'Ball control skill 0-10 (default: 5)'
        },
        playmaking: {
          type: 'number',
          description: 'Playmaking skill 0-10 (default: 5)'
        },
        defending: {
          type: 'number',
          description: 'Defending skill 0-10 (default: 5)'
        },
        fitness: {
          type: 'number',
          description: 'Fitness level 0-10 (default: 5)'
        },
        overall_score: {
          type: 'number',
          description: "Overall player rating 0-100. If provided, this overrides the calculated value from skills. When user says 'Add John 75', use 75 as overall_score."
        },
        is_linchpin: {
          type: 'boolean',
          description: 'Whether player is a key/linchpin player'
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative names/nicknames for the player'
        },
        notes: {
          type: 'string',
          description: 'Additional notes about the player'
        },
        confirm_skills: {
          type: 'boolean',
          description: 'Set to true to confirm the derived skills and add the player. Required after reviewing skills.'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'update_player',
    description: "Update an existing player's information. Find player by name or ID.",
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Current player name to find'
        },
        id: {
          type: 'string',
          description: 'Player UUID'
        },
        new_name: {
          type: 'string',
          description: 'New name for the player'
        },
        status: {
          type: 'string',
          enum: ['regular', 'newbie', 'inactive'],
          description: 'Updated status'
        },
        preferred_position: {
          type: 'string',
          enum: ['attacking', 'midfield', 'defensive', 'everywhere'],
          description: 'Updated preferred position'
        },
        shooting: {
          type: 'number',
          description: 'Updated shooting skill 0-10'
        },
        passing: {
          type: 'number',
          description: 'Updated passing skill 0-10'
        },
        ball_control: {
          type: 'number',
          description: 'Updated ball control skill 0-10'
        },
        playmaking: {
          type: 'number',
          description: 'Updated playmaking skill 0-10'
        },
        defending: {
          type: 'number',
          description: 'Updated defending skill 0-10'
        },
        fitness: {
          type: 'number',
          description: 'Updated fitness level 0-10'
        },
        overall_score: {
          type: 'number',
          description: 'Directly set overall score 0-100 (overrides calculated value)'
        },
        is_linchpin: {
          type: 'boolean',
          description: 'Updated linchpin status'
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated aliases (replaces existing)'
        },
        notes: {
          type: 'string',
          description: 'Updated notes'
        }
      }
    }
  },
  {
    name: 'delete_player',
    description: 'Delete a player from the database. Use with caution!',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Player name to delete'
        },
        id: {
          type: 'string',
          description: 'Player UUID to delete'
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion'
        }
      }
    }
  },
  {
    name: 'get_stats',
    description: 'Get statistics about the player database',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['overview', 'top_players', 'position_breakdown', 'status_breakdown'],
          description: 'Type of stats to retrieve'
        },
        limit: {
          type: 'number',
          description: 'Number of results for top_players (default 10)'
        }
      }
    }
  },
  {
    name: 'bulk_add_players',
    description: 'Add multiple players at once. Useful for importing lists.',
    inputSchema: {
      type: 'object',
      properties: {
        players: {
          type: 'array',
          description: 'Array of player objects to add',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Player name (required)' },
              status: { type: 'string', description: 'Player status' },
              preferred_position: { type: 'string', description: 'Preferred position' },
              shooting: { type: 'number', description: 'Shooting skill 0-10' },
              passing: { type: 'number', description: 'Passing skill 0-10' },
              ball_control: { type: 'number', description: 'Ball control skill 0-10' },
              playmaking: { type: 'number', description: 'Playmaking skill 0-10' },
              defending: { type: 'number', description: 'Defending skill 0-10' },
              fitness: { type: 'number', description: 'Fitness level 0-10' },
              overall_score: { type: 'number', description: 'Overall score 0-100' },
              is_linchpin: { type: 'boolean', description: 'Linchpin status' },
              notes: { type: 'string', description: 'Notes about the player' }
            },
            required: ['name']
          }
        }
      },
      required: ['players']
    }
  },
  {
    name: 'search_players',
    description: 'Search for players using fuzzy matching. Good for finding players by partial names or nicknames.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (matches name and aliases)'
        }
      },
      required: ['query']
    }
  }
];

/**
 * Convert tool schemas to Gemini function declarations format
 */
export function toGeminiFunctionDeclarations() {
  return [{
    functionDeclarations: TOOL_SCHEMAS.map(schema => ({
      name: schema.name,
      description: schema.description,
      parameters: schema.inputSchema
    }))
  }];
}

/**
 * Get a specific tool schema by name
 */
export function getToolSchema(name: string): ToolSchema | undefined {
  return TOOL_SCHEMAS.find(s => s.name === name);
}
