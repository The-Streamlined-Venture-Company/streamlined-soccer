
alter table soccer.session_schedules
  add column if not exists nudge_enabled boolean not null default true,
  add column if not exists nudge_days_before int not null default 0
    check (nudge_days_before between 0 and 14),
  add column if not exists nudge_time time not null default '09:00';

alter table soccer.session_schedules
  drop column if exists morning_nudge_enabled,
  drop column if exists morning_nudge_time,
  drop column if exists followup_nudge_enabled,
  drop column if exists followup_threshold_low,
  drop column if exists followup_threshold_high;
;
