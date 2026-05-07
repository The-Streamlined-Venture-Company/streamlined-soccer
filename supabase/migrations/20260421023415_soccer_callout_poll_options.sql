
alter table soccer.session_schedules
  add column if not exists callout_poll_options text[] not null
    default array['In ✅', 'Out ❌', 'Maybe 🤔']::text[];
;
