
-- New default: weekly confirmation enabled, 1 day before at 16:00
alter table soccer.session_schedules
  alter column confirmation_enabled set default true,
  alter column confirmation_time set default '16:00',
  alter column confirmation_days_before set default 1;

-- Backfill existing rows that didn't have a time set
update soccer.session_schedules
   set confirmation_time = '16:00'
 where confirmation_time is null;
;
