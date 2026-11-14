-- 메시지 테이블 + RLS + Realtime 설정
-- 적용: supabase db push  (익명 로그인은 supabase/config.toml → supabase config push)

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  -- 익명 로그인 세션의 uid. 클라이언트가 보내지 않아도 서버에서 자동으로 채워짐
  user_id     uuid        not null default auth.uid(),
  name        text        not null default '익명'
                check (char_length(btrim(name)) between 1 and 20),
  content     text        not null
                check (char_length(btrim(content)) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

-- RLS: 읽기는 누구나, 쓰기는 "자기 uid로만" 가능 → 남의 글로 위장 불가
alter table public.messages enable row level security;

drop policy if exists "messages_select_all" on public.messages;
create policy "messages_select_all"
  on public.messages for select
  to anon, authenticated
  using (true);

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages for insert
  to authenticated
  with check (user_id = auth.uid());

-- 수정/삭제 정책은 만들지 않음 → 기본 거부

-- Realtime(웹소켓)으로 INSERT 이벤트를 받기 위해 publication에 추가
alter publication supabase_realtime add table public.messages;
