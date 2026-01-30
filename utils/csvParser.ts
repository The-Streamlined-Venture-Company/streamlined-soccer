import Papa from 'papaparse';
import { PlayerInsert, PlayerStatus, PreferredPosition, calculateOverallScore } from '../types/database';
import { extractAliases } from './fuzzyMatch';

interface RawCSVRow {
  [key: string]: string | undefined;
}

interface ParsedCSVResult {
  players: PlayerInsert[];
  errors: string[];
  warnings: string[];
}

// Map status strings to enum values
function parseStatus(value: string | undefined): PlayerStatus {
  if (!value) return 'regular';

  const normalized = value.toLowerCase().trim();
  if (normalized === 'newbie' || normalized === 'new') return 'newbie';
  if (normalized === 'inactive' || normalized === 'retired') return 'inactive';
  return 'regular';
}

// Map position strings to enum values
function parsePosition(value: string | undefined): PreferredPosition {
  if (!value) return 'everywhere';

  const normalized = value.toLowerCase().trim();
  if (normalized.includes('attack') || normalized.includes('forward') || normalized.includes('striker')) {
    return 'attacking';
  }
  if (normalized.includes('mid') || normalized.includes('center')) {
    return 'midfield';
  }
  if (normalized.includes('defen') || normalized.includes('back') || normalized.includes('keeper') || normalized.includes('gk')) {
    return 'defensive';
  }
  return 'everywhere';
}

// Parse a skill value (0-10 scale)
function parseSkill(value: string | number | undefined): number {
  if (value === undefined || value === '') return 5;

  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return 5;

  // Clamp to 0-10
  return Math.max(0, Math.min(10, Math.round(num)));
}

// Check for linchpin indicator
function parseLinchpin(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '✔︎' || normalized === '✓' || normalized === 'yes' || normalized === 'true' || normalized === '1';
}

// Find column index case-insensitively
function findColumn(headers: string[], ...possibleNames: string[]): number {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  for (const name of possibleNames) {
    const idx = lowerHeaders.indexOf(name.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse CSV text into player data
 */
export function parseCSV(csvText: string): ParsedCSVResult {
  const players: PlayerInsert[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const result = Papa.parse<RawCSVRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  if (result.errors.length > 0) {
    result.errors.forEach(err => {
      errors.push(`Row ${err.row}: ${err.message}`);
    });
  }

  if (result.data.length === 0) {
    errors.push('No data found in CSV');
    return { players, errors, warnings };
  }

  // Get headers
  const headers = Object.keys(result.data[0] || {});

  // Map column names (flexible matching)
  const nameCol = headers.find(h =>
    h.toLowerCase().includes('name') || h.toLowerCase().includes('player')
  );
  const statusCol = headers.find(h => h.toLowerCase().includes('status'));
  const positionCol = headers.find(h =>
    h.toLowerCase().includes('position') || h.toLowerCase().includes('pos')
  );
  const shootingCol = headers.find(h => h.toLowerCase().includes('shooting') || h.toLowerCase() === 'shot');
  const passingCol = headers.find(h => h.toLowerCase().includes('passing') || h.toLowerCase() === 'pass');
  const ballControlCol = headers.find(h =>
    h.toLowerCase().includes('ball') || h.toLowerCase().includes('control') || h.toLowerCase() === 'dribble'
  );
  const playmakingCol = headers.find(h =>
    h.toLowerCase().includes('playmaking') || h.toLowerCase().includes('vision') || h.toLowerCase() === 'vision'
  );
  const defendingCol = headers.find(h =>
    h.toLowerCase().includes('defending') || h.toLowerCase().includes('defense') || h.toLowerCase() === 'def'
  );
  const fitnessCol = headers.find(h =>
    h.toLowerCase().includes('fitness') || h.toLowerCase().includes('stamina') || h.toLowerCase() === 'pace'
  );
  const linchpinCol = headers.find(h => h.toLowerCase().includes('linchpin') || h.toLowerCase().includes('captain'));
  const notesCol = headers.find(h => h.toLowerCase().includes('notes') || h.toLowerCase().includes('comment'));

  if (!nameCol) {
    errors.push('Could not find a "Name" or "Player" column');
    return { players, errors, warnings };
  }

  // Parse each row
  result.data.forEach((row, index) => {
    const rawName = row[nameCol];
    if (!rawName || rawName.trim() === '') {
      warnings.push(`Row ${index + 2}: Empty name, skipping`);
      return;
    }

    // Extract main name and aliases from format: "Name (alias1 / alias2)"
    const { mainName, aliases } = extractAliases(rawName);

    const shooting = parseSkill(shootingCol ? row[shootingCol] : undefined);
    const passing = parseSkill(passingCol ? row[passingCol] : undefined);
    const ball_control = parseSkill(ballControlCol ? row[ballControlCol] : undefined);
    const playmaking = parseSkill(playmakingCol ? row[playmakingCol] : undefined);
    const defending = parseSkill(defendingCol ? row[defendingCol] : undefined);
    const fitness = parseSkill(fitnessCol ? row[fitnessCol] : undefined);

    const player: PlayerInsert = {
      name: mainName,
      status: parseStatus(statusCol ? row[statusCol] : undefined),
      preferred_position: parsePosition(positionCol ? row[positionCol] : undefined),
      shooting,
      passing,
      ball_control,
      playmaking,
      defending,
      fitness,
      overall_score: calculateOverallScore({ shooting, passing, ball_control, playmaking, defending, fitness }),
      is_linchpin: parseLinchpin(linchpinCol ? row[linchpinCol] : undefined),
      aliases,
      notes: notesCol ? row[notesCol]?.trim() || null : null,
    };

    players.push(player);
  });

  return { players, errors, warnings };
}

/**
 * Parse CSV from a File object
 */
export function parseCSVFile(file: File): Promise<ParsedCSVResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      resolve(parseCSV(text));
    };
    reader.onerror = () => {
      resolve({
        players: [],
        errors: ['Failed to read file'],
        warnings: [],
      });
    };
    reader.readAsText(file);
  });
}

/**
 * Generate CSV from player data
 */
export function generateCSV(players: PlayerInsert[]): string {
  const data = players.map(p => ({
    'Player Name': p.aliases && p.aliases.length > 0
      ? `${p.name} (${p.aliases.join(' / ')})`
      : p.name,
    'Status': p.status || 'regular',
    'Preferred Position': p.preferred_position || 'everywhere',
    'Shooting': p.shooting || 5,
    'Passing': p.passing || 5,
    'Ball Control': p.ball_control || 5,
    'Playmaking': p.playmaking || 5,
    'Defending': p.defending || 5,
    'Fitness': p.fitness || 5,
    'Overall': p.overall_score || 50,
    'Linchpin': p.is_linchpin ? '✔︎' : '',
    'Notes': p.notes || '',
  }));

  return Papa.unparse(data);
}

/**
 * Download CSV file
 */
export function downloadCSV(players: PlayerInsert[], filename: string = 'players.csv'): void {
  const csv = generateCSV(players);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
