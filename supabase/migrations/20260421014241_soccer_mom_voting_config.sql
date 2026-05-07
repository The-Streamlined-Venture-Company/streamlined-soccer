
alter table soccer.organiser_config
  add column if not exists mom_enabled boolean not null default true,
  add column if not exists match_duration_minutes int not null default 60
    check (match_duration_minutes between 5 and 480),
  add column if not exists mom_delay_minutes int not null default 0
    check (mom_delay_minutes between 0 and 1440),
  add column if not exists mom_method text not null default 'auto'
    check (mom_method in ('auto','whatsapp_poll','web_link')),
  add column if not exists mom_results_post_hours int not null default 24
    check (mom_results_post_hours between 0 and 168);
;
