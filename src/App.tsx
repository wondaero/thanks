import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ensureAnonUser, supabase, type Message } from './supabase'
import { useAdmin } from './admin'
import { AdminLogin } from './AdminLogin'

const PAGE_SIZE = 50
/** 맨 위에서 이 거리(px) 안으로 들어오면 이전 글을 미리 불러옴 */
const LOAD_THRESHOLD = 200
const NAME_KEY = 'chat:name'

const fmt = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** id 기준 중복 제거 + 시간순 정렬 (초기 로드·페이지 로드·실시간 이벤트가 겹칠 수 있음) */
function merge(prev: Message[], incoming: Message[]): Message[] {
  const map = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.id - b.id)
}

/**
 * 커서(keyset) 페이지네이션: beforeId보다 오래된 글을 최신순으로 PAGE_SIZE개.
 * offset 방식과 달리 그 사이 새 글이 들어와도 중복·누락이 없고, PK 인덱스만 타서 글이 많아도 빠름.
 */
async function fetchPage(beforeId?: number) {
  let q = supabase.from('messages').select('*').order('id', { ascending: false }).limit(PAGE_SIZE)
  if (beforeId !== undefined) q = q.lt('id', beforeId)
  const { data, error } = await q
  return { data: (data ?? []).reverse() as Message[], error }
}

