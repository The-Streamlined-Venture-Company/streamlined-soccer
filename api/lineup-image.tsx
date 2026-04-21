/**
 * Lineup pitch image endpoint — vertical formation view.
 *
 * GET /api/lineup-image?id=<lineup_uuid>[&v=<cache_bust>]
 *
 * Renders a 1080×1920 PNG of a proper football pitch with shirt icons in
 * formation. Black team occupies the top half (goal at top), white team
 * the bottom half. Matches the styling of the app's <Pitch /> component.
 *
 * Data fetched via the public `soccer.get_lineup_for_image(uuid)` RPC.
 */

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

interface Position {
  player_id: string;
  name: string;
  overall_score: number;
  preferred_position: string;
  is_linchpin: boolean;
  team: 'black' | 'white';
  locked: boolean;
}

interface LineupPayload {
  id: string;
  name: string;
  status: string;
  match_date: string | null;
  player_positions: Position[];
  session: {
    name: string;
    kickoff_dow: number;
    kickoff_time: string;
    pitch_label: string | null;
  } | null;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY as string;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function fetchLineup(id: string): Promise<LineupPayload | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_lineup_for_image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Accept-Profile': 'soccer',
      'Content-Profile': 'soccer',
    },
    body: JSON.stringify({ p_id: id }),
  });
  if (!res.ok) return null;
  return (await res.json()) as LineupPayload | null;
}

// ── Formation slots (x/y as % of half-pitch for black/white) ────────────────
// Black team: y relative to top half (0-50% of full image)
// White team: y relative to bottom half (50-100% of full image)
// For 6-aside we use a 1-2-2-1 (GK-DEF-MID-FWD). For other sizes, we fall
// back to even-height rows across the half.

interface Slot {
  x: number; // %
  y: number; // % within that team's half (0 = goal line, 100 = center line)
}

const FORMATION_6: Slot[] = [
  { x: 50, y: 10 },    // GK (near goal)
  { x: 25, y: 32 },    // DEF L
  { x: 75, y: 32 },    // DEF R
  { x: 25, y: 58 },    // MID L
  { x: 75, y: 58 },    // MID R
  { x: 50, y: 85 },    // FWD (near center)
];

function slotsForTeam(n: number): Slot[] {
  if (n === 6) return FORMATION_6;
  // Generic: distribute across 4 rows (1, ceil((n-2)/2), ceil((n-2)/2), 1)
  // with GK + FWD fixed and the middle balanced.
  if (n === 0) return [];
  if (n === 1) return [{ x: 50, y: 50 }];
  if (n === 2) return [{ x: 50, y: 15 }, { x: 50, y: 80 }];
  if (n === 3) return [{ x: 50, y: 12 }, { x: 25, y: 55 }, { x: 75, y: 55 }];
  if (n === 4) return [{ x: 50, y: 12 }, { x: 25, y: 45 }, { x: 75, y: 45 }, { x: 50, y: 82 }];
  if (n === 5) return [{ x: 50, y: 12 }, { x: 25, y: 40 }, { x: 75, y: 40 }, { x: 30, y: 75 }, { x: 70, y: 75 }];
  if (n === 7) return [...FORMATION_6.slice(0, 5), { x: 30, y: 85 }, { x: 70, y: 85 }];
  if (n >= 8) {
    // Two rows of ~n/2, front row slightly closer to center line
    const out: Slot[] = [{ x: 50, y: 10 }]; // GK
    const remaining = n - 1;
    const back = Math.ceil(remaining / 2);
    const front = remaining - back;
    for (let i = 0; i < back; i++) out.push({ x: 20 + (60 * (i + 0.5)) / back, y: 40 });
    for (let i = 0; i < front; i++) out.push({ x: 20 + (60 * (i + 0.5)) / front, y: 75 });
    return out;
  }
  return [];
}

