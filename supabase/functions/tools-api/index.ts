// @ts-nocheck - Deno runtime, types handled by Supabase Edge Functions
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Tools API Edge Function
 *
 * THE SINGLE SOURCE OF TRUTH for all player database operations.
 *
 * All clients call this API:
 * - MCP Server (Claude Desktop, Claude Code)
 * - Web App (via ai-command function)
 * - WhatsApp (future)
 * - Any other integration
 *
 * Update this function once → Updates everywhere instantly.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================================
// Types
// ============================================================================

type PlayerStatus = 'regular' | 'newbie' | 'inactive';
type PreferredPosition = 'attacking' | 'midfield' | 'defensive' | 'everywhere';

interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  preferred_position: PreferredPosition;
  shooting: number;
  passing: number;
  ball_control: number;
  playmaking: number;
  defending: number;
  fitness: number;
  overall_score: number;
  is_linchpin: boolean;
  aliases: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function deriveSkillsFromOverall(overallScore: number): Record<string, number> {
  const targetSkill = Math.round(overallScore / 10);
  const clampedSkill = Math.max(1, Math.min(10, targetSkill));
  return {
    shooting: clampedSkill,
    passing: clampedSkill,
    ball_control: clampedSkill,
    playmaking: clampedSkill,
    defending: clampedSkill,
    fitness: clampedSkill,
  };
}

function defaultSkills(): Record<string, number> {
  return {
    shooting: 5,
    passing: 5,
    ball_control: 5,
    playmaking: 5,
    defending: 5,
    fitness: 5,
  };
}

