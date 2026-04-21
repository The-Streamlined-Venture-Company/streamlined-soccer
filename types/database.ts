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
export type TeamPreference = 'any' | 'black' | 'white';
export type ConstraintType = 'split' | 'together';
export type LineupStatus =
  | 'draft'
  | 'pending_approval'
  | 'confirmed'
  | 'rejected'
  | 'posted'
  | 'expired';

export type WeeklySessionState =
  | 'pending'
  | 'confirmation_sent'
  | 'confirmation_declined'
  | 'callout_sent'
  | 'followup_sent'
  | 'morning_nudge_sent'
  | 'teams_pending_approval'
  | 'teams_posted'
  | 'mom_sent'
  | 'mom_closed'
  | 'cancelled';

export interface WeeklySession {
  id: string;
  session_schedule_id: string;
  match_date: string;
  kickoff_at: string;
  state: WeeklySessionState;
  confirmation_token: string | null;
  confirmation_chat_jid: string | null;
  callout_chat_jid: string | null;
  signups_in: number;
  signups_out: number;
  signups_maybe: number;
  created_at: string;
  updated_at: string;
}

/** Shape of each entry in lineups.player_positions jsonb array. */
export interface LineupPlayer {
  player_id: string;
  name: string;
  overall_score: number;
  preferred_position: PreferredPosition;
  is_linchpin: boolean;
  team: 'black' | 'white';
  /** When true, the auto-balancer won't move this player on re-balance. */
  locked: boolean;
}

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
          preferred_team: TeamPreference;
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
          preferred_team?: TeamPreference;
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
          preferred_team?: TeamPreference;
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
          status: LineupStatus;
          approval_token: string | null;
          session_schedule_id: string | null;
          match_date: string | null;
          approved_by: string | null;
          approved_at: string | null;
          posted_at: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by?: string | null;
          player_positions?: Json;
          status?: LineupStatus;
          approval_token?: string | null;
          session_schedule_id?: string | null;
          match_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          player_positions?: Json;
          status?: LineupStatus;
          approval_token?: string | null;
          session_schedule_id?: string | null;
          match_date?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          posted_at?: string | null;
          rejection_reason?: string | null;
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
      organiser_config: {
        Row: {
          id: number;
          enabled: boolean;
          timezone: string;
          bot_persona: string;
          relay_url: string | null;
          relay_connection_name: string;
          alert_channel: 'in_app' | 'email' | 'whatsapp_dm' | 'push';
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          enabled?: boolean;
          timezone?: string;
          bot_persona?: string;
          relay_url?: string | null;
          relay_connection_name?: string;
          alert_channel?: 'in_app' | 'email' | 'whatsapp_dm' | 'push';
        };
        Update: {
          enabled?: boolean;
          timezone?: string;
          bot_persona?: string;
          relay_url?: string | null;
          relay_connection_name?: string;
          alert_channel?: 'in_app' | 'email' | 'whatsapp_dm' | 'push';
        };
      };
      session_schedules: {
        Row: {
          id: string;
          name: string;
          enabled: boolean;
          kickoff_dow: number;
          kickoff_time: string;
          pitch_label: string | null;
          weekly_post_dow: number;
          weekly_post_time: string;
          confirmation_enabled: boolean;
          confirmation_days_before: number;
          confirmation_time: string | null;
          followup_nudge_enabled: boolean;
          followup_threshold_low: number;
          followup_threshold_high: number;
          morning_nudge_enabled: boolean;
          morning_nudge_time: string;
          team_gen_offset_hours: number;
          mom_enabled: boolean;
          match_duration_minutes: number;
          mom_delay_minutes: number;
          mom_method: 'auto' | 'whatsapp_poll' | 'web_link';
          mom_results_post_minutes: number;
          target_players: number;
          min_players: number;
          allow_plus_ones: boolean;
          plus_ones_count_toward_target: boolean;
          whatsapp_group_jid: string | null;
          whatsapp_group_name: string | null;
          team_gen_instructions: string | null;
          team_gen_require_approval: boolean;
          callout_poll_question: string;
          callout_poll_options: string[];
          last_weekly_post_at: string | null;
          last_nudge_at: string | null;
          last_team_gen_at: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          enabled?: boolean;
          kickoff_dow: number;
          kickoff_time: string;
          pitch_label?: string | null;
          weekly_post_dow: number;
          weekly_post_time: string;
          confirmation_enabled?: boolean;
          confirmation_days_before?: number;
          confirmation_time?: string | null;
          followup_nudge_enabled?: boolean;
          followup_threshold_low?: number;
          followup_threshold_high?: number;
          morning_nudge_enabled?: boolean;
          morning_nudge_time?: string;
          team_gen_offset_hours?: number;
          mom_enabled?: boolean;
          match_duration_minutes?: number;
          mom_delay_minutes?: number;
          mom_method?: 'auto' | 'whatsapp_poll' | 'web_link';
          mom_results_post_minutes?: number;
          target_players?: number;
          min_players?: number;
          allow_plus_ones?: boolean;
          plus_ones_count_toward_target?: boolean;
          whatsapp_group_jid?: string | null;
          whatsapp_group_name?: string | null;
          team_gen_instructions?: string | null;
          team_gen_require_approval?: boolean;
          callout_poll_question?: string;
          callout_poll_options?: string[];
        };
        Update: {
          name?: string;
          enabled?: boolean;
          kickoff_dow?: number;
          kickoff_time?: string;
          pitch_label?: string | null;
          weekly_post_dow?: number;
          weekly_post_time?: string;
          confirmation_enabled?: boolean;
          confirmation_days_before?: number;
          confirmation_time?: string | null;
          followup_nudge_enabled?: boolean;
          followup_threshold_low?: number;
          followup_threshold_high?: number;
          morning_nudge_enabled?: boolean;
          morning_nudge_time?: string;
          team_gen_offset_hours?: number;
          mom_enabled?: boolean;
          match_duration_minutes?: number;
          mom_delay_minutes?: number;
          mom_method?: 'auto' | 'whatsapp_poll' | 'web_link';
          mom_results_post_minutes?: number;
          target_players?: number;
          min_players?: number;
          allow_plus_ones?: boolean;
          plus_ones_count_toward_target?: boolean;
          whatsapp_group_jid?: string | null;
          whatsapp_group_name?: string | null;
          team_gen_instructions?: string | null;
          team_gen_require_approval?: boolean;
          callout_poll_question?: string;
          callout_poll_options?: string[];
        };
      };
      team_constraints: {
        Row: {
          id: string;
          type: ConstraintType;
          player_a_id: string;
          player_b_id: string;
          notes: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          type: ConstraintType;
          player_a_id: string;
          player_b_id: string;
          notes?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          type?: ConstraintType;
          player_a_id?: string;
          player_b_id?: string;
          notes?: string | null;
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

export type OrganiserConfig = Database['soccer']['Tables']['organiser_config']['Row'];
export type OrganiserConfigUpdate = Database['soccer']['Tables']['organiser_config']['Update'];

export type SessionSchedule = Database['soccer']['Tables']['session_schedules']['Row'];
export type SessionScheduleInsert = Database['soccer']['Tables']['session_schedules']['Insert'];
export type SessionScheduleUpdate = Database['soccer']['Tables']['session_schedules']['Update'];

export type TeamConstraint = Database['soccer']['Tables']['team_constraints']['Row'];
export type TeamConstraintInsert = Database['soccer']['Tables']['team_constraints']['Insert'];

export const DAYS_OF_WEEK = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

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
