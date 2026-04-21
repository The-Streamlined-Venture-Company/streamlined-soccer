/**
 * Fuzzy name matching for the "Match WhatsApp members → players" UI.
 *
 * WhatsApp display names tend to be messy: they include flags ("Cash 🇦🇪"),
 * suffixes ("John (FC)"), nicknames in parens, last-name initials, etc.
 *
 * We need to compare:
 *   - WhatsApp `pushName` and phone digits, against
 *   - Player `name` + every entry in `aliases`
 *
 * Approach:
 *  1. Normalise both sides (strip emojis/punctuation, lowercase, collapse spaces)
 *  2. Score: exact match = 100, exact first token match = 90,
 *     substring containment = 70, token Jaccard ≥ 0.5 = 50, else 0
 *  3. Caller picks the best player above a threshold (default 50)
 */

export interface NameCandidate {
  id: string;
  name: string;
  aliases?: readonly string[];
}

/** Strip emojis, ZWJ sequences, flag chars, punctuation; lowercase; collapse whitespace. */
export function normaliseName(s: string): string {
  if (!s) return '';
  return s
    // Drop emojis + symbols + flags (broad ranges)
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '') // regional indicators (flags)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '') // misc symbols & pictographs (incl. emojis)
    .replace(/[\u{2600}-\u{27BF}]/gu, '')   // misc symbols, dingbats
    .replace(/[\u{200B}-\u{200F}\u{FE0E}\u{FE0F}\u{2060}]/gu, '') // ZWJ, variation selectors
    // Bracketed annotations: " (FC)", " [Goalkeeper]", etc.
    .replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ')
    // Punctuation → space
    .replace(/[._,/\\|\-]+/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokens(s: string): string[] {
  return normaliseName(s).split(' ').filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Score a single candidate name (WhatsApp side) against a single player.
 * Considers the player's primary name AND every alias.
 * Returns the best score across all comparisons.
 */
export function scoreMatch(whatsappName: string, candidate: NameCandidate): number {
  const a = normaliseName(whatsappName);
  if (!a) return 0;
  const aTokens = tokens(whatsappName);
  const aFirst = aTokens[0] ?? '';

  const others = [candidate.name, ...(candidate.aliases ?? [])];
  let best = 0;
  for (const other of others) {
    const b = normaliseName(other);
    if (!b) continue;
    const bTokens = tokens(other);
    const bFirst = bTokens[0] ?? '';

    let score = 0;
    if (a === b) score = 100;
    else if (aFirst && aFirst === bFirst) score = 90;
    else if (a.includes(b) || b.includes(a)) score = 70;
    else {
      const j = jaccard(aTokens, bTokens);
      if (j >= 0.5) score = Math.round(40 + j * 50); // 40-90 range based on overlap
    }
    if (score > best) best = score;
  }
  return best;
}

/**
 * Find the best-matching candidate for a given WhatsApp name + phone.
 * Returns the candidate id and score, or null if nothing meets the threshold.
 *
 * `phoneNumber` is currently only used as a tie-breaker hint — if any candidate's
 * normalised name CONTAINS the phone, that scores higher. (Some teams put phone
 * digits in the name, e.g. "John 555".)
 */
export function bestMatch(
  whatsappName: string,
  phoneNumber: string,
  candidates: readonly NameCandidate[],
  threshold: number = 50,
): { id: string; score: number } | null {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreMatch(whatsappName, c);
    if (s > bestScore) {
      bestScore = s;
      bestId = c.id;
    }
  }
  // Phone digit hint: if any candidate's name contains the phone digits, boost
  // (rare, but cheap)
  if (phoneNumber && bestScore < 70) {
    for (const c of candidates) {
      const all = [c.name, ...(c.aliases ?? [])].join(' ');
      if (all.includes(phoneNumber)) {
        bestId = c.id;
        bestScore = Math.max(bestScore, 80);
      }
    }
  }
  return bestId && bestScore >= threshold ? { id: bestId, score: bestScore } : null;
}

/** Pretty-format a phone number for display (e.g. "971501234567" → "+971 50 123 4567") */
export function formatPhone(digits: string): string {
  if (!digits) return '';
  // Best-effort grouping; not locale-perfect but readable
  const len = digits.length;
  if (len < 7) return `+${digits}`;
  // Country code is typically 1-3 digits — split off leading 1-3 then group rest in 3s/4s
  // Heuristic: country code is first 1-3 digits, then split rest into groups of 3-4
  const ccLen = len <= 10 ? 1 : len === 11 ? 2 : 3;
  const cc = digits.substring(0, ccLen);
  const rest = digits.substring(ccLen);
  const grouped = rest.replace(/(\d{2,3})(?=(\d{4})+$)/g, '$1 ').replace(/(\d{4})$/, ' $1').trim();
  return `+${cc} ${grouped}`.trim();
}
