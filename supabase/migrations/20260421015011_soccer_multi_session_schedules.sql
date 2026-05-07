
-- 1. New table: one row per recurring session schedule
create table if not exists soccer.session_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,

  -- Schedule (in the org's timezone)
  kickoff_dow int not null check (kickoff_dow between 0 and 6),
  kickoff_time time not null,
  pitch_label text,

  -- Call-out
  weekly_post_dow int not null check (weekly_post_dow between 0 and 6),
  weekly_post_time time not null,

  -- Confirmation
  confirmation_enabled boolean not null default false,
  confirmation_days_before int not null default 1 check (confirmation_days_before between 0 and 14),
  confirmation_time time,

  -- Reminders
  followup_nudge_enabled boolean not null default true,
  followup_threshold_low int not null default 9 check (followup_threshold_low between 0 and 50),
  followup_threshold_high int not null default 12 check (followup_threshold_high between 0 and 50),
  morning_nudge_enabled boolean not null default true,
  morning_nudge_time time not null default '09:00',
  team_gen_offset_hours numeric(4,2) not null default 2.0 check (team_gen_offset_hours between 0 and 72),

  -- MoM
  mom_enabled boolean not null default true,
  match_duration_minutes int not null default 60 check (match_duration_minutes between 5 and 480),
  mom_delay_minutes int not null default 0 check (mom_delay_minutes between 0 and 1440),
  mom_method text not null default 'auto' check (mom_method in ('auto','whatsapp_poll','web_link')),
  mom_results_post_hours int not null default 24 check (mom_results_post_hours between 0 and 168),

  -- Player counts
  target_players int not null default 14 check (target_players between 2 and 50),
  min_players int not null default 10 check (min_players between 2 and 50),
  allow_plus_ones boolean not null default true,
  plus_ones_count_toward_target boolean not null default false,

  -- WhatsApp target (each session can post to a different group)
  whatsapp_group_jid text,
  whatsapp_group_name text,

  -- Bookkeeping
  last_weekly_post_at timestamptz,
  last_nudge_at timestamptz,
  last_team_gen_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references soccer.app_users(id)
);

-- 2. Seed one row from existing organiser_config so nothing's lost
insert into soccer.session_schedules (
  name, enabled, kickoff_dow, kickoff_time, pitch_label,
  weekly_post_dow, weekly_post_time,
  confirmation_enabled, confirmation_days_before, confirmation_time,
  followup_nudge_enabled, followup_threshold_low, followup_threshold_high,
  morning_nudge_enabled, morning_nudge_time, team_gen_offset_hours,
  mom_enabled, match_duration_minutes, mom_delay_minutes, mom_method, mom_results_post_hours,
  target_players, min_players, allow_plus_ones, plus_ones_count_toward_target,
  whatsapp_group_jid, whatsapp_group_name,
  last_weekly_post_at, last_nudge_at, last_team_gen_at
)
select
  coalesce(nullif(c.pitch_label, ''), 'Weekly session'),
  true,
  c.kickoff_dow, c.kickoff_time, c.pitch_label,
  c.weekly_post_dow, c.weekly_post_time,
  c.confirmation_enabled, c.confirmation_days_before, c.confirmation_time,
  c.followup_nudge_enabled, c.followup_threshold_low, c.followup_threshold_high,
  c.morning_nudge_enabled, c.morning_nudge_time, c.team_gen_offset_hours,
  c.mom_enabled, c.match_duration_minutes, c.mom_delay_minutes, c.mom_method, c.mom_results_post_hours,
  c.target_players, c.min_players, c.allow_plus_ones, c.plus_ones_count_toward_target,
  c.whatsapp_group_jid, c.whatsapp_group_name,
  c.last_weekly_post_at, c.last_nudge_at, c.last_team_gen_at
from soccer.organiser_config c
where c.id = 1
  and not exists (select 1 from soccer.session_schedules);

-- 3. Drop the per-session columns from organiser_config
alter table soccer.organiser_config
  drop column if exists kickoff_dow,
  drop column if exists kickoff_time,
  drop column if exists pitch_label,
  drop column if exists weekly_post_dow,
  drop column if exists weekly_post_time,
  drop column if exists confirmation_enabled,
  drop column if exists confirmation_days_before,
  drop column if exists confirmation_time,
  drop column if exists followup_nudge_enabled,
  drop column if exists followup_threshold_low,
  drop column if exists followup_threshold_high,
  drop column if exists morning_nudge_enabled,
  drop column if exists morning_nudge_time,
  drop column if exists team_gen_offset_hours,
  drop column if exists mom_enabled,
  drop column if exists match_duration_minutes,
  drop column if exists mom_delay_minutes,
  drop column if exists mom_method,
  drop column if exists mom_results_post_hours,
  drop column if exists target_players,
  drop column if exists min_players,
  drop column if exists allow_plus_ones,
  drop column if exists plus_ones_count_toward_target,
  drop column if exists whatsapp_group_jid,
  drop column if exists whatsapp_group_name,
  drop column if exists last_weekly_post_at,
  drop column if exists last_nudge_at,
  drop column if exists last_team_gen_at;

-- 4. RLS
alter table soccer.session_schedules enable row level security;

create policy "organisers_read_session_schedules" on soccer.session_schedules
  for select using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role in ('admin','organiser')
    )
  );

create policy "organisers_write_session_schedules" on soccer.session_schedules
  for all using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role in ('admin','organiser')
    )
  ) with check (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role in ('admin','organiser')
    )
  );

-- 5. updated_at trigger
create or replace function soccer.set_session_schedules_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_session_schedules_updated_at on soccer.session_schedules;
create trigger tr_session_schedules_updated_at
  before update on soccer.session_schedules
  for each row execute function soccer.set_session_schedules_updated_at();
;
