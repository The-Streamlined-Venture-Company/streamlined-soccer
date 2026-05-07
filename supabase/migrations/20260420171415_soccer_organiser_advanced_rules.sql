
-- Per-match confirmation step (organiser gets a yes/no before the poll fires)
alter table soccer.organiser_config
  add column if not exists confirmation_enabled boolean not null default false,
  add column if not exists confirmation_dow int check (confirmation_dow between 0 and 6),
  add column if not exists confirmation_time time,
  -- Follow-up nudge thresholds (distinct from cancel threshold)
  add column if not exists followup_nudge_enabled boolean not null default true,
  add column if not exists followup_threshold_low int not null default 9 check (followup_threshold_low between 0 and 50),
  add column if not exists followup_threshold_high int not null default 12 check (followup_threshold_high between 0 and 50);

-- Per-player team preference used by the balancer
create type soccer.team_preference as enum ('any','black','white');

alter table soccer.players
  add column if not exists preferred_team soccer.team_preference not null default 'any';

-- Hard/soft rules between pairs of players
create type soccer.constraint_type as enum ('split','together');

create table if not exists soccer.team_constraints (
  id uuid primary key default gen_random_uuid(),
  type soccer.constraint_type not null,
  player_a_id uuid not null references soccer.players(id) on delete cascade,
  player_b_id uuid not null references soccer.players(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references soccer.app_users(id),
  -- Normalise so (A,B) and (B,A) can't both exist
  check (player_a_id <> player_b_id),
  unique (player_a_id, player_b_id, type)
);

-- Trigger: keep the pair canonicalised (smaller uuid on the left)
create or replace function soccer.canonicalise_constraint_pair()
returns trigger as $$
begin
  if new.player_a_id > new.player_b_id then
    declare tmp uuid := new.player_a_id;
    begin
      new.player_a_id := new.player_b_id;
      new.player_b_id := tmp;
    end;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_canonicalise_constraint_pair on soccer.team_constraints;
create trigger tr_canonicalise_constraint_pair
  before insert or update on soccer.team_constraints
  for each row execute function soccer.canonicalise_constraint_pair();

alter table soccer.team_constraints enable row level security;

create policy "organisers_read_constraints" on soccer.team_constraints
  for select using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role in ('admin','organiser')
    )
  );

create policy "organisers_write_constraints" on soccer.team_constraints
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

create index if not exists team_constraints_player_a_idx on soccer.team_constraints (player_a_id);
create index if not exists team_constraints_player_b_idx on soccer.team_constraints (player_b_id);
;
