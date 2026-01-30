
export type TeamColor = 'black' | 'white';

// Player status in the database
export type PlayerStatus = 'regular' | 'newbie' | 'inactive';

// Preferred position categories
export type PreferredPosition = 'attacking' | 'midfield' | 'defensive' | 'everywhere';

// User roles for auth
export type UserRole = 'admin' | 'organiser' | 'user';

// Legacy DatabasePlayer interface (for backwards compatibility)
export interface DatabasePlayer {
  name: string;
  rating: number;
  position?: string;
}

// Enhanced player with full skill attributes
export interface EnhancedPlayer {
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
  overall_score: number;   // Computed average
  is_linchpin: boolean;
  aliases: string[];
  notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

// Pitch player (on the field)
export interface Player {
  id: string;
  name: string;
  rating?: number;
  number?: string;
  team: TeamColor;
  position: {
    x: number; // percentage 0-100
    y: number; // percentage 0-100
  };
}

export interface Team {
  name: string;
  color: TeamColor;
  players: Player[];
}

// Saved lineup
export interface SavedLineup {
  id: string;
  name: string;
  created_by: string;
  player_positions: PlayerPosition[];
  created_at: string;
  updated_at: string;
}

export interface PlayerPosition {
  player_id: string;
  team: TeamColor;
  x: number;
  y: number;
}

// User profile
export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

// Gemini AI types (for AIImporter)
export interface GeminiTextPart {
  text: string;
}

export interface GeminiInlineDataPart {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export type GeminiContentPart = GeminiTextPart | GeminiInlineDataPart;

export interface GeminiContents {
  parts: GeminiContentPart[];
}

// AI parsed player result
export interface AIPlayerResult {
  name: string;
  team: TeamColor;
}

// CSV import types
export interface CSVPlayerRow {
  'Player Name': string;
  'Status': string;
  'Preferred Position': string;
  'Shooting': string | number;
  'Passing': string | number;
  'Ball Control': string | number;
  'Playmaking': string | number;
  'Defending': string | number;
  'Fitness': string | number;
  'Linchpin'?: string;
  'Notes'?: string;
}

// Drag and drop types
export interface DragState {
  id: string;
  startX: number;
  startY: number;
}

// Auth types
export interface AuthState {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials extends SignInCredentials {
  fullName?: string;
}

// Error types
export interface AppError {
  message: string;
  code?: string;
  details?: string;
}
