-- =============================================================================
-- Tri-state destination for the MoM vote-link group post.
--
-- When mom_method = 'web_link', the runtime previously always posted the
-- anonymous vote-link directly to the group. This lets the organiser opt
-- into copy/paste mode (DM me the draft, I'll share it myself) or suppress
-- the post entirely.
-- =============================================================================

ALTER TABLE soccer.session_schedules
  ADD COLUMN IF NOT EXISTS mom_link_destination text NOT NULL DEFAULT 'group';

ALTER TABLE soccer.session_schedules
  ADD CONSTRAINT session_schedules_mom_link_destination_check
    CHECK (mom_link_destination IN ('off', 'group', 'organiser_dm'));

COMMENT ON COLUMN soccer.session_schedules.mom_link_destination IS
  'Where the MoM web-link post lands (when mom_method=web_link). group: bot posts the anonymous vote link to the group. organiser_dm: bot DMs the organiser the link as a draft to copy/paste manually. off: no post — the URL exists in runtime logs if the organiser wants to share it themselves.';
