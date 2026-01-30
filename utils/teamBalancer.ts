import { Player } from '../types/database';

interface TeamPlayer {
  name: string;
  player: Player | null;
  rating: number;
  position: 'attacking' | 'midfield' | 'defensive' | 'everywhere';
}

interface BalancedTeams {
  black: TeamPlayer[];
  white: TeamPlayer[];
  blackTotal: number;
  whiteTotal: number;
  blackPositions: PositionCount;
  whitePositions: PositionCount;
}

interface PositionCount {
  attacking: number;
  midfield: number;
  defensive: number;
  everywhere: number;
}

/**
 * Balance teams based on overall score AND positional distribution
 *
 * Algorithm:
 * 1. Group players by position
 * 2. For each position group, sort by rating (highest first)
 * 3. Alternate picks between teams, always giving to the team with lower total
 * 4. This ensures both teams have similar positional makeup AND similar total ratings
 */
export function balanceTeams(
  playerNames: string[],
  findPlayerByName: (name: string) => Player | null
): BalancedTeams {
  // Look up all players and get their info
  const teamPlayers: TeamPlayer[] = playerNames.map(name => {
    const player = findPlayerByName(name);
    return {
      name,
      player,
      rating: player?.overall_score ?? 70, // Default rating for unknown players
      position: player?.preferred_position ?? 'everywhere',
    };
  });

  // Group by position
  const byPosition: Record<string, TeamPlayer[]> = {
    attacking: [],
    midfield: [],
    defensive: [],
    everywhere: [],
  };

  teamPlayers.forEach(p => {
    byPosition[p.position].push(p);
  });

  // Sort each position group by rating (highest first)
  Object.values(byPosition).forEach(group => {
    group.sort((a, b) => b.rating - a.rating);
  });

  // Initialize teams
  const black: TeamPlayer[] = [];
  const white: TeamPlayer[] = [];
  let blackTotal = 0;
  let whiteTotal = 0;

  // Distribute players from each position group
  // Process positions in order: defensive, midfield, attacking, everywhere
  // This ensures core positions are balanced first
  const positionOrder: Array<'defensive' | 'midfield' | 'attacking' | 'everywhere'> = [
    'defensive',
    'midfield',
    'attacking',
    'everywhere',
  ];

  for (const position of positionOrder) {
    const group = byPosition[position];

    // Sort by rating for this group
    group.sort((a, b) => b.rating - a.rating);

    // Alternate picks, always giving to the team with lower total
    // But also try to keep position counts balanced
    for (const player of group) {
      const blackPosCount = black.filter(p => p.position === position).length;
      const whitePosCount = white.filter(p => p.position === position).length;

      // Decide which team gets this player
      let assignToBlack: boolean;

      if (black.length >= 6) {
        // Black team is full
        assignToBlack = false;
      } else if (white.length >= 6) {
        // White team is full
        assignToBlack = true;
      } else if (blackPosCount < whitePosCount) {
        // Black has fewer of this position
        assignToBlack = true;
      } else if (whitePosCount < blackPosCount) {
        // White has fewer of this position
        assignToBlack = false;
      } else {
        // Same position count - give to team with lower total rating
        assignToBlack = blackTotal <= whiteTotal;
      }

      if (assignToBlack) {
        black.push(player);
        blackTotal += player.rating;
      } else {
        white.push(player);
        whiteTotal += player.rating;
      }
    }
  }

  // Count positions for each team
  const countPositions = (team: TeamPlayer[]): PositionCount => ({
    attacking: team.filter(p => p.position === 'attacking').length,
    midfield: team.filter(p => p.position === 'midfield').length,
    defensive: team.filter(p => p.position === 'defensive').length,
    everywhere: team.filter(p => p.position === 'everywhere').length,
  });

  return {
    black,
    white,
    blackTotal: Math.round(blackTotal),
    whiteTotal: Math.round(whiteTotal),
    blackPositions: countPositions(black),
    whitePositions: countPositions(white),
  };
}

/**
 * Format team balance info for display
 */
export function formatTeamBalance(teams: BalancedTeams): string {
  const diff = Math.abs(teams.blackTotal - teams.whiteTotal);
  const avgDiff = diff / 6; // Per player difference

  let balance = 'Perfectly balanced';
  if (avgDiff > 5) balance = 'Slightly uneven';
  if (avgDiff > 10) balance = 'Unbalanced';

  return `Black: ${teams.blackTotal} pts | White: ${teams.whiteTotal} pts (${balance})`;
}
