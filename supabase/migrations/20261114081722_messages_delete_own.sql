-- 작성자 본인은 (같은 익명 세션이 살아있는 동안) 자기 글을 삭제할 수 있음.
-- 세션이 끝나면 새 익명 uid가 되므로 이전 글은 더 이상 삭제 불가.
drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
  on public.messages for delete
  to authenticated
  using (user_id = auth.uid());
