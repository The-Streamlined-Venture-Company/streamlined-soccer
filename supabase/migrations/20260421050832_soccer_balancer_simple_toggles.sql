
alter table soccer.organiser_config
  add column if not exists balance_scores boolean not null default true,
  add column if not exists mix_positions boolean not null default true,
  add column if not exists spread_newbies boolean not null default true,
  add column if not exists split_linchpins boolean not null default true;

-- Initialise from existing weights if non-zero (any prior tuning becomes "on")
update soccer.organiser_config
   set balance_scores  = coalesce(weight_score,    0) > 0,
       mix_positions   = coalesce(weight_position, 0) > 0,
       spread_newbies  = coalesce(weight_newbie,   0) > 0,
       split_linchpins = coalesce(weight_linchpin, 0) > 0
 where id = 1;

alter table soccer.organiser_config
  drop column if exists weight_score,
  drop column if exists weight_position,
  drop column if exists weight_newbie,
  drop column if exists weight_linchpin;
;
