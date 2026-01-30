import Fuse from 'fuse.js';
import { EnhancedPlayer, DatabasePlayer } from '../types';

interface FuzzyMatchOptions {
  threshold?: number;
  includeAliases?: boolean;
}

interface MatchResult<T> {
  item: T;
  score: number;
  matches: string[];
}

/**
 * Extract aliases from a name like "Ne (Negm / N / Nagm)"
 * Returns the main name and an array of aliases
 */
export function extractAliases(fullName: string): { mainName: string; aliases: string[] } {
  const aliasMatch = fullName.match(/^([^(]+)(?:\s*\(([^)]+)\))?/);

  if (!aliasMatch) {
    return { mainName: fullName.trim(), aliases: [] };
  }

  const mainName = aliasMatch[1].trim();
  const aliasString = aliasMatch[2];

  if (!aliasString) {
    return { mainName, aliases: [] };
  }

  // Split by common separators: / , ; |
  const aliases = aliasString
    .split(/[\/,;|]/)
    .map(alias => alias.trim())
    .filter(alias => alias.length > 0);

  return { mainName, aliases };
}

/**
 * Create a Fuse instance for fuzzy searching players
 */
export function createPlayerSearchIndex<T extends { name: string; aliases?: string[] }>(
  players: T[]
): Fuse<T> {
  return new Fuse(players, {
    keys: [
      { name: 'name', weight: 1 },
      { name: 'aliases', weight: 0.8 },
    ],
    threshold: 0.4, // Lower = stricter matching
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

/**
 * Find the best matching player for a given search term
 */
export function findBestMatch<T extends { name: string; aliases?: string[] }>(
  searchTerm: string,
  players: T[],
  options: FuzzyMatchOptions = {}
): T | null {
  const { threshold = 0.4, includeAliases = true } = options;

  if (!searchTerm || searchTerm.length === 0) {
    return null;
  }

  const normalizedSearch = searchTerm.toLowerCase().trim();

  // First, try exact match on name
  const exactMatch = players.find(
    p => p.name.toLowerCase() === normalizedSearch
  );
  if (exactMatch) return exactMatch;

  // Try exact match on aliases
  if (includeAliases) {
    const aliasMatch = players.find(p =>
      p.aliases?.some(alias => alias.toLowerCase() === normalizedSearch)
    );
    if (aliasMatch) return aliasMatch;
  }

  // Try substring match (name contains search or search contains name)
  const substringMatch = players.find(p => {
    const pName = p.name.toLowerCase();
    return pName.includes(normalizedSearch) || normalizedSearch.includes(pName);
  });
  if (substringMatch) return substringMatch;

  // Fall back to fuzzy search
  const fuse = createPlayerSearchIndex(players);
  const results = fuse.search(normalizedSearch);

  if (results.length > 0 && results[0].score !== undefined && results[0].score <= threshold) {
    return results[0].item;
  }

  return null;
}

/**
 * Find all matching players for a search term (returns multiple results)
 */
export function findAllMatches<T extends { name: string; aliases?: string[] }>(
  searchTerm: string,
  players: T[],
  limit: number = 5,
  options: FuzzyMatchOptions = {}
): MatchResult<T>[] {
  const { threshold = 0.6 } = options;

  if (!searchTerm || searchTerm.length === 0) {
    return [];
  }

  const fuse = createPlayerSearchIndex(players);
  const results = fuse.search(searchTerm, { limit });

  return results
    .filter(r => r.score !== undefined && r.score <= threshold)
    .map(r => ({
      item: r.item,
      score: r.score ?? 1,
      matches: r.matches?.map(m => m.value ?? '') ?? [],
    }));
}

/**
 * Calculate similarity score between two strings (0-1, higher is more similar)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Levenshtein distance
  const matrix: number[][] = [];

  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const maxLength = Math.max(s1.length, s2.length);
  return 1 - matrix[s1.length][s2.length] / maxLength;
}

/**
 * Match player names from AI results to database players
 */
export function matchPlayersToDatabase<T extends { name: string; aliases?: string[] }>(
  aiNames: string[],
  databasePlayers: T[]
): Map<string, T | null> {
  const results = new Map<string, T | null>();

  for (const name of aiNames) {
    const match = findBestMatch(name, databasePlayers);
    results.set(name, match);
  }

  return results;
}
