
alter table soccer.organiser_config
  drop column if exists balance_scores,
  drop column if exists mix_positions,
  drop column if exists spread_newbies,
  drop column if exists split_linchpins;
;