// ── Shirt SVG (simplified from components/ShirtIcon.tsx) ────────────────────
function BlackShirt() {
  return (
    <svg viewBox="0 0 100 100" width="130" height="130" xmlns="http://www.w3.org/2000/svg">
      <g fill="#1a1a1a" stroke="#fff" strokeWidth="0.8">
        <path d="M75.41,18.57c-0.01-0.01-0.03-0.01-0.04-0.02c-0.01-0.01-0.02-0.02-0.03-0.03l-11.59-5.3c-0.01,0-0.01,0-0.02,0c0,0,0,0,0-0.01l-1.7-0.66C61.07,10.98,59.33,10,57.47,10H42.53c-1.85,0-3.59,0.98-4.56,2.56l-1.7,0.66c0,0.01,0,0.01,0,0.01c-0.01,0-0.01,0-0.02,0l-11.59,5.3c-0.01,0.01-0.02,0.02-0.03,0.03c-0.01,0.01-0.03,0.01-0.04,0.02c-4.21,4.06-5.49,9.93-6.27,13.43c-0.71,3.24-0.94,6.59-0.67,9.95c0.01,0.1,0.09,0.2,0.2,0.22l10.55,1.62c0.01,0.01,0.03,0.01,0.04,0.01c0.05,0,0.1-0.02,0.14-0.06c0.06-0.04,0.09-0.1,0.1-0.16l0.91-8.69c2.47,11.67,2.09,22.12,1.74,31.38c-0.29,7.42-1.06,14.91-2.25,22.26c-0.01,0.07,0.01,0.13,0.05,0.18c0.04,0.06,0.1,0.09,0.16,0.1c3.37,0.38,6.53,0.67,9.71,0.86C42.72,89.89,46.43,90,50,90s7.28-0.11,11.01-0.33c3.18-0.19,6.34-0.48,9.71-0.86c0.07-0.01,0.12-0.04,0.16-0.1c0.04-0.05,0.06-0.11,0.05-0.18c-1.2-7.36-1.96-14.85-2.25-22.26c-0.35-9.26-0.73-19.71,1.74-31.37l0.91,8.68c0.01,0.07,0.04,0.12,0.1,0.16c0.04,0.04,0.1,0.06,0.14,0.06c0.01,0,0.03,0,0.04-0.01l10.55-1.62c0.11-0.02,0.19-0.11,0.2-0.22c0.27-3.37,0.04-6.71-0.67-9.95C80.91,28.49,79.62,22.63,75.41,18.57z" />
      </g>
    </svg>
  );
}

function WhiteShirt() {
  return (
    <svg viewBox="0 0 100 100" width="130" height="130" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#ffffff"
        stroke="#888"
        strokeWidth="1"
        d="M75.41,18.57c-0.01-0.01-0.03-0.01-0.04-0.02c-0.01-0.01-0.02-0.02-0.03-0.03l-11.59-5.3c-0.01,0-0.01,0-0.02,0c0,0,0,0,0-0.01l-1.7-0.66C61.07,10.98,59.33,10,57.47,10H42.53c-1.85,0-3.59,0.98-4.56,2.56l-1.7,0.66c0,0.01,0,0.01,0,0.01c-0.01,0-0.01,0-0.02,0l-11.59,5.3c-0.01,0.01-0.02,0.02-0.03,0.03c-0.01,0.01-0.03,0.01-0.04,0.02c-4.21,4.06-5.49,9.93-6.27,13.43c-0.71,3.24-0.94,6.59-0.67,9.95c0.01,0.1,0.09,0.2,0.2,0.22l10.55,1.62c0.01,0.01,0.03,0.01,0.04,0.01c0.05,0,0.1-0.02,0.14-0.06c0.06-0.04,0.09-0.1,0.1-0.16l0.91-8.69c2.47,11.67,2.09,22.12,1.74,31.38c-0.29,7.42-1.06,14.91-2.25,22.26c-0.01,0.07,0.01,0.13,0.05,0.18c0.04,0.06,0.1,0.09,0.16,0.1c3.37,0.38,6.53,0.67,9.71,0.86C42.72,89.89,46.43,90,50,90s7.28-0.11,11.01-0.33c3.18-0.19,6.34-0.48,9.71-0.86c0.07-0.01,0.12-0.04,0.16-0.1c0.04-0.05,0.06-0.11,0.05-0.18c-1.2-7.36-1.96-14.85-2.25-22.26c-0.35-9.26-0.73-19.71,1.74-31.37l0.91,8.68c0.01,0.07,0.04,0.12,0.1,0.16c0.04,0.04,0.1,0.06,0.14,0.06c0.01,0,0.03,0,0.04-0.01l10.55-1.62c0.11-0.02,0.19-0.11,0.2-0.22c0.27-3.37,0.04-6.71-0.67-9.95C80.91,28.49,79.62,22.63,75.41,18.57z"
      />
    </svg>
  );
}

