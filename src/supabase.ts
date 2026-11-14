import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error('.env에 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY를 설정하세요.')
}

export const supabase = createClient(url, key, {
  auth: {
    // 핵심: 세션을 sessionStorage에 저장
    // → 같은 탭에서 새로고침해도 "내 글" 유지
    // → 탭/브라우저를 닫고 다시 오면 새 익명 사용자 = 이전 글은 남의 글
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
})

export type Message = {
  id: number
  user_id: string
  name: string
  content: string
  created_at: string
}

let pending: Promise<string> | null = null

/**
 * 현재 세션의 익명 사용자 id를 반환 (없으면 익명 로그인).
 * 동시 호출(StrictMode 이중 실행 등)에도 익명 유저가 하나만 생기도록 Promise를 공유.
 */
export function ensureAnonUser(): Promise<string> {
  pending ??= (async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session.user.id

    const { data: signIn, error } = await supabase.auth.signInAnonymously()
    if (error || !signIn.user) throw error ?? new Error('익명 로그인 실패')
    return signIn.user.id
  })().catch((e) => {
    pending = null // 실패 시 재시도 가능하게
    throw e
  })
  return pending
}
