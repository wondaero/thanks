-- 관리자 비밀번호를 "한국시간 오늘 날짜(YYYYMMDD)"로 변경 + 실패 시도 잠금
-- 날짜는 서버(now())에서 계산하므로 클라이언트 시계를 바꿔도 소용없음.

drop function if exists public.admin_verify(text);
drop function if exists public.admin_delete_messages(text, bigint[]);
drop table if exists private.admin_secret;

-- 실패 기록 (잠금 판단용). private 스키마라 API로 노출되지 않음
create table if not exists private.admin_attempts (
  id bigint generated always as identity primary key,
  ip text        not null,
  at timestamptz not null default now()
);
create index if not exists admin_attempts_ip_at_idx on private.admin_attempts (ip, at);
create index if not exists admin_attempts_at_idx on private.admin_attempts (at);

-- 요청자 IP (Supabase API 게이트웨이가 넣어주는 헤더)
create or replace function private.client_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''),
    nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), ''),
    'unknown'
  );
$$;

-- 'ok' | 'invalid' | 'locked'
-- 잠금: 같은 IP 15분 내 5회 실패, 또는 전체 1시간 내 50회 실패(IP를 바꿔가며 시도하는 경우 대비)
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

  if p_secret = to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') then
    return 'ok';
  end if;

  insert into private.admin_attempts (ip) values (v_ip);
  return 'invalid';
end;
$$;

revoke all on function private.client_ip() from public;
revoke all on function private.admin_check(text) from public;

-- 비밀번호 확인 (UI 진입용)
create or replace function public.admin_verify(p_secret text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select private.admin_check(p_secret);
$$;

-- 다중 삭제. 반환: 삭제된 개수, 비밀번호가 틀리면 null
-- (예외를 던지면 트랜잭션이 롤백돼 실패 기록이 사라지므로, 틀린 경우는 null 반환으로 처리)
create or replace function public.admin_delete_messages(p_secret text, p_ids bigint[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text := private.admin_check(p_secret);
  n integer;
begin
  if v_status = 'locked' then
    raise exception '시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요';
  elsif v_status <> 'ok' then
    return null;
  end if;

  if coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception '한 번에 최대 500개까지 삭제할 수 있습니다';
  end if;

  delete from public.messages where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.admin_verify(text) from public, anon;
revoke all on function public.admin_delete_messages(text, bigint[]) from public, anon;
grant execute on function public.admin_verify(text) to authenticated;
grant execute on function public.admin_delete_messages(text, bigint[]) to authenticated;
