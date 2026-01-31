/**
 * Supabase Database Types
 * Generated types for the Streamlined Soccer database schema
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'admin' | 'organiser' | 'user';
export type PlayerStatus = 'regular' | 'newbie' | 'inactive';
export type PreferredPosition = 'attacking' | 'midfield' | 'defensive' | 'everywhere';

export interface Database {
  soccer: {
    Tables: {
      app_users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: UserRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          role?: UserRole;
          updated_at?: string;
        };
      };
      players: {
        Row: {
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
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
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
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
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
          notes?: string | null;
          updated_at?: string;
        };
      };
      lineups: {
        Row: {
          id: string;
          name: string;
          created_by: string | null;
          player_positions: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by?: string | null;
          player_positions?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          player_positions?: Json;
          updated_at?: string;
        };
      };
      chat_threads: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          updated_at?: string;
        };
      };
      chat_messages: {
        Row: {
          id: string;
          thread_id: string;
          role: 'user' | 'assistant';
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          role: 'user' | 'assistant';
          content: string;
          created_at?: string;
        };
        Update: {
          content?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      player_status: PlayerStatus;
      preferred_position: PreferredPosition;
    };
  };
}

// Helper types for easier usage
export type Profile = Database['soccer']['Tables']['app_users']['Row'];
export type ProfileInsert = Database['soccer']['Tables']['app_users']['Insert'];
export type ProfileUpdate = Database['soccer']['Tables']['app_users']['Update'];

export type Player = Database['soccer']['Tables']['players']['Row'];
export type PlayerInsert = Database['soccer']['Tables']['players']['Insert'];
export type PlayerUpdate = Database['soccer']['Tables']['players']['Update'];

export type Lineup = Database['soccer']['Tables']['lineups']['Row'];
export type LineupInsert = Database['soccer']['Tables']['lineups']['Insert'];
export type LineupUpdate = Database['soccer']['Tables']['lineups']['Update'];

// Player position in a lineup
export interface PlayerPosition {
  player_id: string;
  team: 'black' | 'white';
  x: number;
  y: number;
}

// Calculate overall score from individual stats
export function calculateOverallScore(stats: {
  shooting: number;
  passing: number;
  ball_control: number;
  playmaking: number;
  defending: number;
  fitness: number;
}): number {
  const sum =
    stats.shooting +
    stats.passing +
    stats.ball_control +
    stats.playmaking +
    stats.defending +
    stats.fitness;
  // Average of 6 skills, scaled to 0-100
  return Math.round((sum / 6) * 10);
}
