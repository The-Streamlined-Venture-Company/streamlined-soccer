/**
 * Database handlers for the Unified AI Command System
 *
 * THE SINGLE SOURCE OF TRUTH for all player database operations.
 * Used by: Edge Function, MCP Server, WhatsApp (future), and any MCP-compatible client.
 *
 * Fix a bug here → Fixed everywhere instantly.
 */

import type {
  Player,
  ToolResult,
  ListPlayersArgs,
  ListPlayersResult,
  GetPlayerArgs,
  GetPlayerResult,
  AddPlayerArgs,
  AddPlayerResult,
  UpdatePlayerArgs,
  UpdatePlayerResult,
  DeletePlayerArgs,
  DeletePlayerResult,
  GetStatsArgs,
  StatsResult,
  OverviewStats,
  TopPlayersStats,
  PositionBreakdownStats,
  StatusBreakdownStats,
  BulkAddPlayersArgs,
  BulkAddPlayersResult,
  SearchPlayersArgs,
  SearchPlayersResult,
} from './types.ts';

// ============================================================================
// Supabase Client Type (generic to work with both Node.js and Deno versions)
// ============================================================================

// Using a generic type to accept any Supabase client
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Derive skill values from an overall score (0-100)
 * Since overall_score is a generated column: average of skills * 10
 */
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

/**
 * Default skill values for new players
 */
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
// Handler Functions
// ============================================================================

/**
 * List players with optional filtering and sorting
 */