function PlayerOnPitch({ player, x, y }: { player: Position; x: number; y: number; key?: string }) {
  // x/y are % of the overall image (0-100). Convert to absolute for use with
  // `left`/`top`. Shirts are 130px, card width ~200px centered on the slot.
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 200,
      }}
    >
      {/* Linchpin halo ring — rendered behind the shirt */}
      {player.is_linchpin && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            width: 142,
            height: 142,
            borderRadius: 71,
            border: '4px solid #fbbf24',
            boxShadow: '0 0 24px rgba(251, 191, 36, 0.45)',
            display: 'flex',
          }}
        />
      )}
      {/* Shirt */}
      {player.team === 'black' ? <BlackShirt /> : <WhiteShirt />}
      {/* Name pill */}
      <div
        style={{
          marginTop: -12,
          padding: '6px 14px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          color: '#f1f5f9',
          borderRadius: 20,
          fontSize: 26,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {player.name}
      </div>
    </div>
  );
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Bad id', { status: 400 });

  let lineup: LineupPayload | null;
  try {
    lineup = await fetchLineup(id);
  } catch (e) {
    return new Response(`Fetch failed: ${(e as Error).message}`, { status: 500 });
  }
  if (!lineup) return new Response('Not found', { status: 404 });

  const positions = Array.isArray(lineup.player_positions) ? lineup.player_positions : [];
  // Sort each team so the captain/linchpin/highest-score goes into prominent
  // formation slots (first = GK, last = FWD in 1-2-2-1)
  const sortForFormation = (a: Position, b: Position) => {
    // Sort by preferred_position priority then overall score
    const order: Record<string, number> = { everywhere: 1, defensive: 0, midfield: 2, attacking: 3 };
    return (order[a.preferred_position] ?? 1) - (order[b.preferred_position] ?? 1) || b.overall_score - a.overall_score;
  };
  const black = positions.filter(p => p.team === 'black').sort(sortForFormation);
  const white = positions.filter(p => p.team === 'white').sort(sortForFormation);

  const dayName = lineup.session ? DAYS[lineup.session.kickoff_dow] : '';
  const time = lineup.session?.kickoff_time?.substring(0, 5) ?? '';
  const pitchLabel = lineup.session?.pitch_label ?? '';

  const blackSlots = slotsForTeam(black.length);
  const whiteSlots = slotsForTeam(white.length);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#020617',
          fontFamily: '"Inter", sans-serif',
        }}
      >
        {/* Top banner */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 32px',
            backgroundColor: '#0f172a',
            borderBottom: '2px solid #1e293b',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 14,
                letterSpacing: 4,
                color: '#34d399',
                fontWeight: 900,
                textTransform: 'uppercase',
              }}
            >
              Streamlined Soccer
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 36,
                fontWeight: 900,
                fontStyle: 'italic',
                color: '#f1f5f9',
                lineHeight: 1.1,
                marginTop: 2,
              }}
            >
              {dayName} {time}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            {pitchLabel ? (
              <div style={{ display: 'flex', color: '#94a3b8', fontSize: 18 }}>
                {pitchLabel}
              </div>
            ) : null}
            <div style={{ display: 'flex', color: '#64748b', fontSize: 16, marginTop: 4 }}>
              {lineup.match_date ?? ''}
            </div>
          </div>
        </div>

        {/* Pitch container (fills remaining vertical space) */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            position: 'relative',
            backgroundColor: '#1b5e20',
            // Subtle grass-stripe pattern using repeating linear gradient
            backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 60px, rgba(0,0,0,0.03) 60px 120px)',
            borderLeft: '10px solid #fff',
            borderRight: '10px solid #fff',
          }}
        >
          {/* Top goal area */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '38%',
              right: '38%',
              height: '4%',
              borderLeft: '4px solid rgba(255, 255, 255, 0.9)',
              borderRight: '4px solid rgba(255, 255, 255, 0.9)',
              borderBottom: '4px solid rgba(255, 255, 255, 0.9)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              display: 'flex',
            }}
          />
          {/* Top penalty area */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '25%',
              right: '25%',
              height: '12%',
              borderLeft: '4px solid rgba(255, 255, 255, 0.9)',
              borderRight: '4px solid rgba(255, 255, 255, 0.9)',
              borderBottom: '4px solid rgba(255, 255, 255, 0.9)',
              display: 'flex',
            }}
          />
          {/* Bottom penalty area */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: '25%',
              right: '25%',
              height: '12%',
              borderLeft: '4px solid rgba(255, 255, 255, 0.9)',
              borderRight: '4px solid rgba(255, 255, 255, 0.9)',
              borderTop: '4px solid rgba(255, 255, 255, 0.9)',
              display: 'flex',
            }}
          />
          {/* Bottom goal area */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: '38%',
              right: '38%',
              height: '4%',
              borderLeft: '4px solid rgba(255, 255, 255, 0.9)',
              borderRight: '4px solid rgba(255, 255, 255, 0.9)',
              borderTop: '4px solid rgba(255, 255, 255, 0.9)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              display: 'flex',
            }}
          />
          {/* Centre line */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: 4,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              transform: 'translateY(-50%)',
              display: 'flex',
            }}
          />
          {/* Centre circle */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 260,
              height: 260,
              borderRadius: 130,
              border: '4px solid rgba(255, 255, 255, 0.9)',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
            }}
          />
          {/* Centre spot */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
            }}
          />

          {/* Black team on top half — slot y% is within their half */}
          {black.map((p, i) => {
            const s = blackSlots[i] ?? { x: 50, y: 50 };
            // Map their half (0-100%) to image top half (0-50% of full)
            return (
              <PlayerOnPitch
                key={p.player_id}
                player={p}
                x={s.x}
                y={s.y * 0.5} // 0-50% of full image
              />
            );
          })}

          {/* White team on bottom half */}
          {white.map((p, i) => {
            const s = whiteSlots[i] ?? { x: 50, y: 50 };
            // Mirror formation so "GK" is near bottom goal: invert y within half
            const yInHalf = 100 - s.y;
            return (
              <PlayerOnPitch
                key={p.player_id}
                player={p}
                x={s.x}
                y={50 + yInHalf * 0.5} // 50-100% of full image
              />
            );
          })}
        </div>

        {/* Bottom banner */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 32px',
            backgroundColor: '#0f172a',
            borderTop: '2px solid #1e293b',
            color: '#e2e8f0',
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#1a1a1a', border: '1px solid #fff', display: 'flex' }} />
            <div style={{ display: 'flex' }}>Black {black.length}</div>
          </div>
          <div style={{ display: 'flex', color: '#64748b', fontSize: 20, fontWeight: 500 }}>
            {positions.length} players
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex' }}>White {white.length}</div>
            <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', border: '1px solid #888', display: 'flex' }} />
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1920 }
  );
}
