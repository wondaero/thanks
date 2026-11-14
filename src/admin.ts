import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

const KEY = 'chat:admin'

/**
 * none     : 일반 사용자
 * checking : 서버 확인 중
 * ok       : 관리자
 */
export type AdminStatus = 'none' | 'checking' | 'ok'
type VerifyResult = 'ok' | 'invalid' | 'locked'

const MESSAGES: Record<Exclude<VerifyResult, 'ok'>, string> = {
  invalid: '관리자 인증에 실패했습니다.',
  locked: '시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.',
}

/**
 * `?admin=<값>`에서 값을 꺼내고 URL에서는 즉시 제거
 * (관리자 주소가 주소창에 남아 그대로 공유되는 실수 방지).
 * 값이 없으면 같은 탭에서 이전에 통과한 값을 사용.
 */
// URL은 한 번 읽으면 지워지므로 결과를 모듈에 보관 (StrictMode의 초기화 함수 이중 호출 대비)
let urlSecret: string | null | undefined

function takeSecret(): string | null {
  if (urlSecret === undefined) {
    const url = new URL(window.location.href)
    urlSecret = url.searchParams.get('admin') || null
    if (url.searchParams.has('admin')) {
      url.searchParams.delete('admin')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  }
  return urlSecret ?? sessionStorage.getItem(KEY)
}

/**
 * 관리자 모드. 실제 권한 검사는 전부 DB 함수(admin_verify / admin_delete_messages)에서 함.
 * 클라이언트의 status는 UI 표시용일 뿐, 우회해도 삭제는 불가능.
 */
export function useAdmin(authReady: boolean) {
  const [secret, setSecret] = useState<string | null>(takeSecret)
  const [status, setStatus] = useState<AdminStatus>(() => (secret ? 'checking' : 'none'))
  const [notice, setNotice] = useState<string | null>(null)

  const fail = useCallback((msg: string) => {
    sessionStorage.removeItem(KEY)
    setSecret(null)
    setStatus('none')
    setNotice(msg)
  }, [])

  useEffect(() => {
    if (!authReady || status !== 'checking' || !secret) return
    let cancelled = false
    supabase.rpc('admin_verify', { p_secret: secret }).then(({ data, error }) => {
      if (cancelled) return
      if (error) return fail(error.message)
      const r = data as VerifyResult
      if (r === 'ok') {
        sessionStorage.setItem(KEY, secret)
        setStatus('ok')
      } else {
        fail(MESSAGES[r])
      }
    })
    return () => {
      cancelled = true
    }
  }, [authReady, status, secret, fail])

  const exit = useCallback(() => {
    sessionStorage.removeItem(KEY)
    setSecret(null)
    setStatus('none')
    setNotice(null)
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  const deleteMessages = useCallback(
    async (ids: number[]): Promise<number> => {
      if (!secret) throw new Error('관리자 모드가 아닙니다')
      const { data, error } = await supabase.rpc('admin_delete_messages', {
        p_secret: secret,
        p_ids: ids,
      })
      if (error) throw new Error(error.message)
      if (data === null) {
        // 그 사이 서버의 비밀번호 규칙이 바뀐 경우
        fail('관리자 인증이 만료되었습니다.')
        throw new Error('삭제하지 못했습니다.')
      }
      return data as number
    },
    [secret, fail],
  )

  return { isAdmin: status === 'ok', status, notice, dismissNotice, exit, deleteMessages }
}
