// @ts-nocheck - Deno runtime, types handled by Supabase Edge Functions
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * AI Command Edge Function
 *
 * Uses Gemini for natural language processing and calls the central Tools API
 * for all database operations.
 *
 * Update tools-api once → Updates here AND in MCP server instantly.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
- Skills (1-10 scale): shooting, passing, ball_control, playmaking, defending, fitness
- overall_score: Computed from skills (1-100 scale), but can be directly set
- is_linchpin: Whether the player is a key player who should be on separate teams
- aliases: Alternative names/nicknames for matching
- notes: Any additional information

When users ask to:
- "Add [name]" - Start the add player flow, which will ask for overall score
- "Add [name] [number]" - Add with that number as overall_score (e.g., "Add Mo 75")
- When adding, show derived skills and ask if user wants to adjust any before confirming
- "Update [name]'s rating to X" - Update overall_score directly
- "Make [name] a defender" - Update preferred_position
- "Show all players" - List all players
- "Who are the best players?" - Get top players by overall_score
- "Delete [name]" - Delete player (ask for confirmation)

IMPORTANT: When a user says "Add [name] [number]", always interpret the number as the overall_score parameter.

When the add_player tool returns needs_confirmation or needs_skill_info, follow the instruction to ask the user the appropriate questions before calling the tool again.

Be helpful, concise, and always confirm destructive actions. If a player name is ambiguous, ask for clarification or show matching results.

Format your responses nicely with line breaks and bullet points where appropriate. Keep responses concise but informative.`;

// Tool definitions for Gemini
const geminiTools = [{
  function_declarations: [
    {
      name: 'list_players',
      description: 'List all players with optional filtering and sorting',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['all', 'regular', 'newbie', 'inactive'] },
          position: { type: 'string', enum: ['all', 'attacking', 'midfield', 'defensive', 'everywhere'] },
          search: { type: 'string', description: 'Search by name' },
          limit: { type: 'number' },
          sortBy: { type: 'string', enum: ['name', 'overall_score', 'created_at'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] }
        }
      }
    },
    {
      name: 'get_player',
      description: 'Get player details by name or ID',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          id: { type: 'string' }
        }
      }
    },
    {
      name: 'add_player',
      description: 'Add a new player. Returns skill questions if not all info provided.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Player name (required)' },
          overall_score: { type: 'number', description: 'Overall rating 1-100' },
          shooting: { type: 'number' },
          passing: { type: 'number' },
          ball_control: { type: 'number' },
          playmaking: { type: 'number' },
          defending: { type: 'number' },
          fitness: { type: 'number' },
          status: { type: 'string', enum: ['regular', 'newbie', 'inactive'] },
          preferred_position: { type: 'string', enum: ['attacking', 'midfield', 'defensive', 'everywhere'] },
          is_linchpin: { type: 'boolean' },
          aliases: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          confirm_skills: { type: 'boolean', description: 'Set true to confirm and add' }
        },
        required: ['name']
      }
    },
    {
      name: 'update_player',
      description: 'Update an existing player',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          id: { type: 'string' },
          new_name: { type: 'string' },
          overall_score: { type: 'number' },
          shooting: { type: 'number' },
          passing: { type: 'number' },
          ball_control: { type: 'number' },
          playmaking: { type: 'number' },
          defending: { type: 'number' },
          fitness: { type: 'number' },
          status: { type: 'string', enum: ['regular', 'newbie', 'inactive'] },
          preferred_position: { type: 'string', enum: ['attacking', 'midfield', 'defensive', 'everywhere'] },
          is_linchpin: { type: 'boolean' },
          aliases: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' }
        }
      }
    },
    {
      name: 'delete_player',
      description: 'Delete a player (requires confirmation)',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          id: { type: 'string' },
          confirm: { type: 'boolean' }
        }
      }
    },
    {
      name: 'get_stats',
      description: 'Get database statistics',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['overview', 'top_players', 'position_breakdown'] },
          limit: { type: 'number' }
        }
      }
    },
    {
      name: 'bulk_add_players',
      description: 'Add multiple players at once',
      parameters: {
        type: 'object',
        properties: {
          players: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                overall_score: { type: 'number' }
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
      description: 'Search players by name or alias',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  ]
}];

interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
}

interface GeminiTextPart {
  text: string;
}

type GeminiPart = GeminiFunctionCallPart | GeminiTextPart;

// Call the central Tools API
async function callToolsApi(
  tool: string,
  args: Record<string, unknown>,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<Record<string, unknown>> {
  const toolsApiUrl = `${supabaseUrl}/functions/v1/tools-api`;

  const response = await fetch(toolsApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ tool, args }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Tools API error (${response.status}):`, errorText);
    return { success: false, error: `API error: ${response.status}` };
  }

  return await response.json();
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
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;
      console.log(`Gemini iteration ${iterations}`);

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          tools: geminiTools,
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

      const parts = candidate.content.parts as GeminiPart[];

      // Check for function calls
      const functionCalls = parts.filter(
        (p): p is GeminiFunctionCallPart => 'functionCall' in p
      );

      if (functionCalls.length === 0) {
        // No function calls, get the text response
        const textPart = parts.find((p): p is GeminiTextPart => 'text' in p);
        finalResponse = textPart?.text || "I couldn't process that request.";
        break;
      }

      // Execute function calls via the central Tools API
      const functionResponses = [];

      for (const part of functionCalls) {
        const fc = part.functionCall;
        console.log("Executing function call:", fc.name, fc.args);

        // Call the central Tools API
        const result = await callToolsApi(
          fc.name,
          fc.args || {},
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY
        );

        console.log("Tool result:", result);

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
