/**
 * Lineup pitch image endpoint.
 *
 * GET /api/lineup-image?id=<lineup_uuid>
 *
 * Returns a PNG rendering of the two teams on a pitch, built with Satori via
 * @vercel/og. The runtime's `postConfirmedLineups` passes this URL straight
 * to the relay's /media endpoint, which posts the image to the WhatsApp group.
 *
 * Data is fetched via the public `soccer.get_lineup_for_image(id)` RPC, which
 * SECURITY DEFINERs past RLS. UUIDs aren't enumerable, and teams become public
 * the moment they're posted to WhatsApp — this endpoint doesn't expose
 * anything that isn't already going to the group.
 */

import { ImageResponse } from '@vercel/og';

export const config = {
  runtime: 'edge',
};

interface LineupPayload {
  id: string;
  name: string;
  status: string;
  match_date: string | null;
  player_positions: Array<{
    player_id: string;
    name: string;
    overall_score: number;
    preferred_position: string;
    is_linchpin: boolean;
    team: 'black' | 'white';
    locked: boolean;
  }>;
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
      // Non-default schema — tell PostgREST
      'Accept-Profile': 'soccer',
      'Content-Profile': 'soccer',
    },
    body: JSON.stringify({ p_id: id }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data as LineupPayload | null;
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
  const black = positions.filter(p => p.team === 'black').sort((a, b) => b.overall_score - a.overall_score);
  const white = positions.filter(p => p.team === 'white').sort((a, b) => b.overall_score - a.overall_score);

  const dayName = lineup.session ? DAYS[lineup.session.kickoff_dow] : '';
  const time = lineup.session?.kickoff_time?.substring(0, 5) ?? '';
  const pitchLabel = lineup.session?.pitch_label ?? '';

  // Satori-compatible JSX — only `display: flex` layouts, limited CSS.
  // We render a pitch with two halves (black left, white right) and place
  // player name cards in column stacks inside each half.
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#020617',
          color: '#fff',
          fontFamily: '"Inter", sans-serif',
          padding: 32,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
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
              fontSize: 46,
              fontWeight: 900,
              lineHeight: 1.1,
              fontStyle: 'italic',
              marginTop: 6,
            }}
          >
            {dayName} {time}
          </div>
          {pitchLabel ? (
            <div style={{ display: 'flex', color: '#94a3b8', fontSize: 18, marginTop: 4 }}>
              {pitchLabel}
            </div>
          ) : null}
        </div>

        {/* Pitch — vertical layout: black half on TOP, white on BOTTOM */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            backgroundColor: '#064e3b',
            borderRadius: 18,
            position: 'relative',
            border: '4px solid #94a3b8',
            overflow: 'hidden',
          }}
        >
          {/* Centre line — horizontal across the middle */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: 4,
              backgroundColor: '#94a3b8',
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
              width: 160,
              height: 160,
              borderRadius: 80,
              border: '4px solid #94a3b8',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
            }}
          />

          {/* Black half (TOP) */}
          <TeamHalf players={black} team="black" />
          {/* White half (BOTTOM) */}
          <TeamHalf players={white} team="white" />
        </div>

        {/* Footer stats */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, fontSize: 22 }}>
          <div style={{ display: 'flex', color: '#e2e8f0', fontWeight: 700 }}>
            ⚫ {black.length} vs {white.length} ⚪
          </div>
          <div style={{ display: 'flex', color: '#64748b' }}>
            {lineup.match_date ?? ''}
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1920 }
  );
}

function TeamHalf({
  players,
  team,
}: {
  players: LineupPayload['player_positions'];
  team: 'black' | 'white';
}) {
  const emoji = team === 'black' ? '⚫' : '⚪';
  const label = team === 'black' ? 'Black' : 'White';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '50%',
        width: '100%',
        padding: 24,
        alignItems: 'center',
        justifyContent: team === 'black' ? 'flex-start' : 'flex-end',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 32,
          fontWeight: 900,
          letterSpacing: 3,
          marginBottom: 16,
          color: '#f1f5f9',
        }}
      >
        {emoji} {label.toUpperCase()} ({players.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        {players.map(p => (
          <div
            key={p.player_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 22px',
              backgroundColor: team === 'black' ? 'rgba(15, 23, 42, 0.85)' : 'rgba(241, 245, 249, 0.95)',
              color: team === 'black' ? '#f1f5f9' : '#0f172a',
              borderRadius: 999,
              fontSize: 30,
              fontWeight: 600,
            }}
          >
            {p.is_linchpin ? (
              <div
                style={{
                  display: 'flex',
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: '#fbbf24',
                }}
              />
            ) : null}
            <span>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
