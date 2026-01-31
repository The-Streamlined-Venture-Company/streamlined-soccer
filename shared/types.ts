/**
 * Shared types for the Unified AI Command System
 * Used by: Edge Function, MCP Server, WhatsApp (future), and any MCP-compatible client
 */

// ============================================================================
// Player Types
// ============================================================================

export type PlayerStatus = 'regular' | 'newbie' | 'inactive';
export type PreferredPosition = 'attacking' | 'midfield' | 'defensive' | 'everywhere';

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  preferred_position: PreferredPosition;
  shooting: number;        // 0-10
  passing: number;         // 0-10
  ball_control: number;    // 0-10
  playmaking: number;      // 0-10
  defending: number;       // 0-10
  fitness: number;         // 0-10
  overall_score: number;   // Generated column: average * 10 (0-100)
  is_linchpin: boolean;
  aliases: string[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Tool Argument Types
// ============================================================================

export interface ListPlayersArgs {
  status?: PlayerStatus | 'all';
  position?: PreferredPosition | 'all';
  search?: string;
  limit?: number;
  sortBy?: 'name' | 'overall_score' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

export interface GetPlayerArgs {
  name?: string;
  id?: string;
}

export interface AddPlayerArgs {
  name: string;
  status?: PlayerStatus;
  preferred_position?: PreferredPosition;
  shooting?: number;
  passing?: number;
  ball_control?: number;
  playmaking?: number;
  defending?: number;
  fitness?: number;
  overall_score?: number;
  is_linchpin?: boolean;
  aliases?: string[];
  notes?: string;
  confirm_skills?: boolean;
}

export interface UpdatePlayerArgs {
  name?: string;
  id?: string;
  new_name?: string;
  status?: PlayerStatus;
  preferred_position?: PreferredPosition;
  shooting?: number;
  passing?: number;
  ball_control?: number;
  playmaking?: number;
  defending?: number;
  fitness?: number;
  overall_score?: number;
  is_linchpin?: boolean;
  aliases?: string[];
  notes?: string;
}

export interface DeletePlayerArgs {
  name?: string;
  id?: string;
  confirm?: boolean;
}

export interface GetStatsArgs {
  type?: 'overview' | 'top_players' | 'position_breakdown' | 'status_breakdown';
  limit?: number;
}

export interface BulkAddPlayersArgs {
  players: AddPlayerArgs[];
}

export interface SearchPlayersArgs {
  query: string;
}

// ============================================================================
// Result Types
// ============================================================================

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ListPlayersResult {
  players: Player[];
  count: number;
}

export interface GetPlayerResult {
  player: Player | Player[];
}

// Intermediate step when adding a player (needs more info)
export interface AddPlayerPendingResult {
  needs_skill_info?: boolean;
  needs_confirmation?: boolean;
  step: string;
  player_name: string;
  message: string;
  instruction: string;
  overall_score?: number;
  derived_skills?: {
    shooting: number;
    passing: number;
    ball_control: number;
    playmaking: number;
    defending: number;
    fitness: number;
  };
  skills_display?: Array<{
    name: string;
    value: number;
    key: string;
  }>;
}

// Final result when player is successfully added
export interface AddPlayerSuccessResult {
  message: string;
  player: Player;
}

// Union type for add_player results
export type AddPlayerResult = AddPlayerPendingResult | AddPlayerSuccessResult;

export interface UpdatePlayerResult {
  message: string;
  player: Player;
  changes: Record<string, unknown>;
}

export interface DeletePlayerResult {
  message: string;
}

export interface OverviewStats {
  totalPlayers: number;
  averageScore: number;
  byStatus: Record<string, number>;
}

export interface TopPlayersStats {
  topPlayers: Array<{
    name: string;
    overall_score: number;
    preferred_position: PreferredPosition;
  }>;
}

export interface PositionBreakdownStats {
  positionBreakdown: Record<string, number>;
}

export interface StatusBreakdownStats {
  statusBreakdown: Record<string, number>;
}

export type StatsResult = OverviewStats | TopPlayersStats | PositionBreakdownStats | StatusBreakdownStats;

export interface BulkAddPlayersResult {
  message: string;
  players: string[];
}

export interface SearchPlayersResult {
  players: Player[];
  count: number;
  query: string;
}

// ============================================================================
// Supabase Client Interface
// ============================================================================

/**
 * Minimal interface for Supabase client that works with both
 * @supabase/supabase-js (Node.js) and jsr:@supabase/supabase-js (Deno)
 */
export interface SupabaseClientLike {
  from(table: string): SupabaseQueryBuilder;
}

export interface SupabaseQueryBuilder {
  select(columns?: string): SupabaseFilterBuilder;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): SupabaseFilterBuilder;
  update(values: Record<string, unknown>): SupabaseFilterBuilder;
  delete(): SupabaseFilterBuilder;
}

export interface SupabaseFilterBuilder {
  eq(column: string, value: unknown): SupabaseFilterBuilder;
  ilike(column: string, pattern: string): SupabaseFilterBuilder;
  or(filters: string): SupabaseFilterBuilder;
  order(column: string, options?: { ascending?: boolean }): SupabaseFilterBuilder;
  limit(count: number): SupabaseFilterBuilder;
  single(): Promise<{ data: Player | null; error: Error | null }>;
  select(columns?: string): SupabaseFilterBuilder;
  then<T>(
    onfulfilled?: (value: { data: Player[] | null; error: Error | null }) => T
  ): Promise<T>;
}
