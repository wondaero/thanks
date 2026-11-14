-- 관리자 비밀번호: 글자 수가 정확히 5자면 통과 (값 자체는 검사하지 않음).
-- 실패(5자가 아닌 입력) 잠금 규칙은 그대로 유지.


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

  if char_length(coalesce(p_secret, '')) = 5 then
    return 'ok';
  end if;

  insert into private.admin_attempts (ip) values (v_ip);
  return 'invalid';
end;
$$;

revoke all on function private.admin_check(text) from public;
