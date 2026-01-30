import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tool definitions for Gemini function calling
const tools = [
  {
    functionDeclarations: [
      {
        name: "list_players",
        description: "List all players in the database. Can filter by status, position, or search by name.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["regular", "newbie", "inactive", "all"],
              description: "Filter by player status. Use 'all' to show all players."
            },
            position: {
              type: "string",
              enum: ["attacking", "midfield", "defensive", "everywhere", "all"],
              description: "Filter by preferred position. Use 'all' for any position."
            },
            search: {
              type: "string",
              description: "Search players by name (partial match)"
            },
            limit: {
              type: "number",
              description: "Maximum number of players to return (default 20)"
            },
            sortBy: {
              type: "string",
              enum: ["name", "overall_score", "created_at"],
              description: "Sort results by this field"
            },
            sortOrder: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Sort order (ascending or descending)"
            }
          }
        }
      },
      {
        name: "get_player",
        description: "Get detailed information about a specific player by name or ID",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Player name (partial match supported)"
            },
            id: {
              type: "string",
              description: "Player UUID"
            }
          }
        }
      },
      {
        name: "add_player",
        description: "Add a new player to the database",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Player name (required)"
            },
            status: {
              type: "string",
              enum: ["regular", "newbie", "inactive"],
              description: "Player status (default: regular)"
            },
            preferred_position: {
              type: "string",
              enum: ["attacking", "midfield", "defensive", "everywhere"],
              description: "Preferred position (default: everywhere)"
            },
            shooting: {
              type: "number",
              description: "Shooting skill 0-10 (default: 5)"
            },
            passing: {
              type: "number",
              description: "Passing skill 0-10 (default: 5)"
            },
            ball_control: {
              type: "number",
              description: "Ball control skill 0-10 (default: 5)"
            },
            playmaking: {
              type: "number",
              description: "Playmaking skill 0-10 (default: 5)"
            },
            defending: {
              type: "number",
              description: "Defending skill 0-10 (default: 5)"
            },
            fitness: {
              type: "number",
              description: "Fitness level 0-10 (default: 5)"
            },
            overall_score: {
              type: "number",
              description: "Overall player rating 0-100. If provided, this overrides the calculated value from skills. When user says 'Add John 75', use 75 as overall_score."
            },
            is_linchpin: {
              type: "boolean",
              description: "Whether player is a key/linchpin player"
            },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Alternative names/nicknames for the player"
            },
            notes: {
              type: "string",
              description: "Additional notes about the player"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "update_player",
        description: "Update an existing player's information. Find player by name or ID.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Current player name to find"
            },
            id: {
              type: "string",
              description: "Player UUID"
            },
            new_name: {
              type: "string",
              description: "New name for the player"
            },
            status: {
              type: "string",
              enum: ["regular", "newbie", "inactive"],
              description: "Updated status"
            },
            preferred_position: {
              type: "string",
              enum: ["attacking", "midfield", "defensive", "everywhere"],
              description: "Updated preferred position"
            },
            shooting: {
              type: "number",
              description: "Updated shooting skill 0-10"
            },
            passing: {
              type: "number",
              description: "Updated passing skill 0-10"
            },
            ball_control: {
              type: "number",
              description: "Updated ball control skill 0-10"
            },
            playmaking: {
              type: "number",
              description: "Updated playmaking skill 0-10"
            },
            defending: {
              type: "number",
              description: "Updated defending skill 0-10"
            },
            fitness: {
              type: "number",
              description: "Updated fitness level 0-10"
            },
            overall_score: {
              type: "number",
              description: "Directly set overall score 0-100 (overrides calculated value)"
            },
            is_linchpin: {
              type: "boolean",
              description: "Updated linchpin status"
            },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Updated aliases (replaces existing)"
            },
            notes: {
              type: "string",
              description: "Updated notes"
            }
          }
        }
      },
      {
        name: "delete_player",
        description: "Delete a player from the database. Use with caution!",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Player name to delete"
            },
            id: {
              type: "string",
              description: "Player UUID to delete"
            },
            confirm: {
              type: "boolean",
              description: "Must be true to confirm deletion"
            }
          }
        }
      },
      {
        name: "get_stats",
        description: "Get statistics about the player database",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["overview", "top_players", "position_breakdown", "status_breakdown"],
              description: "Type of stats to retrieve"
            },
            limit: {
              type: "number",
              description: "Number of results for top_players (default 10)"
            }
          }
        }
      },
      {
        name: "bulk_add_players",
        description: "Add multiple players at once. Useful for importing lists.",
        parameters: {
          type: "object",
          properties: {
            players: {
              type: "array",
              description: "Array of player objects to add",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  status: { type: "string" },
                  preferred_position: { type: "string" },
                  shooting: { type: "number" },
                  passing: { type: "number" },
                  ball_control: { type: "number" },
                  playmaking: { type: "number" },
                  defending: { type: "number" },
                  fitness: { type: "number" },
                  overall_score: { type: "number" },
                  is_linchpin: { type: "boolean" },
                  notes: { type: "string" }
                },
                required: ["name"]
              }
            }
          },
          required: ["players"]
        }
      },
      {
        name: "search_players",
        description: "Search for players using fuzzy matching. Good for finding players by partial names or nicknames.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (matches name and aliases)"
            }
          },
          required: ["query"]
        }
      }
    ]
  }
];

