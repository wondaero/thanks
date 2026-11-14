-- 관리자 비밀번호를 고정값으로 변경. DB에는 bcrypt 해시만 저장하고 평문은 저장소에 두지 않음.
-- 비밀번호 설정/변경 (Supabase 대시보드 > SQL Editor에서 실행):
--   insert into private.admin_secret (hash)
--   values (extensions.crypt('<비밀번호>', extensions.gen_salt('bf', 10)))
--   on conflict (id) do update set hash = excluded.hash;
-- 해시가 설정되기 전까지는 어떤 값을 넣어도 통과하지 않음.

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.admin_secret (
  id   boolean primary key default true check (id),  -- 항상 1행만
  hash text    not null
);

-- 'ok' | 'invalid' | 'locked'  (잠금 규칙은 이전과 동일)
create or replace function private.admin_check(p_secret text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_ip text := private.client_ip();
begin
  delete from private.admin_attempts where at < now() - interval '1 day';

  if (select count(*) from private.admin_attempts
        where ip = v_ip and at > now() - interval '15 minutes') >= 5
     or (select count(*) from private.admin_attempts
        where at > now() - interval '1 hour') >= 50 then
    return 'locked';
  end if;

  if exists (
    select 1 from private.admin_secret s
    where s.hash = extensions.crypt(p_secret, s.hash)
  ) then
    return 'ok';
  end if;

  insert into private.admin_attempts (ip) values (v_ip);
  return 'invalid';
end;
$$;

revoke all on function private.admin_check(text) from public;
