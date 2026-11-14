# One Room Chat

방 하나짜리 실시간 채팅. 계정 없이 접속하며, **같은 브라우저 탭 세션 동안만** 내 글이 오른쪽에 표시됩니다.

## 스택
- Vite + React + TypeScript
- Supabase Postgres (메시지 저장) + Realtime (웹소켓) + Anonymous Auth (세션 식별)

## 실행
```bash
npm install
cp .env.example .env   # URL / publishable key 입력 (이미 있으면 생략)
npm run dev
```

## 메시지 로딩 (무한 스크롤)
- 최신 50개를 먼저 불러오고, 위로 스크롤해 맨 위 200px 안에 들어오면 이전 50개를 추가로 불러옴
- 커서(keyset) 방식(`id < 가장 오래된 id`)이라 새 글이 계속 들어와도 중복·누락이 없음
- 이전 글을 앞에 붙여도 보던 위치는 그대로 유지됨

## 관리자 모드
`https://<주소>/?admin`으로 접속하면 비밀번호 입력창이 뜹니다.
- 비밀번호: 아무 값이나 **정확히 5글자**면 통과 (서버 DB 함수에서 길이만 검사)
- `?admin` 파라미터는 URL에서 즉시 제거됨. 값을 붙여도(`?admin=...`) 무시함
- 통과하면 탭 세션 동안 유지됨
- 글을 클릭하거나 체크박스로 여러 개 선택한 뒤 **선택 삭제**. 다른 접속자 화면에서도 실시간으로 사라짐
- 권한 검사는 전부 DB 함수(`admin_verify`, `admin_delete_messages`)에서 수행
- 잠금: 같은 IP에서 15분 내 5회 실패, 또는 전체 1시간 내 50회 실패하면 잠김

잠금 즉시 해제:
```bash
supabase db query --linked "delete from private.admin_attempts;"
```

## DB / Auth 설정 관리 (Supabase CLI)
DB 스키마와 Auth 설정은 대시보드가 아니라 코드로 관리합니다.

| 무엇 | 파일 | 원격 적용 |
|---|---|---|
| 테이블·RLS·Realtime | `supabase/migrations/*.sql` | `supabase db push` |
| 익명 로그인 등 Auth 설정 | `supabase/config.toml` | `supabase config push` |

- 연결된 원격 프로젝트: `chat` (`ytpecrqlgfojtrfuscsd`, 서울 리전)
- 스키마 변경은 `supabase migration new <이름>`으로 새 파일을 만들어서 진행 (기존 마이그레이션 수정 금지)
- 이메일 가입은 꺼져 있음 (`[auth.email] enable_signup = false`). 이 앱은 익명 로그인만 사용
- 알려진 이슈: CLI v2.106의 `config push`는 마지막에 Storage 설정 오류(`databasePoolMode`)를 내지만 Auth 설정은 정상 반영됨. CLI 업데이트 시 해소 예상

## "내 글" 판별 방식
- 첫 접속 시 `signInAnonymously()`로 익명 사용자 생성, 세션은 `sessionStorage`에 저장
- 메시지의 `user_id`는 DB가 `auth.uid()`로 채우고, RLS가 `user_id = auth.uid()`만 INSERT 허용 → 남의 이름표로 위장 불가
- 새로고침: 세션 유지 → 내 글 그대로 오른쪽
- 탭/브라우저를 닫고 재접속: 새 익명 사용자 → 이전 글은 왼쪽(남의 글)
- 세션이 살아있는 동안은 내 글 옆 **삭제** 버튼으로 직접 삭제 가능 (RLS `messages_delete_own`). 세션이 바뀌면 삭제 불가
