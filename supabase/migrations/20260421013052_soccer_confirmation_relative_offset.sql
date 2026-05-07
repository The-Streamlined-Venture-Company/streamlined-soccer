
-- Replace absolute confirmation_dow with a relative offset from the weekly call-out.
-- Behaviour: if no response by call-out time, the call-out fires anyway.
alter table soccer.organiser_config
  drop column if exists confirmation_dow,
  add column if not exists confirmation_days_before int not null default 1
    check (confirmation_days_before between 0 and 14);
;
