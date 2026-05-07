
-- Per-week instance of a recurring session_schedule.
-- Captures state as the runtime walks through the week's workflow.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on t.typnamespace = n.oid
                 where n.nspname = 'soccer' and t.typname = 'weekly_session_state') then
    create type soccer.weekly_session_state as enum (
      'pending',                -- created, nothing fired yet
      'confirmation_sent',      -- DM'd organiser the yes/no
      'confirmation_declined',  -- organiser said no, week skipped
      'callout_sent',           -- group poll posted
      'followup_sent',          -- in-poll follow-up DMs sent
      'morning_nudge_sent',
      'teams_pending_approval', -- lineup created, approval DM out
      'teams_posted',           -- teams in the group
      'mom_sent',               -- MoM poll posted
      'mom_closed',             -- results announced
      'cancelled'               -- something killed it (org disabled, manual override)
    );
  end if;
end $$;

create table if not exists soccer.weekly_sessions (
  id uuid primary key default gen_random_uuid(),
  session_schedule_id uuid not null references soccer.session_schedules(id) on delete cascade,

  -- Logical "match date" — the kickoff date for this week's instance
  match_date date not null,
  kickoff_at timestamptz not null,             -- pre-computed in org timezone, stored as UTC

  state soccer.weekly_session_state not null default 'pending',

  -- Bookkeeping references to the WhatsApp messages we sent
  confirmation_message_id text,
  confirmation_chat_jid text,
  callout_message_id text,
  callout_chat_jid text,
  followup_dm_count int not null default 0,
  morning_nudge_message_id text,
  lineup_id uuid references soccer.lineups(id) on delete set null,
  team_post_message_id text,
  mom_message_id text,
  mom_results_message_id text,

  -- Counts (cached from poll results, refreshed each tick)
  signups_in int not null default 0,
  signups_out int not null default 0,
  signups_maybe int not null default 0,

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Each schedule can only have one weekly_session per match_date
  unique (session_schedule_id, match_date)
);

create index if not exists weekly_sessions_state_idx on soccer.weekly_sessions (state);
create index if not exists weekly_sessions_kickoff_idx on soccer.weekly_sessions (kickoff_at);

-- Append-only event log so we can debug & audit every runtime decision
create table if not exists soccer.runtime_events (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  session_schedule_id uuid references soccer.session_schedules(id) on delete set null,
  weekly_session_id uuid references soccer.weekly_sessions(id) on delete set null,
  /** What kind of event: 'tick' | 'decided' | 'sent' | 'skipped' | 'error' | 'state_change' */
  kind text not null,
  /** Short human-readable summary */
  summary text not null,
  /** Optional structured payload (decision details, message ids, errors) */
  details jsonb
);

create index if not exists runtime_events_occurred_idx
  on soccer.runtime_events (occurred_at desc);
create index if not exists runtime_events_schedule_idx
  on soccer.runtime_events (session_schedule_id, occurred_at desc);

alter table soccer.weekly_sessions enable row level security;
alter table soccer.runtime_events enable row level security;

create policy "organisers_read_weekly_sessions" on soccer.weekly_sessions
  for select using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role in ('admin','organiser')
    )
  );

create policy "organisers_write_weekly_sessions" on soccer.weekly_sessions
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

create policy "organisers_read_runtime_events" on soccer.runtime_events
  for select using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role in ('admin','organiser')
    )
  );

-- updated_at trigger
create or replace function soccer.set_weekly_sessions_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_weekly_sessions_updated_at on soccer.weekly_sessions;
create trigger tr_weekly_sessions_updated_at
  before update on soccer.weekly_sessions
  for each row execute function soccer.set_weekly_sessions_updated_at();
;
