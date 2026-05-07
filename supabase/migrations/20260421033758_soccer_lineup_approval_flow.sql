
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on t.typnamespace = n.oid
                 where n.nspname = 'soccer' and t.typname = 'lineup_status') then
    create type soccer.lineup_status as enum (
      'draft','pending_approval','confirmed','rejected','posted','expired'
    );
  end if;
end $$;

alter table soccer.lineups
  add column if not exists approval_token text unique,
  add column if not exists status soccer.lineup_status not null default 'draft',
  add column if not exists session_schedule_id uuid references soccer.session_schedules(id) on delete set null,
  add column if not exists match_date date,
  add column if not exists approved_by uuid references soccer.app_users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists posted_at timestamptz,
  add column if not exists rejection_reason text;

create index if not exists lineups_approval_token_idx on soccer.lineups (approval_token);
create index if not exists lineups_status_idx on soccer.lineups (status);

alter table soccer.lineups enable row level security;

drop policy if exists "organisers_read_lineups" on soccer.lineups;
create policy "organisers_read_lineups" on soccer.lineups
  for select using (
    exists (
      select 1 from soccer.app_users u
      where u.id = auth.uid() and u.role in ('admin','organiser')
    )
  );

drop policy if exists "organisers_write_lineups" on soccer.lineups;
create policy "organisers_write_lineups" on soccer.lineups
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
;
