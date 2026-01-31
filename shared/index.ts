/**
 * Unified AI Command System - Shared Core
 *
 * This module exports everything needed to interact with the player database
 * across multiple platforms (Edge Function, MCP Server, WhatsApp, etc.)
 */

// Types
export type {
  Player,
  PlayerStatus,
  PreferredPosition,
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

// Tool schemas
export {
  TOOL_SCHEMAS,
  toGeminiFunctionDeclarations,
  getToolSchema,
} from './tool-schemas.ts';

export type { ToolSchema, PropertySchema } from './tool-schemas.ts';

// Handlers
export {
  listPlayers,
  getPlayer,
  addPlayer,
  updatePlayer,
  deletePlayer,
  getStats,
  bulkAddPlayers,
  searchPlayers,
  executeHandler,
} from './handlers.ts';

export type { ToolName } from './handlers.ts';
