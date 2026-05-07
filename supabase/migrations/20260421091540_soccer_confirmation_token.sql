
alter table soccer.weekly_sessions
  add column if not exists confirmation_token text unique;
create index if not exists weekly_sessions_confirmation_token_idx on soccer.weekly_sessions (confirmation_token);
;