export default function App() {
  const [myId, setMyId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [name, setName] = useState(() => sessionStorage.getItem(NAME_KEY) ?? '')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)

  const admin = useAdmin(myId !== null)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [deleting, setDeleting] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  /** 이전 글을 앞에 붙이기 직전의 스크롤 상태. 붙인 뒤 보던 위치를 그대로 유지하는 데 사용 */
  const prependAnchor = useRef<{ height: number; top: number } | null>(null)
  const initialLoaded = useRef(false)
  const loadingRef = useRef(false)
  const hasMoreRef = useRef(true)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const removeIds = useCallback((ids: number[]) => {
    const gone = new Set(ids)
    setMessages((prev) => prev.filter((m) => !gone.has(m.id)))
    setSelected((prev) => {
      if (![...prev].some((id) => gone.has(id))) return prev
      return new Set([...prev].filter((id) => !gone.has(id)))
    })
  }, [])

  const loadOlder = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return
    loadingRef.current = true
    setLoadingOlder(true)

    const before = messagesRef.current[0]?.id
    const { data, error } = await fetchPage(before)

    if (error) {
      setError(error.message)
    } else {
      const el = listRef.current
      if (el && before !== undefined) {
        prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop }
      }
      hasMoreRef.current = data.length === PAGE_SIZE
      setHasMore(hasMoreRef.current)
      setMessages((prev) => merge(prev, data))
    }
    loadingRef.current = false
    setLoadingOlder(false)
  }, [])

  // 1) 익명 세션 확보 → 2) 실시간 구독 → 3) 구독 성공 후 최신 페이지 로드
  //    (구독을 먼저 해야 로드와 구독 사이에 들어온 메시지를 놓치지 않음)
  useEffect(() => {
    let cancelled = false

    // 토픽명은 마운트마다 고유하게 (StrictMode 이중 마운트 시 채널 재사용 충돌 방지).
    // postgres_changes는 토픽명과 무관하게 테이블 이벤트를 받음
    const channel = supabase
      .channel(`room:main:${crypto.randomUUID()}`)
      .on<Message>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => setMessages((prev) => merge(prev, [payload.new])),
      )
      .on<Message>(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        // DELETE 이벤트의 old 레코드에는 PK만 담겨 옴 (replica identity default)
        (payload) => {
          const id = payload.old.id
          if (typeof id === 'number') removeIds([id])
        },
      )

    ;(async () => {
      try {
        const uid = await ensureAnonUser()
        if (cancelled) return
        setMyId(uid)

        channel.subscribe(async (s) => {
          if (s === 'SUBSCRIBED') {
            setStatus('live')
            if (!initialLoaded.current) {
              await loadOlder()
              initialLoaded.current = true
            } else {
              // 재연결: 끊긴 동안 놓친 최신 글을 보충 (hasMore 등 페이지 상태는 건드리지 않음)
              const { data, error } = await fetchPage()
              if (!cancelled && !error) setMessages((prev) => merge(prev, data))
            }
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
            setStatus('error')
          }
        })
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [loadOlder, removeIds])

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return

    if (prependAnchor.current) {
      // 위에 붙은 만큼 내려서 보던 글이 제자리에 있도록
      const { height, top } = prependAnchor.current
      el.scrollTop = top + (el.scrollHeight - height)
      prependAnchor.current = null
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }

    // 화면이 아직 안 찼거나 여전히 맨 위 근처면 이어서 로드
    if (initialLoaded.current && hasMoreRef.current && el.scrollTop < LOAD_THRESHOLD) {
      void loadOlder()
    }
  }, [messages, loadOlder])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (initialLoaded.current && el.scrollTop < LOAD_THRESHOLD) void loadOlder()
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const text = content.trim()
    if (!text || sending || !myId) return

    setSending(true)
    setError(null)
    const trimmedName = name.trim()
    sessionStorage.setItem(NAME_KEY, trimmedName)

    const { data, error } = await supabase
      .from('messages')
      // user_id는 보내지 않음: DB default(auth.uid()) + RLS가 보장
      .insert(trimmedName ? { name: trimmedName, content: text } : { content: text })
      .select()
      .single()

    setSending(false)
    if (error) {
      setError(error.message)
      return
    }
    stickToBottom.current = true
    setMessages((prev) => merge(prev, [data as Message]))
    setContent('')
  }

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onDeleteSelected = async () => {
    const ids = [...selected]
    if (ids.length === 0 || deleting) return
    if (!window.confirm(`선택한 ${ids.length}개의 글을 삭제할까요? 되돌릴 수 없습니다.`)) return

    setDeleting(true)
    setError(null)
    try {
      await admin.deleteMessages(ids)
      removeIds(ids) // 다른 접속자에게는 Realtime DELETE 이벤트로 반영됨
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  /** 본인 글 삭제. 권한은 RLS(messages_delete_own)가 검사 */
  const onDeleteOwn = async (id: number) => {
    if (!window.confirm('이 글을 삭제할까요?')) return
    setError(null)
    const { data, error } = await supabase.from('messages').delete().eq('id', id).select('id')
    if (error) setError(error.message)
    else if (!data || data.length === 0) setError('삭제할 수 없는 글입니다.') // 세션이 바뀐 경우 등
    else removeIds([id])
  }

  const exitAdmin = () => {
    setSelected(new Set())
    admin.exit()
  }

  return (
    <div className="app">
      <header className="header">
        <h1>One Room</h1>
        <span className={`status status--${status}`}>
          {status === 'live' ? '연결됨' : status === 'connecting' ? '연결 중…' : '연결 오류'}
        </span>
      </header>

      {admin.isAdmin && (
        <div className="adminbar">
          <strong>관리자 모드</strong>
          <span className="adminbar__count">{selected.size}개 선택</span>
          <button type="button" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            선택 해제
          </button>
          <button
            type="button"
            className="danger"
            onClick={onDeleteSelected}
            disabled={selected.size === 0 || deleting}
          >
            {deleting ? '삭제 중…' : '선택 삭제'}
          </button>
          <button type="button" className="adminbar__exit" onClick={exitAdmin}>
            나가기
          </button>
        </div>
      )}
      {(admin.status === 'prompt' || admin.status === 'submitting') && (
        <AdminLogin
          checking={admin.status === 'submitting'}
          disabled={!myId}
          notice={admin.notice}
          onSubmit={admin.submit}
          onCancel={admin.exit}
        />
      )}

      <div className="list" ref={listRef} onScroll={onScroll}>
        <div className="loader">
          {loadingOlder ? '이전 글 불러오는 중…' : !hasMore && messages.length > 0 ? '처음 글입니다' : ''}
        </div>
        {messages.length === 0 && status === 'live' && !loadingOlder && (
          <p className="empty">아직 메시지가 없어요. 첫 글을 남겨보세요.</p>
        )}
        {messages.map((m) => {
          const mine = m.user_id === myId
          const isSelected = selected.has(m.id)
          return (
            <div
              key={m.id}
              className={`msg ${mine ? 'msg--mine' : ''} ${admin.isAdmin ? 'msg--selectable' : ''} ${
                isSelected ? 'msg--selected' : ''
              }`}
              onClick={admin.isAdmin ? () => toggleSelect(m.id) : undefined}
            >
              <div className="meta">
                {admin.isAdmin && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(m.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${m.name}의 글 선택`}
                  />
                )}
                <strong>{m.name}</strong>
                <time dateTime={m.created_at}>{fmt.format(new Date(m.created_at))}</time>
                {mine && !admin.isAdmin && (
                  <button type="button" className="msg__delete" onClick={() => onDeleteOwn(m.id)}>
                    삭제
                  </button>
                )}
              </div>
              <div className="bubble">{m.content}</div>
            </div>
          )
        })}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <input
          className="name"
          placeholder="이름 (비우면 익명)"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="content"
          placeholder="내용을 입력하세요"
          maxLength={500}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={!content.trim() || sending || !myId}>
          등록
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
