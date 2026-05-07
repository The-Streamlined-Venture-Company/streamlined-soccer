
alter table soccer.session_schedules
  add column if not exists team_gen_instructions text;
;