// ============================================================================
// Tool Handlers
// ============================================================================

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function listPlayers(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    let query = supabase.from('players').select('*');

    if (args.status && args.status !== 'all') {
      query = query.eq('status', args.status);
    }
    if (args.position && args.position !== 'all') {
      query = query.eq('preferred_position', args.position);
    }
    if (args.search) {
      query = query.ilike('name', `%${args.search}%`);
    }

    const sortBy = (args.sortBy as string) || 'name';
    const sortOrder = args.sortOrder === 'desc' ? false : true;
    query = query.order(sortBy, { ascending: sortOrder });

    if (args.limit) {
      query = query.limit(args.limit as number);
    }

    const { data, error } = await query;
    if (error) throw error;

    return { success: true, data: { players: data, count: data.length } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function getPlayer(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    let query = supabase.from('players').select('*');

    if (args.id) {
      query = query.eq('id', args.id);
    } else if (args.name) {
      query = query.ilike('name', `%${args.name}%`);
    } else {
      return { success: false, error: 'Must provide name or id' };
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return { success: false, error: `Player not found: ${args.name || args.id}` };
    }

    if (data.length === 1) {
      return { success: true, data: { player: data[0] } };
    }

    return { success: true, data: { players: data, message: `Found ${data.length} matching players` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============================================================================
// TWO-PHASE PLAYER ADDITION (Prevents Claude from inventing values)
// ============================================================================

async function startAddPlayer(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  // This tool ONLY takes the name and returns skill questions
  // It has NO skill parameters, so Claude CANNOT invent them
  if (!args.name) {
    return { success: false, error: 'Player name is required' };
  }

  // Check if player already exists
  const { data: existing } = await supabase
    .from('players')
    .select('id, name')
    .ilike('name', args.name as string)
    .limit(1);

  if (existing && existing.length > 0) {
    return { success: false, error: `Player "${existing[0].name}" already exists` };
  }

  // Return the skill form - Claude must display this and wait for user input
  return {
    success: true,
    data: {
      action: 'collect_player_info',
      player_name: args.name,
      message: `To add ${args.name}, I need:

**Skills (1-10 each):**
Shooting, Passing, Ball Control, Playmaking, Defending, Fitness
→ Reply with 6 numbers like: 8,7,6,8,7,9

**Position:** attacking / midfield / defensive / everywhere

**Linchpin?** yes or no (key players who should be split across teams)

Example response: "8,7,6,8,7,9 midfield yes"`,
      next_step: 'After user provides info, call complete_add_player with name, all 6 skills, preferred_position, and is_linchpin.'
    }
  };
}

async function completeAddPlayer(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  // This tool REQUIRES all skills - they are not optional
  // Claude must have gotten these values from the user

  if (!args.name) {
    return { success: false, error: 'Player name is required' };
  }

  // Validate all required skills are present
  const requiredSkills = ['shooting', 'passing', 'ball_control', 'playmaking', 'defending', 'fitness'];
  for (const skill of requiredSkills) {
    if (args[skill] === undefined || args[skill] === null) {
      return {
        success: false,
        error: `Missing required skill: ${skill}. All 6 skills must be provided by the user.`
      };
    }
    const value = args[skill] as number;
    if (value < 1 || value > 10) {
      return { success: false, error: `${skill} must be between 1 and 10` };
    }
  }

  // Check if player already exists
  const { data: existing } = await supabase
    .from('players')
    .select('id, name')
    .ilike('name', args.name as string)
    .limit(1);

  if (existing && existing.length > 0) {
    return { success: false, error: `Player "${existing[0].name}" already exists` };
  }

  const newPlayer = {
    name: args.name,
    status: (args.status as string) || 'regular',
    preferred_position: (args.preferred_position as string) || 'everywhere',
    shooting: args.shooting as number,
    passing: args.passing as number,
    ball_control: args.ball_control as number,
    playmaking: args.playmaking as number,
    defending: args.defending as number,
    fitness: args.fitness as number,
    is_linchpin: (args.is_linchpin as boolean) || false,
    aliases: (args.aliases as string[]) || [],
    notes: (args.notes as string) || null,
  };

  const { data, error } = await supabase
    .from('players')
    .insert(newPlayer)
    .select()
    .single();

  if (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message: unknown }).message)
        : 'Unknown error';
    return { success: false, error: errorMessage };
  }

  return {
    success: true,
    data: {
      message: `Added ${data.name} with skills: Shooting ${data.shooting}, Passing ${data.passing}, Ball Control ${data.ball_control}, Playmaking ${data.playmaking}, Defending ${data.defending}, Fitness ${data.fitness}`,
      player: data
    }
  };
}

// Legacy add_player - kept for backward compatibility but will ask for skills
async function addPlayer(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    if (!args.name) {
      return { success: false, error: 'Player name is required' };
    }

    const skillFields = ['shooting', 'passing', 'ball_control', 'playmaking', 'defending', 'fitness'];
    const hasAnySkills = skillFields.some(field => args[field] !== undefined && args[field] !== null);
    const hasOverallScore = args.overall_score !== undefined && args.overall_score !== null;

    // Check if this is a confirmation call with a pending player ID
    // We store pending players in the database with status 'pending_confirmation'
    const isConfirmed = args.pending_player_id !== undefined;

    // STEP 1: If no skills and no overall_score, ask for skills directly
    if (!hasAnySkills && !hasOverallScore) {
      return {
        success: false,
        error: `ASK USER FOR SKILLS - Display this exactly:

"Rate ${args.name}'s skills (1-10 each):
• Shooting, Passing, Ball Control, Playmaking, Defending, Fitness

Reply with 6 numbers like: 8,7,6,8,7,9
Or just one number (e.g., '7') to set all skills the same."

When user replies, call add_player with name="${args.name}" and the individual skill values (shooting, passing, ball_control, playmaking, defending, fitness).`
      };
    }

    // STEP 2: If overall_score OR individual skills provided, add directly
    const { data: existing } = await supabase
      .from('players')
      .select('id, name')
      .ilike('name', args.name as string)
      .limit(1);

    if (existing && existing.length > 0) {
      return { success: false, error: `Player "${existing[0].name}" already exists` };
    }

    let skills: Record<string, number>;
    if (hasOverallScore) {
      const derivedSkills = deriveSkillsFromOverall(args.overall_score as number);
      skills = {
        shooting: (args.shooting as number) ?? derivedSkills.shooting,
        passing: (args.passing as number) ?? derivedSkills.passing,
        ball_control: (args.ball_control as number) ?? derivedSkills.ball_control,
        playmaking: (args.playmaking as number) ?? derivedSkills.playmaking,
        defending: (args.defending as number) ?? derivedSkills.defending,
        fitness: (args.fitness as number) ?? derivedSkills.fitness,
      };
    } else {
      const defaults = defaultSkills();
      skills = {
        shooting: (args.shooting as number) ?? defaults.shooting,
        passing: (args.passing as number) ?? defaults.passing,
        ball_control: (args.ball_control as number) ?? defaults.ball_control,
        playmaking: (args.playmaking as number) ?? defaults.playmaking,
        defending: (args.defending as number) ?? defaults.defending,
        fitness: (args.fitness as number) ?? defaults.fitness,
      };
    }

    const newPlayer = {
      name: args.name,
      status: args.status || 'regular',
      preferred_position: args.preferred_position || 'everywhere',
      ...skills,
      is_linchpin: args.is_linchpin || false,
      aliases: args.aliases || [],
      notes: args.notes || null,
    };

    const { data, error } = await supabase
      .from('players')
      .insert(newPlayer)
      .select()
      .single();

    if (error) throw error;

    return { success: true, data: { message: `Added player: ${data.name}`, player: data } };
  } catch (err) {
    const errorMessage = err instanceof Error
      ? err.message
      : (err && typeof err === 'object' && 'message' in err)
        ? String((err as { message: unknown }).message)
        : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

async function updatePlayer(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    let findQuery = supabase.from('players').select('*');

    if (args.id) {
      findQuery = findQuery.eq('id', args.id);
    } else if (args.name) {
      findQuery = findQuery.ilike('name', `%${args.name}%`);
    } else {
      return { success: false, error: 'Must provide name or id to find player' };
    }

    const { data: players, error: findError } = await findQuery;
    if (findError) throw findError;

    if (!players || players.length === 0) {
      return { success: false, error: `Player not found: ${args.name || args.id}` };
    }

    if (players.length > 1) {
      return {
        success: false,
        error: `Found ${players.length} players matching "${args.name}". Please be more specific.`,
        data: { matches: players.map((p: Player) => ({ id: p.id, name: p.name })) }
      };
    }

    const player = players[0];
    const updates: Record<string, unknown> = {};

    if (args.new_name) updates.name = args.new_name;
    if (args.status) updates.status = args.status;
    if (args.preferred_position) updates.preferred_position = args.preferred_position;
    if (args.shooting !== undefined) updates.shooting = args.shooting;
    if (args.passing !== undefined) updates.passing = args.passing;
    if (args.ball_control !== undefined) updates.ball_control = args.ball_control;
    if (args.playmaking !== undefined) updates.playmaking = args.playmaking;
    if (args.defending !== undefined) updates.defending = args.defending;
    if (args.fitness !== undefined) updates.fitness = args.fitness;
    if (args.is_linchpin !== undefined) updates.is_linchpin = args.is_linchpin;
    if (args.aliases !== undefined) updates.aliases = args.aliases;
    if (args.notes !== undefined) updates.notes = args.notes;

    if (args.overall_score !== undefined) {
      const derivedSkills = deriveSkillsFromOverall(args.overall_score as number);
      updates.shooting = args.shooting ?? derivedSkills.shooting;
      updates.passing = args.passing ?? derivedSkills.passing;
      updates.ball_control = args.ball_control ?? derivedSkills.ball_control;
      updates.playmaking = args.playmaking ?? derivedSkills.playmaking;
      updates.defending = args.defending ?? derivedSkills.defending;
      updates.fitness = args.fitness ?? derivedSkills.fitness;
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    const { data, error } = await supabase
      .from('players')
      .update(updates)
      .eq('id', player.id)
      .select()
      .single();

    if (error) throw error;

    return { success: true, data: { message: `Updated player: ${data.name}`, player: data } };
  } catch (err) {
    const errorMessage = err instanceof Error
      ? err.message
      : (err && typeof err === 'object' && 'message' in err)
        ? String((err as { message: unknown }).message)
        : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

async function deletePlayer(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    let findQuery = supabase.from('players').select('*');

    if (args.id) {
      findQuery = findQuery.eq('id', args.id);
    } else if (args.name) {
      findQuery = findQuery.ilike('name', `%${args.name}%`);
    } else {
      return { success: false, error: 'Must provide name or id to find player' };
    }

    const { data: players, error: findError } = await findQuery;
    if (findError) throw findError;

    if (!players || players.length === 0) {
      return { success: false, error: `Player not found: ${args.name || args.id}` };
    }

    if (players.length > 1) {
      return {
        success: false,
        error: `Found ${players.length} players matching "${args.name}". Please be more specific or use the player ID.`,
        data: { matches: players.map((p: Player) => ({ id: p.id, name: p.name })) }
      };
    }

    const player = players[0];

    if (!args.confirm) {
      return {
        success: true,
        data: {
          requires_confirmation: true,
          player: { id: player.id, name: player.name },
          message: `Are you sure you want to delete ${player.name}? Call delete_player again with confirm: true to proceed.`
        }
      };
    }

    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', player.id);

    if (error) throw error;

    return { success: true, data: { message: `Deleted player: ${player.name}` } };
  } catch (err) {
    const errorMessage = err instanceof Error
      ? err.message
      : (err && typeof err === 'object' && 'message' in err)
        ? String((err as { message: unknown }).message)
        : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

async function getStats(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const statsType = (args.type as string) || 'overview';

    if (statsType === 'overview') {
      const { data: players, error } = await supabase.from('players').select('*');
      if (error) throw error;

      const total = players.length;
      const active = players.filter((p: Player) => p.status === 'regular').length;
      const newbies = players.filter((p: Player) => p.status === 'newbie').length;
      const inactive = players.filter((p: Player) => p.status === 'inactive').length;
      const avgScore = total > 0
        ? Math.round(players.reduce((sum: number, p: Player) => sum + p.overall_score, 0) / total)
        : 0;
      const linchpins = players.filter((p: Player) => p.is_linchpin).length;

      return {
        success: true,
        data: {
          overview: {
            total_players: total,
            active_players: active,
            newbies: newbies,
            inactive_players: inactive,
            average_overall_score: avgScore,
            linchpin_players: linchpins
          }
        }
      };
    }

    if (statsType === 'top_players') {
      const limit = (args.limit as number) || 5;
      const { data: players, error } = await supabase
        .from('players')
        .select('*')
        .eq('status', 'regular')
        .order('overall_score', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return {
        success: true,
        data: {
          top_players: players.map((p: Player) => ({
            name: p.name,
            overall_score: p.overall_score,
            position: p.preferred_position
          }))
        }
      };
    }

    if (statsType === 'position_breakdown') {
      const { data: players, error } = await supabase
        .from('players')
        .select('preferred_position')
        .eq('status', 'regular');

      if (error) throw error;

      const breakdown: Record<string, number> = {};
      players.forEach((p: { preferred_position: string }) => {
        breakdown[p.preferred_position] = (breakdown[p.preferred_position] || 0) + 1;
      });

      return { success: true, data: { position_breakdown: breakdown } };
    }

    return { success: false, error: `Unknown stats type: ${statsType}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function bulkAddPlayers(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const players = args.players as Array<{ name: string; overall_score?: number }>;
    if (!players || !Array.isArray(players) || players.length === 0) {
      return { success: false, error: 'Players array is required' };
    }

    const results = { added: [] as string[], failed: [] as { name: string; error: string }[] };

    for (const playerData of players) {
      if (!playerData.name) {
        results.failed.push({ name: 'unknown', error: 'Name is required' });
        continue;
      }

      const { data: existing } = await supabase
        .from('players')
        .select('id')
        .ilike('name', playerData.name)
        .limit(1);

      if (existing && existing.length > 0) {
        results.failed.push({ name: playerData.name, error: 'Already exists' });
        continue;
      }

      const skills = playerData.overall_score
        ? deriveSkillsFromOverall(playerData.overall_score)
        : defaultSkills();

      const { error } = await supabase
        .from('players')
        .insert({
          name: playerData.name,
          status: 'regular',
          preferred_position: 'everywhere',
          ...skills,
          is_linchpin: false,
          aliases: [],
          notes: null,
        });

      if (error) {
        results.failed.push({ name: playerData.name, error: error.message });
      } else {
        results.added.push(playerData.name);
      }
    }

    return {
      success: true,
      data: {
        message: `Added ${results.added.length} players, ${results.failed.length} failed`,
        added: results.added,
        failed: results.failed
      }
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function searchPlayers(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const query = args.query as string;
    if (!query) {
      return { success: false, error: 'Search query is required' };
    }

    const { data: players, error } = await supabase
      .from('players')
      .select('*')
      .or(`name.ilike.%${query}%,aliases.cs.{${query}}`);

    if (error) throw error;

    return {
      success: true,
      data: {
        players,
        count: players.length,
        message: players.length > 0
          ? `Found ${players.length} player(s) matching "${query}"`
          : `No players found matching "${query}"`
      }
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============================================================================
// Tool Definitions (for clients that need schemas)
// ============================================================================

const toolSchemas = [
  {
    name: 'list_players',
    description: 'List all players with optional filtering and sorting',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'regular', 'newbie', 'inactive'] },
        position: { type: 'string', enum: ['all', 'attacking', 'midfield', 'defensive', 'everywhere'] },
        search: { type: 'string', description: 'Search by name' },
        limit: { type: 'number', description: 'Max results' },
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
    name: 'start_add_player',
    description: 'Start adding a new player. Returns skill questions to ask the user. Use this first, then complete_add_player after user provides skills.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Player name' }
      },
      required: ['name']
    }
  },
  {
    name: 'complete_add_player',
    description: 'Complete adding a player after user provides skill ratings. ALL skills are REQUIRED.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Player name' },
        shooting: { type: 'number', description: 'Shooting skill 1-10 (REQUIRED from user)' },
        passing: { type: 'number', description: 'Passing skill 1-10 (REQUIRED from user)' },
        ball_control: { type: 'number', description: 'Ball control 1-10 (REQUIRED from user)' },
        playmaking: { type: 'number', description: 'Playmaking 1-10 (REQUIRED from user)' },
        defending: { type: 'number', description: 'Defending 1-10 (REQUIRED from user)' },
        fitness: { type: 'number', description: 'Fitness 1-10 (REQUIRED from user)' },
        status: { type: 'string', enum: ['regular', 'newbie', 'inactive'] },
        preferred_position: { type: 'string', enum: ['attacking', 'midfield', 'defensive', 'everywhere'], description: 'Position (REQUIRED from user)' },
        is_linchpin: { type: 'boolean', description: 'Is this a key player who should be split across teams? (REQUIRED from user)' }
      },
      required: ['name', 'shooting', 'passing', 'ball_control', 'playmaking', 'defending', 'fitness', 'preferred_position', 'is_linchpin']
    }
  },
  {
    name: 'add_player',
    description: 'Add a new player. Prompts for skill info if not provided.',
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
        confirm: { type: 'boolean', description: 'Set true to confirm deletion' }
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
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  }
];

// ============================================================================
// Request Handler
// ============================================================================

type ToolName = 'list_players' | 'get_player' | 'start_add_player' | 'complete_add_player' |
                'add_player' | 'update_player' | 'delete_player' | 'get_stats' |
                'bulk_add_players' | 'search_players';

const handlers: Record<ToolName, (supabase: SupabaseClient, args: Record<string, unknown>) => Promise<ToolResult>> = {
  list_players: listPlayers,
  get_player: getPlayer,
  start_add_player: startAddPlayer,
  complete_add_player: completeAddPlayer,
  add_player: addPlayer,  // Legacy, kept for backward compatibility
  update_player: updatePlayer,
  delete_player: deletePlayer,
  get_stats: getStats,
  bulk_add_players: bulkAddPlayers,
  search_players: searchPlayers,
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment variables not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: "soccer" }
    });

    const body = await req.json();

    // Support two modes:
    // 1. Get schemas: { action: "get_schemas" }
    // 2. Execute tool: { tool: "add_player", args: {...} }

    if (body.action === "get_schemas") {
      return new Response(
        JSON.stringify({ success: true, schemas: toolSchemas }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { tool, args } = body;

    if (!tool) {
      throw new Error("Tool name is required. Use { tool: 'tool_name', args: {...} }");
    }

    if (!(tool in handlers)) {
      throw new Error(`Unknown tool: ${tool}. Available: ${Object.keys(handlers).join(', ')}`);
    }

    console.log(`Executing tool: ${tool}`, args);

    const result = await handlers[tool as ToolName](supabase, args || {});

    console.log(`Tool result:`, result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Tools API error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
