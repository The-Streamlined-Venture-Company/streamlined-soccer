
-- Single-row config table for the auto-organiser settings.
-- One row, singleton pattern enforced by check(id=1).

create table if not exists soccer.organiser_config (
  id int primary key default 1 check (id = 1),

  -- Master switch
  enabled boolean not null default false,

  -- Timezone (IANA)
  timezone text not null default 'Europe/London',

  -- Weekly signup post
  weekly_post_dow int not null default 1 check (weekly_post_dow between 0 and 6),  -- 0=Sun..6=Sat
  weekly_post_time time not null default '18:00',

  -- Kickoff
  kickoff_dow int not null default 4 check (kickoff_dow between 0 and 6),
  kickoff_time time not null default '20:00',
  pitch_label text,

  -- Team generation offset before kickoff
  team_gen_offset_hours numeric(4,2) not null default 2.0 check (team_gen_offset_hours between 0 and 72),

  -- Morning nudge
  morning_nudge_enabled boolean not null default true,
  morning_nudge_time time not null default '09:00',

  -- Player targets
  target_players int not null default 14 check (target_players between 2 and 50),
  min_players int not null default 10 check (min_players between 2 and 50),

  -- Team balancing constraints (weights, 0 = ignore, higher = more important)
  weight_score numeric(5,2) not null default 1.0,
  weight_position numeric(5,2) not null default 8.0,
  weight_newbie numeric(5,2) not null default 5.0,
  weight_linchpin numeric(5,2) not null default 50.0,

  -- Bot identity + target
  bot_persona text not null default 'Pitch Bot',
  whatsapp_group_jid text,             -- set once we know the group JID
  whatsapp_group_name text,             -- display name for reference

  -- Relay connection
  relay_url text,
  relay_connection_name text not null default 'user',  -- 'user' | 'ai' on the relay

  -- +1 / guest policy
  allow_plus_ones boolean not null default true,
  plus_ones_count_toward_target boolean not null default false,

  -- Alert channel for admin
  alert_channel text not null default 'in_app' check (alert_channel in ('in_app','email','whatsapp_dm','push')),

  -- Last-run bookkeeping (for observability; not configurable directly)
  last_weekly_post_at timestamptz,
  last_nudge_at timestamptz,
  last_team_gen_at timestamptz,

  updated_at timestamptz not null default now(),
  updated_by uuid references soccer.app_users(id)
);

alter table soccer.organiser_config enable row level security;

-- Only admins and organisers can read/write the config
create policy "organisers_select_config" on soccer.organiser_config
  for select using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid()
        and u.role in ('admin','organiser')
    )
  );

create policy "organisers_update_config" on soccer.organiser_config
  for update using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid()
        and u.role in ('admin','organiser')
    )
  );

create policy "admins_insert_config" on soccer.organiser_config
  for insert with check (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- Seed a default row (id=1), idempotent
insert into soccer.organiser_config (id) values (1)
on conflict (id) do nothing;

-- updated_at trigger
create or replace function soccer.set_organiser_config_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_organiser_config_updated_at on soccer.organiser_config;
create trigger tr_organiser_config_updated_at
  before update on soccer.organiser_config
  for each row execute function soccer.set_organiser_config_updated_at();
;
