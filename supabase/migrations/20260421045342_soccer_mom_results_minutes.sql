
-- Convert mom_results_post_hours → mom_results_post_minutes for finer control.
-- Backfill: minutes = hours * 60. Default 60 (one hour voting window).

alter table soccer.session_schedules
  add column if not exists mom_results_post_minutes int not null default 60
    check (mom_results_post_minutes between 0 and 10080);  -- 0..168h

update soccer.session_schedules
   set mom_results_post_minutes = greatest(0, coalesce(mom_results_post_hours, 1) * 60)
 where mom_results_post_hours is not null;

alter table soccer.session_schedules
  drop column if exists mom_results_post_hours;
;
