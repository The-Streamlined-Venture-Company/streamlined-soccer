
create or replace function soccer.get_jwt_secret() returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'jwt_secret' limit 1;
$$;

revoke execute on function soccer.get_jwt_secret() from public, anon, authenticated;
grant  execute on function soccer.get_jwt_secret() to service_role;
;