export async function listPlayers(
  supabase: SupabaseClient,
  args: ListPlayersArgs
): Promise<ToolResult<ListPlayersResult>> {
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

    const sortBy = args.sortBy || 'overall_score';
    const sortOrder = args.sortOrder === 'asc';
    query = query.order(sortBy, { ascending: sortOrder });

    const limit = args.limit || 20;
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;

    return {
      success: true,
      data: { players: data as Player[], count: data?.length || 0 }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Get a specific player by name or ID
 */
export async function getPlayer(
  supabase: SupabaseClient,
  args: GetPlayerArgs
): Promise<ToolResult<GetPlayerResult>> {
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
      return { success: false, error: 'Player not found' };
    }

    return {
      success: true,
      data: { player: data.length === 1 ? data[0] : data }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Add a new player to the database
 */
export async function addPlayer(
  supabase: SupabaseClient,
  args: AddPlayerArgs
): Promise<ToolResult<AddPlayerResult>> {
  try {
    if (!args.name) {
      return { success: false, error: 'Player name is required' };
    }

    // Check if any individual skills were provided
    const skillFields = ['shooting', 'passing', 'ball_control', 'playmaking', 'defending', 'fitness'] as const;
    const hasAnySkills = skillFields.some(field => args[field] !== undefined && args[field] !== null);
    const hasOverallScore = args.overall_score !== undefined && args.overall_score !== null;
    const isConfirmed = args.confirm_skills === true;

    // STEP 1: If no skills and no overall_score provided, ask for overall score first
    if (!hasAnySkills && !hasOverallScore) {
      return {
        success: true,
        data: {
          needs_skill_info: true,
          step: 'get_overall_score',
          player_name: args.name,
          message: `To add ${args.name}, please provide an overall skill rating (1-100). For example: "75" for a good player, "50" for average, "85" for excellent.`,
          instruction: 'Ask the user for an overall score (1-100), then call add_player again with name and overall_score.'
        } as AddPlayerResult
      };
    }

    // STEP 2: If overall_score provided but not confirmed, derive skills and offer to customize
    if (hasOverallScore && !isConfirmed) {
      const derivedSkills = deriveSkillsFromOverall(args.overall_score!);

      // Apply any overrides the user already specified
      const finalSkills = {
        shooting: args.shooting ?? derivedSkills.shooting,
        passing: args.passing ?? derivedSkills.passing,
        ball_control: args.ball_control ?? derivedSkills.ball_control,
        playmaking: args.playmaking ?? derivedSkills.playmaking,
        defending: args.defending ?? derivedSkills.defending,
        fitness: args.fitness ?? derivedSkills.fitness,
      };

      return {
        success: true,
        data: {
          needs_confirmation: true,
          step: 'confirm_or_customize',
          player_name: args.name,
          overall_score: args.overall_score,
          derived_skills: finalSkills,
          message: `Based on overall score ${args.overall_score}, here are the derived skills for ${args.name}:`,
          skills_display: [
            { name: 'Shooting', value: finalSkills.shooting, key: 'shooting' },
            { name: 'Passing', value: finalSkills.passing, key: 'passing' },
            { name: 'Ball Control', value: finalSkills.ball_control, key: 'ball_control' },
            { name: 'Playmaking', value: finalSkills.playmaking, key: 'playmaking' },
            { name: 'Defending', value: finalSkills.defending, key: 'defending' },
            { name: 'Fitness', value: finalSkills.fitness, key: 'fitness' }
          ],
          instruction: 'Show the user these skills and ask if they want to adjust any. If they confirm, call add_player again with confirm_skills: true. If they want to adjust, include the specific skill overrides (e.g., shooting: 8) along with confirm_skills: true.'
        } as AddPlayerResult
      };
    }

    // STEP 3: Confirmed - proceed with insertion
    // Check if player already exists
    const { data: existing } = await supabase
      .from('players')
      .select('id, name')
      .ilike('name', args.name)
      .limit(1);

    if (existing && existing.length > 0) {
      return {
        success: false,
        error: `Player "${existing[0].name}" already exists`
      };
    }

    // If overall_score is provided, derive skill values from it
    // overall_score is a generated column = (sum of skills / 6) * 10
    let skills: Record<string, number>;

    if (hasOverallScore) {
      const derivedSkills = deriveSkillsFromOverall(args.overall_score!);
      skills = {
        shooting: args.shooting ?? derivedSkills.shooting,
        passing: args.passing ?? derivedSkills.passing,
        ball_control: args.ball_control ?? derivedSkills.ball_control,
        playmaking: args.playmaking ?? derivedSkills.playmaking,
        defending: args.defending ?? derivedSkills.defending,
        fitness: args.fitness ?? derivedSkills.fitness,
      };
    } else {
      const defaults = defaultSkills();
      skills = {
        shooting: args.shooting ?? defaults.shooting,
        passing: args.passing ?? defaults.passing,
        ball_control: args.ball_control ?? defaults.ball_control,
        playmaking: args.playmaking ?? defaults.playmaking,
        defending: args.defending ?? defaults.defending,
        fitness: args.fitness ?? defaults.fitness,
      };
    }

    // Note: overall_score is a GENERATED column - don't include it in insert!
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

    return {
      success: true,
      data: { message: `Added player: ${data.name}`, player: data }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Update an existing player
 */
export async function updatePlayer(
  supabase: SupabaseClient,
  args: UpdatePlayerArgs
): Promise<ToolResult<UpdatePlayerResult>> {
  try {
    // Find the player first
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
        error: `Multiple players match "${args.name}". Please be more specific.`,
        data: { matches: players.map((p: Player) => p.name) } as unknown as UpdatePlayerResult
      };
    }

    const player = players[0];

    // Build update object (only include fields that were provided)
    const updates: Record<string, unknown> = {};
    if (args.new_name) updates.name = args.new_name;
    if (args.status) updates.status = args.status;
    if (args.preferred_position) updates.preferred_position = args.preferred_position;
    if (typeof args.shooting === 'number') updates.shooting = args.shooting;
    if (typeof args.passing === 'number') updates.passing = args.passing;
    if (typeof args.ball_control === 'number') updates.ball_control = args.ball_control;
    if (typeof args.playmaking === 'number') updates.playmaking = args.playmaking;
    if (typeof args.defending === 'number') updates.defending = args.defending;
    if (typeof args.fitness === 'number') updates.fitness = args.fitness;
    if (typeof args.is_linchpin === 'boolean') updates.is_linchpin = args.is_linchpin;
    if (args.aliases) updates.aliases = args.aliases;
    if (args.notes !== undefined) updates.notes = args.notes;

    // If user wants to set overall_score directly, convert to skill values
    // (overall_score is a generated column, can't be set directly)
    if (typeof args.overall_score === 'number') {
      const derivedSkills = deriveSkillsFromOverall(args.overall_score);
      // Only set skills that weren't explicitly provided
      if (typeof args.shooting !== 'number') updates.shooting = derivedSkills.shooting;
      if (typeof args.passing !== 'number') updates.passing = derivedSkills.passing;
      if (typeof args.ball_control !== 'number') updates.ball_control = derivedSkills.ball_control;
      if (typeof args.playmaking !== 'number') updates.playmaking = derivedSkills.playmaking;
      if (typeof args.defending !== 'number') updates.defending = derivedSkills.defending;
      if (typeof args.fitness !== 'number') updates.fitness = derivedSkills.fitness;
    }

    updates.updated_at = new Date().toISOString();

    if (Object.keys(updates).length === 1) { // Only updated_at
      return { success: false, error: 'No updates provided' };
    }

    const { data, error } = await supabase
      .from('players')
      .update(updates)
      .eq('id', player.id)
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      data: { message: `Updated ${player.name}`, player: data, changes: updates }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Delete a player from the database
 */
export async function deletePlayer(
  supabase: SupabaseClient,
  args: DeletePlayerArgs
): Promise<ToolResult<DeletePlayerResult>> {
  try {
    if (!args.confirm) {
      return {
        success: false,
        error: 'Deletion requires confirmation. Please confirm you want to delete this player.'
      };
    }

    // Find the player first
    let findQuery = supabase.from('players').select('id, name');

    if (args.id) {
      findQuery = findQuery.eq('id', args.id);
    } else if (args.name) {
      findQuery = findQuery.ilike('name', `%${args.name}%`);
    } else {
      return { success: false, error: 'Must provide name or id' };
    }

    const { data: players, error: findError } = await findQuery;
    if (findError) throw findError;

    if (!players || players.length === 0) {
      return { success: false, error: 'Player not found' };
    }

    if (players.length > 1) {
      return {
        success: false,
        error: `Multiple players match. Please be more specific.`,
        data: { matches: players.map((p: Player) => p.name) } as unknown as DeletePlayerResult
      };
    }

    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', players[0].id);

    if (error) throw error;

    return {
      success: true,
      data: { message: `Deleted player: ${players[0].name}` }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Get database statistics
 */
export async function getStats(
  supabase: SupabaseClient,
  args: GetStatsArgs
): Promise<ToolResult<StatsResult>> {
  try {
    const statsType = args.type || 'overview';

    if (statsType === 'overview') {
      const { data: players, error } = await supabase
        .from('players')
        .select('status, preferred_position, overall_score');

      if (error) throw error;

      const total = players?.length || 0;
      const avgScore = total > 0
        ? Math.round(players!.reduce((sum: number, p: Player) => sum + (p.overall_score || 0), 0) / total)
        : 0;
      const byStatus = players?.reduce((acc: Record<string, number>, p: Player) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        success: true,
        data: {
          totalPlayers: total,
          averageScore: avgScore,
          byStatus
        } as OverviewStats
      };
    }

    if (statsType === 'top_players') {
      const limit = args.limit || 10;
      const { data, error } = await supabase
        .from('players')
        .select('name, overall_score, preferred_position')
        .order('overall_score', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { success: true, data: { topPlayers: data } as TopPlayersStats };
    }

    if (statsType === 'position_breakdown') {
      const { data, error } = await supabase
        .from('players')
        .select('preferred_position');

      if (error) throw error;

      const breakdown = data?.reduce((acc: Record<string, number>, p: Player) => {
        acc[p.preferred_position] = (acc[p.preferred_position] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return { success: true, data: { positionBreakdown: breakdown } as PositionBreakdownStats };
    }

    if (statsType === 'status_breakdown') {
      const { data, error } = await supabase
        .from('players')
        .select('status');

      if (error) throw error;

      const breakdown = data?.reduce((acc: Record<string, number>, p: Player) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return { success: true, data: { statusBreakdown: breakdown } as StatusBreakdownStats };
    }

    return { success: false, error: 'Unknown stats type' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Add multiple players at once
 */
export async function bulkAddPlayers(
  supabase: SupabaseClient,
  args: BulkAddPlayersArgs
): Promise<ToolResult<BulkAddPlayersResult>> {
  try {
    const playersToAdd = args.players;

    if (!playersToAdd || playersToAdd.length === 0) {
      return { success: false, error: 'No players provided' };
    }

    const formattedPlayers = playersToAdd.map(p => {
      // If overall_score provided, derive skills from it
      let skills: Record<string, number>;
      if (p.overall_score !== undefined && p.overall_score !== null) {
        const derivedSkills = deriveSkillsFromOverall(p.overall_score);
        skills = {
          shooting: p.shooting ?? derivedSkills.shooting,
          passing: p.passing ?? derivedSkills.passing,
          ball_control: p.ball_control ?? derivedSkills.ball_control,
          playmaking: p.playmaking ?? derivedSkills.playmaking,
          defending: p.defending ?? derivedSkills.defending,
          fitness: p.fitness ?? derivedSkills.fitness,
        };
      } else {
        const defaults = defaultSkills();
        skills = {
          shooting: p.shooting ?? defaults.shooting,
          passing: p.passing ?? defaults.passing,
          ball_control: p.ball_control ?? defaults.ball_control,
          playmaking: p.playmaking ?? defaults.playmaking,
          defending: p.defending ?? defaults.defending,
          fitness: p.fitness ?? defaults.fitness,
        };
      }

      // Note: overall_score is GENERATED - don't include it!
      return {
        name: p.name,
        status: p.status || 'regular',
        preferred_position: p.preferred_position || 'everywhere',
        ...skills,
        is_linchpin: p.is_linchpin || false,
        aliases: p.aliases || [],
        notes: p.notes || null,
      };
    });

    const { data, error } = await supabase
      .from('players')
      .insert(formattedPlayers)
      .select();

    if (error) throw error;

    return {
      success: true,
      data: {
        message: `Added ${data?.length || 0} players`,
        players: data?.map((p: Player) => p.name) || []
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Search for players by name or aliases
 */
export async function searchPlayers(
  supabase: SupabaseClient,
  args: SearchPlayersArgs
): Promise<ToolResult<SearchPlayersResult>> {
  try {
    const query = args.query;
    if (!query) {
      return { success: false, error: 'Search query is required' };
    }

    // Search in name and aliases
    const { data, error } = await supabase
      .from('players')
      .select('*')
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
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

// ============================================================================
// Handler Dispatcher
// ============================================================================

export type ToolName =
  | 'list_players'
  | 'get_player'
  | 'add_player'
  | 'update_player'
  | 'delete_player'
  | 'get_stats'
  | 'bulk_add_players'
  | 'search_players';

/**
 * Execute a tool by name with the given arguments
 */
export async function executeHandler(
  supabase: SupabaseClient,
  toolName: ToolName,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case 'list_players':
      return listPlayers(supabase, args as unknown as ListPlayersArgs);
    case 'get_player':
      return getPlayer(supabase, args as unknown as GetPlayerArgs);
    case 'add_player':
      return addPlayer(supabase, args as unknown as AddPlayerArgs);
    case 'update_player':
      return updatePlayer(supabase, args as unknown as UpdatePlayerArgs);
    case 'delete_player':
      return deletePlayer(supabase, args as unknown as DeletePlayerArgs);
    case 'get_stats':
      return getStats(supabase, args as unknown as GetStatsArgs);
    case 'bulk_add_players':
      return bulkAddPlayers(supabase, args as unknown as BulkAddPlayersArgs);
    case 'search_players':
      return searchPlayers(supabase, args as unknown as SearchPlayersArgs);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}
