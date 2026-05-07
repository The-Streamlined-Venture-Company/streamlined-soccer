
alter table soccer.session_schedules
  add column if not exists callout_poll_question text not null
    default '⚽ Football {day} at {time}{pitch_suffix}. Need {target}. Are you in?';
;
