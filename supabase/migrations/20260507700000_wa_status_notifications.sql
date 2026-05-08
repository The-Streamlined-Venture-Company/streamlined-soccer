-- =============================================================================
-- WhatsApp connection-state visibility:
--   1. Add `notify_topic` to clubs — an ntfy.sh topic the relay can push to
--      when the connection state changes. Optional; null = no push.
--   2. Add `log_wa_state` SECURITY DEFINER RPC — relay calls it on every
--      connection-state change. Writes a runtime_events row scoped to the
--      caller's club + returns the notify_topic so the relay can fire a
--      separate HTTP request to ntfy.sh from its end.
--   3. Add `latest_wa_state(p_club_id uuid)` view-style helper RPC the
--      frontend uses to render the connection-state banner.
-- =============================================================================

ALTER TABLE soccer.clubs
  ADD COLUMN IF NOT EXISTS notify_topic text;

COMMENT ON COLUMN soccer.clubs.notify_topic IS
  'Optional ntfy.sh topic. When set, the relay pushes an HTTP POST to https://ntfy.sh/<topic> on every WhatsApp connection-state change so the organiser gets a phone notification.';

-- ── log_wa_state ────────────────────────────────────────────────────────────
-- Called by the relay (with service role key) when a tenant's WhatsApp
-- connection state changes. Writes a runtime_event scoped to the user's
-- first owned/organised club, returns the notify_topic for that club.
CREATE OR REPLACE FUNCTION soccer.log_wa_state(
  p_user_id   uuid,
  p_state     text,
  p_phone     text DEFAULT NULL,
  p_extra     jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = soccer, public
AS $$
DECLARE
  v_club_id uuid;
  v_topic   text;
BEGIN
  -- Find the user's first club (owner or organiser). Multi-club extension later.
  SELECT cm.club_id INTO v_club_id
    FROM soccer.club_members cm
   WHERE cm.user_id = p_user_id
     AND cm.role IN ('owner', 'organiser')
   ORDER BY cm.role
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_club');
  END IF;

  INSERT INTO soccer.runtime_events (club_id, kind, summary, details)
  VALUES (
    v_club_id,
    'wa_state',
    'WhatsApp ' || p_state || (CASE WHEN p_phone IS NOT NULL THEN ' (' || p_phone || ')' ELSE '' END),
    jsonb_build_object('state', p_state, 'phone', p_phone, 'user_id', p_user_id) || COALESCE(p_extra, '{}'::jsonb)
  );

  SELECT notify_topic INTO v_topic
    FROM soccer.clubs
   WHERE id = v_club_id;

  RETURN jsonb_build_object('ok', true, 'club_id', v_club_id, 'notify_topic', v_topic);
END;
$$;

GRANT EXECUTE ON FUNCTION soccer.log_wa_state(uuid, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION soccer.log_wa_state(uuid, text, text, jsonb) IS
  'Relay-side hook: log a WhatsApp connection-state change. Returns the notify_topic so the relay can push to ntfy.sh.';

-- ── latest_wa_state ─────────────────────────────────────────────────────────
-- Frontend hook: returns the most recent wa_state event for the caller's first
-- club so the connection banner can render. RLS-protected via the underlying
-- runtime_events table.
CREATE OR REPLACE FUNCTION soccer.latest_wa_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = soccer, public
AS $$
DECLARE
  v_event RECORD;
BEGIN
  SELECT re.club_id, re.summary, re.details, re.occurred_at
    INTO v_event
    FROM soccer.runtime_events re
    JOIN soccer.club_members cm ON cm.club_id = re.club_id
   WHERE re.kind = 'wa_state'
     AND cm.user_id = auth.uid()
   ORDER BY re.occurred_at DESC
   LIMIT 1;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('state', 'unknown');
  END IF;

  RETURN jsonb_build_object(
    'state',       v_event.details->>'state',
    'phone',       v_event.details->>'phone',
    'occurred_at', to_char(v_event.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSTZH:TZM'),
    'club_id',     v_event.club_id,
    'summary',     v_event.summary
  );
END;
$$;

GRANT EXECUTE ON FUNCTION soccer.latest_wa_state() TO authenticated;

COMMENT ON FUNCTION soccer.latest_wa_state() IS
  'Frontend hook: returns the most recent WhatsApp connection-state event for the caller. Used to render the disconnect banner.';
