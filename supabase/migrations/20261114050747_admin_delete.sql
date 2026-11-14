-- 관리자 삭제 기능
-- 관리자 키는 bcrypt 해시로만 저장하고, 평문은 커밋하지 않음.
-- 키 설정/변경 (SQL Editor 또는 `supabase db query --linked`):
--   insert into private.admin_secret (hash)
--   values (extensions.crypt('<새 키>', extensions.gen_salt('bf', 10)))
--   on conflict (id) do update set hash = excluded.hash;

create extension if not exists pgcrypto with schema extensions;

-- API(PostgREST)로 노출되지 않는 스키마
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_secret (
  id   boolean primary key default true check (id),  -- 항상 1행만
  hash text    not null
);

-- 키 검증: 해시 비교 결과만 반환 (해시 자체는 노출 안 됨)
create or replace function public.admin_verify(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.admin_secret s
    where s.hash = extensions.crypt(p_secret, s.hash)
  );
$$;

-- 다중 삭제: 키가 맞을 때만 실행. RLS에 DELETE 정책이 없으므로 이 함수가 유일한 삭제 경로
create or replace function public.admin_delete_messages(p_secret text, p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.admin_verify(p_secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception '한 번에 최대 500개까지 삭제할 수 있습니다';
  end if;

  delete from public.messages where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 함수는 기본적으로 PUBLIC 실행 권한이 있으므로 회수 후 로그인(익명 포함) 사용자에게만 허용
revoke all on function public.admin_verify(text) from public, anon;
revoke all on function public.admin_delete_messages(text, bigint[]) from public, anon;
grant execute on function public.admin_verify(text) to authenticated;
grant execute on function public.admin_delete_messages(text, bigint[]) to authenticated;
