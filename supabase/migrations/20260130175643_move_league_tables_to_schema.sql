
-- Create league schema
CREATE SCHEMA IF NOT EXISTS league;

-- Move all Football League tables from public to league schema (if they exist).
-- IF EXISTS makes this safe to apply to a fresh project where the legacy
-- "Football League" tables were never created.
-- Foreign keys will automatically follow the tables.

ALTER TABLE IF EXISTS public.profiles SET SCHEMA league;
ALTER TABLE IF EXISTS public.leagues SET SCHEMA league;
ALTER TABLE IF EXISTS public.teams SET SCHEMA league;
ALTER TABLE IF EXISTS public.matches SET SCHEMA league;
ALTER TABLE IF EXISTS public.team_players SET SCHEMA league;
ALTER TABLE IF EXISTS public.match_events SET SCHEMA league;
ALTER TABLE IF EXISTS public.manager_invites SET SCHEMA league;
ALTER TABLE IF EXISTS public.table_standings SET SCHEMA league;
ALTER TABLE IF EXISTS public.league_settings SET SCHEMA league;
ALTER TABLE IF EXISTS public.match_reports SET SCHEMA league;
ALTER TABLE IF EXISTS public.match_notes SET SCHEMA league;
