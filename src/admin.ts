import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

const KEY = 'chat:admin'

/**
 * none     : 일반 사용자
 * prompt   : 비밀번호 입력창 표시 중
 * submitting : 입력한 비밀번호 서버 확인 중 (입력창 유지)
 * checking : 새로고침 후 저장된 비밀번호 재확인 중 (입력창 없음)
 * ok       : 관리자
 */
export type AdminStatus = 'none' | 'prompt' | 'submitting' | 'checking' | 'ok'
type VerifyResult = 'ok' | 'invalid' | 'locked'

/** `?admin`이 있으면 입력창을 띄울 대상. 값이 붙어 있어도 쓰지 않고 URL에서 제거 */
function takeAdminFlagFromUrl(): boolean {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('admin')) return false
  url.searchParams.delete('admin')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return true
}

const MESSAGES: Record<Exclude<VerifyResult, 'ok'>, string> = {
  invalid: '비밀번호가 올바르지 않습니다.',
  locked: '시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.',
}

/**
 * 관리자 모드. 실제 권한 검사는 전부 DB 함수(admin_verify / admin_delete_messages)에서 함.
 * 클라이언트의 status는 UI 표시용일 뿐, 우회해도 삭제는 불가능.
 */
export function useAdmin(authReady: boolean) {
  const [wantsAdmin] = useState(takeAdminFlagFromUrl)
  const [secret, setSecret] = useState<string | null>(() => sessionStorage.getItem(KEY))
  const [status, setStatus] = useState<AdminStatus>(() =>
    sessionStorage.getItem(KEY) ? 'checking' : wantsAdmin ? 'prompt' : 'none',
  )
  const [notice, setNotice] = useState<string | null>(null)

  const verify = useCallback(async (pw: string): Promise<VerifyResult> => {
    const { data, error } = await supabase.rpc('admin_verify', { p_secret: pw })
    if (error) throw new Error(error.message)
    return data as VerifyResult
  }, [])

  /** 비밀번호가 무효해졌을 때(관리자가 비밀번호를 바꾼 경우 등) 관리자 모드를 내리고 입력창으로 */
  const expire = useCallback((msg: string) => {
    sessionStorage.removeItem(KEY)
    setSecret(null)
    setNotice(msg)
    setStatus('prompt')
  }, [])

  // 같은 탭에서 새로고침한 경우: 저장된 비밀번호가 아직 유효한지 서버에 재확인
  useEffect(() => {
    if (!authReady || status !== 'checking' || !secret) return
    let cancelled = false
    verify(secret)
      .then((r) => {
        if (cancelled) return
        if (r === 'ok') setStatus('ok')
        else expire('비밀번호가 변경되었습니다. 다시 입력하세요.')
      })
      .catch((e) => !cancelled && expire(e.message))
    return () => {
      cancelled = true
    }
  }, [authReady, status, secret, verify, expire])

  const submit = useCallback(
    async (pw: string) => {
      setStatus('submitting')
      setNotice(null)
      try {
        const r = await verify(pw)
        if (r === 'ok') {
          sessionStorage.setItem(KEY, pw)
          setSecret(pw)
          setStatus('ok')
        } else {
          setNotice(MESSAGES[r])
          setStatus('prompt')
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e))
        setStatus('prompt')
      }
    },
    [verify],
  )

  const exit = useCallback(() => {
    sessionStorage.removeItem(KEY)
    setSecret(null)
    setNotice(null)
    setStatus('none')
  }, [])

  const deleteMessages = useCallback(
    async (ids: number[]): Promise<number> => {
      if (!secret) throw new Error('관리자 모드가 아닙니다')
      const { data, error } = await supabase.rpc('admin_delete_messages', {
        p_secret: secret,
        p_ids: ids,
      })
      if (error) throw new Error(error.message)
      if (data === null) {
        // 그 사이 비밀번호가 변경된 경우
        expire('비밀번호가 변경되었습니다. 다시 입력하세요.')
        throw new Error('삭제하지 못했습니다. 비밀번호를 다시 입력하세요.')
      }
      return data as number
    },
    [secret, expire],
  )

  return {
    isAdmin: status === 'ok',
    status,
    notice,
    submit,
    exit,
    deleteMessages,
  }
}