// System prompt for the AI
const SYSTEM_PROMPT = `You are the AI assistant for PitchMaster Pro, a football/soccer team lineup management app. You help organizers manage their player database and create fair team lineups.

Your capabilities:
- List, search, and filter players
- Add new players with their skill ratings
- Update existing player information (names, ratings, positions, status)
- Delete players
- Get statistics about the player database
- Bulk add multiple players

Player attributes you can manage:
- name: Player's display name
- status: regular, newbie, or inactive
- preferred_position: attacking, midfield, defensive, or everywhere
- Skills (0-10 scale): shooting, passing, ball_control, playmaking, defending, fitness
- overall_score: Computed from skills (0-100 scale), but can be directly set
- is_linchpin: Whether the player is a key player who should be on separate teams
- aliases: Alternative names/nicknames for matching
- notes: Any additional information

When users ask to:
- "Add [name]" - Add a new player with default stats (overall_score: 50)
- "Add [name] [number]" - Add a new player with that number as overall_score (e.g., "Add Mo 75" means name="Mo", overall_score=75)
- "Add [name] [number] [position]" - Add player with score and position (e.g., "Add Mo 75 midfield")
- "Update [name]'s rating to X" - Update overall_score directly
- "Make [name] a defender" - Update preferred_position
- "Show all players" - List all players
- "Who are the best players?" - Get top players by overall_score
- "Delete [name]" - Delete player (ask for confirmation)

IMPORTANT: When a user says "Add [name] [number]", always interpret the number as the overall_score parameter.

Be helpful, concise, and always confirm destructive actions. If a player name is ambiguous, ask for clarification or show matching results.

Format your responses nicely with line breaks and bullet points where appropriate. Keep responses concise but informative.`;

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Execute a function call against the database
async function executeFunction(
  supabase: ReturnType<typeof createClient>,
  functionCall: FunctionCall
): Promise<ToolResult> {
  const { name, args } = functionCall;
  console.log(`Executing function: ${name}`, args);

  try {
    switch (name) {
      case "list_players": {
        let query = supabase.from("players").select("*");

        if (args.status && args.status !== "all") {
          query = query.eq("status", args.status);
        }
        if (args.position && args.position !== "all") {
          query = query.eq("preferred_position", args.position);
        }
        if (args.search) {
          query = query.ilike("name", `%${args.search}%`);
        }

        const sortBy = (args.sortBy as string) || "overall_score";
        const sortOrder = args.sortOrder === "asc" ? true : false;
        query = query.order(sortBy, { ascending: sortOrder });

        const limit = (args.limit as number) || 20;
        query = query.limit(limit);

        const { data, error } = await query;
        if (error) throw error;

        return { success: true, data: { players: data, count: data?.length || 0 } };
      }

      case "get_player": {
        let query = supabase.from("players").select("*");

        if (args.id) {
          query = query.eq("id", args.id);
        } else if (args.name) {
          query = query.ilike("name", `%${args.name}%`);
        } else {
          return { success: false, error: "Must provide name or id" };
        }

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
          return { success: false, error: "Player not found" };
        }

        return { success: true, data: data.length === 1 ? data[0] : data };
      }

      case "add_player": {
        if (!args.name) {
          return { success: false, error: "Player name is required" };
        }

        // Check if player already exists
        const { data: existing } = await supabase
          .from("players")
          .select("id, name")
          .ilike("name", args.name as string)
          .limit(1);

        if (existing && existing.length > 0) {
          return {
            success: false,
            error: `Player "${existing[0].name}" already exists`
          };
        }

        // If overall_score is provided, derive skill values from it
        // overall_score is a generated column = (sum of skills / 6) * 10
        // So if overall = 75, each skill should be 75/10 = 7.5 -> round to 7 or 8
        let skills: Record<string, number>;

        if (args.overall_score !== undefined && args.overall_score !== null) {
          // Convert overall score (0-100) to skill value (0-10)
          const targetSkill = Math.round((args.overall_score as number) / 10);
          const clampedSkill = Math.max(1, Math.min(10, targetSkill));
          skills = {
            shooting: (args.shooting as number) ?? clampedSkill,
            passing: (args.passing as number) ?? clampedSkill,
            ball_control: (args.ball_control as number) ?? clampedSkill,
            playmaking: (args.playmaking as number) ?? clampedSkill,
            defending: (args.defending as number) ?? clampedSkill,
            fitness: (args.fitness as number) ?? clampedSkill,
          };
        } else {
          skills = {
            shooting: (args.shooting as number) ?? 5,
            passing: (args.passing as number) ?? 5,
            ball_control: (args.ball_control as number) ?? 5,
            playmaking: (args.playmaking as number) ?? 5,
            defending: (args.defending as number) ?? 5,
            fitness: (args.fitness as number) ?? 5,
          };
        }

        // Note: overall_score is a GENERATED column - don't include it in insert!
        const newPlayer = {
          name: args.name,
          status: args.status || "regular",
          preferred_position: args.preferred_position || "everywhere",
          ...skills,
          is_linchpin: args.is_linchpin || false,
          aliases: args.aliases || [],
          notes: args.notes || null,
        };

        const { data, error } = await supabase
          .from("players")
          .insert(newPlayer)
          .select()
          .single();

        if (error) throw error;

        return { success: true, data: { message: `Added player: ${data.name}`, player: data } };
      }

      case "update_player": {
        // Find the player first
        let findQuery = supabase.from("players").select("*");

        if (args.id) {
          findQuery = findQuery.eq("id", args.id);
        } else if (args.name) {
          findQuery = findQuery.ilike("name", `%${args.name}%`);
        } else {
          return { success: false, error: "Must provide name or id to find player" };
        }

        const { data: players, error: findError } = await findQuery;
        if (findError) throw findError;

        if (!players || players.length === 0) {
          return { success: false, error: `Player not found: ${args.name || args.id}` };
        }

        if (players.length > 1) {
          return {
            success: false,
            error: `Multiple players match "${args.name}". Please be more specific.`,
            data: { matches: players.map(p => p.name) }
          };
        }

        const player = players[0];

        // Build update object (only include fields that were provided)
        const updates: Record<string, unknown> = {};
        if (args.new_name) updates.name = args.new_name;
        if (args.status) updates.status = args.status;
        if (args.preferred_position) updates.preferred_position = args.preferred_position;
        if (typeof args.shooting === "number") updates.shooting = args.shooting;
        if (typeof args.passing === "number") updates.passing = args.passing;
        if (typeof args.ball_control === "number") updates.ball_control = args.ball_control;
        if (typeof args.playmaking === "number") updates.playmaking = args.playmaking;
        if (typeof args.defending === "number") updates.defending = args.defending;
        if (typeof args.fitness === "number") updates.fitness = args.fitness;
        // Note: overall_score is a GENERATED column - handle it below by setting skills
        if (typeof args.is_linchpin === "boolean") updates.is_linchpin = args.is_linchpin;
        if (args.aliases) updates.aliases = args.aliases;
        if (args.notes !== undefined) updates.notes = args.notes;

        // If user wants to set overall_score directly, convert to skill values
        // (overall_score is a generated column, can't be set directly)
        if (typeof args.overall_score === "number") {
          const targetSkill = Math.round((args.overall_score as number) / 10);
          const clampedSkill = Math.max(1, Math.min(10, targetSkill));
          // Only set skills that weren't explicitly provided
          if (typeof args.shooting !== "number") updates.shooting = clampedSkill;
          if (typeof args.passing !== "number") updates.passing = clampedSkill;
          if (typeof args.ball_control !== "number") updates.ball_control = clampedSkill;
          if (typeof args.playmaking !== "number") updates.playmaking = clampedSkill;
          if (typeof args.defending !== "number") updates.defending = clampedSkill;
          if (typeof args.fitness !== "number") updates.fitness = clampedSkill;
        }

        updates.updated_at = new Date().toISOString();

        if (Object.keys(updates).length === 1) { // Only updated_at
          return { success: false, error: "No updates provided" };
        }

        const { data, error } = await supabase
          .from("players")
          .update(updates)
          .eq("id", player.id)
          .select()
          .single();

        if (error) throw error;

        return {
          success: true,
          data: { message: `Updated ${player.name}`, player: data, changes: updates }
        };
      }

      case "delete_player": {
        if (!args.confirm) {
          return {
            success: false,
            error: "Deletion requires confirmation. Please confirm you want to delete this player."
          };
        }

        // Find the player first
        let findQuery = supabase.from("players").select("id, name");

        if (args.id) {
          findQuery = findQuery.eq("id", args.id);
        } else if (args.name) {
          findQuery = findQuery.ilike("name", `%${args.name}%`);
        } else {
          return { success: false, error: "Must provide name or id" };
        }

        const { data: players, error: findError } = await findQuery;
        if (findError) throw findError;

        if (!players || players.length === 0) {
          return { success: false, error: "Player not found" };
        }

        if (players.length > 1) {
          return {
            success: false,
            error: `Multiple players match. Please be more specific.`,
            data: { matches: players.map(p => p.name) }
          };
        }

        const { error } = await supabase
          .from("players")
          .delete()
          .eq("id", players[0].id);

        if (error) throw error;

        return { success: true, data: { message: `Deleted player: ${players[0].name}` } };
      }

      case "get_stats": {
        const statsType = (args.type as string) || "overview";

        if (statsType === "overview") {
          const { data: players, error } = await supabase
            .from("players")
            .select("status, preferred_position, overall_score");

          if (error) throw error;

          const total = players?.length || 0;
          const avgScore = total > 0
            ? Math.round(players!.reduce((sum, p) => sum + (p.overall_score || 0), 0) / total)
            : 0;
          const byStatus = players?.reduce((acc, p) => {
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          return {
            success: true,
            data: {
              totalPlayers: total,
              averageScore: avgScore,
              byStatus
            }
          };
        }

        if (statsType === "top_players") {
          const limit = (args.limit as number) || 10;
          const { data, error } = await supabase
            .from("players")
            .select("name, overall_score, preferred_position")
            .order("overall_score", { ascending: false })
            .limit(limit);

          if (error) throw error;
          return { success: true, data: { topPlayers: data } };
        }

        if (statsType === "position_breakdown") {
          const { data, error } = await supabase
            .from("players")
            .select("preferred_position");

          if (error) throw error;

          const breakdown = data?.reduce((acc, p) => {
            acc[p.preferred_position] = (acc[p.preferred_position] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          return { success: true, data: { positionBreakdown: breakdown } };
        }

        if (statsType === "status_breakdown") {
          const { data, error } = await supabase
            .from("players")
            .select("status");

          if (error) throw error;

          const breakdown = data?.reduce((acc, p) => {
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          return { success: true, data: { statusBreakdown: breakdown } };
        }

        return { success: false, error: "Unknown stats type" };
      }

      case "bulk_add_players": {
        const playersToAdd = args.players as Array<{
          name: string;
          status?: string;
          preferred_position?: string;
          shooting?: number;
          passing?: number;
          ball_control?: number;
          playmaking?: number;
          defending?: number;
          fitness?: number;
          overall_score?: number;
          is_linchpin?: boolean;
          notes?: string;
        }>;

        if (!playersToAdd || playersToAdd.length === 0) {
          return { success: false, error: "No players provided" };
        }

        const formattedPlayers = playersToAdd.map(p => {
          // If overall_score provided, derive skills from it
          let skills: Record<string, number>;
          if (p.overall_score !== undefined && p.overall_score !== null) {
            const targetSkill = Math.round(p.overall_score / 10);
            const clampedSkill = Math.max(1, Math.min(10, targetSkill));
            skills = {
              shooting: p.shooting ?? clampedSkill,
              passing: p.passing ?? clampedSkill,
              ball_control: p.ball_control ?? clampedSkill,
              playmaking: p.playmaking ?? clampedSkill,
              defending: p.defending ?? clampedSkill,
              fitness: p.fitness ?? clampedSkill,
            };
          } else {
            skills = {
              shooting: p.shooting ?? 5,
              passing: p.passing ?? 5,
              ball_control: p.ball_control ?? 5,
              playmaking: p.playmaking ?? 5,
              defending: p.defending ?? 5,
              fitness: p.fitness ?? 5,
            };
          }

          // Note: overall_score is GENERATED - don't include it!
          return {
            name: p.name,
            status: p.status || "regular",
            preferred_position: p.preferred_position || "everywhere",
            ...skills,
            is_linchpin: p.is_linchpin || false,
            aliases: [],
            notes: p.notes || null,
          };
        });

        const { data, error } = await supabase
          .from("players")
          .insert(formattedPlayers)
          .select();

        if (error) throw error;

        return {
          success: true,
          data: {
            message: `Added ${data?.length || 0} players`,
            players: data?.map(p => p.name)
          }
        };
      }

      case "search_players": {
        const query = args.query as string;
        if (!query) {
          return { success: false, error: "Search query is required" };
        }

        // Search in name and aliases
        const { data, error } = await supabase
          .from("players")
          .select("*")
          .or(`name.ilike.%${query}%,aliases.cs.{${query}}`);

        if (error) throw error;

        return {
          success: true,
          data: {
            players: data,
            count: data?.length || 0,
            query
          }
        };
      }

      default:
        return { success: false, error: `Unknown function: ${name}` };
    }
  } catch (err) {
    console.error(`Error executing ${name}:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error"
    };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment variables not configured");
    }

    // Create Supabase client with service role for full access
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: "soccer" }
    });

    const { message, conversationHistory } = await req.json();

    if (!message) {
      throw new Error("Message is required");
    }

    console.log("AI Command received:", message);

    // Build conversation contents
    const contents = [
      ...(conversationHistory || []),
      { role: "user", parts: [{ text: message }] }
    ];

    // Call Gemini with function calling
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    let finalResponse = "";
    let iterations = 0;
    const maxIterations = 5; // Prevent infinite loops

    while (iterations < maxIterations) {
      iterations++;
      console.log(`Gemini iteration ${iterations}`);

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          tools,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          }
        })
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error("Gemini API error:", errorText);
        throw new Error(`Gemini API error: ${geminiResponse.status}`);
      }

      const geminiData = await geminiResponse.json();
      console.log("Gemini response:", JSON.stringify(geminiData, null, 2));

      const candidate = geminiData.candidates?.[0];
      if (!candidate?.content?.parts) {
        throw new Error("Invalid response from Gemini");
      }

      const parts = candidate.content.parts;

      // Check for function calls
      const functionCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall);

      if (functionCalls.length === 0) {
        // No function calls, get the text response
        const textPart = parts.find((p: { text?: string }) => p.text);
        finalResponse = textPart?.text || "I couldn't process that request.";
        break;
      }

      // Execute function calls
      const functionResponses = [];

      for (const part of functionCalls) {
        const fc = part.functionCall;
        console.log("Executing function call:", fc.name, fc.args);

        const result = await executeFunction(supabase, {
          name: fc.name,
          args: fc.args || {}
        });

        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: result
          }
        });
      }

      // Add the model's response and function results to the conversation
      contents.push({
        role: "model",
        parts: parts
      });

      contents.push({
        role: "user",
        parts: functionResponses
      });
    }

    return new Response(
      JSON.stringify({
        response: finalResponse,
        success: true
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("AI Command error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        success: false
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
