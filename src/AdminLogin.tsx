import { FormEvent, useState } from 'react'

type Props = {
  checking: boolean
  disabled: boolean
  notice: string | null
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function AdminLogin({ checking, disabled, notice, onSubmit, onCancel }: Props) {
  const [pw, setPw] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!pw || checking || disabled) return
    onSubmit(pw)
    setPw('')
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="admin-login-title">
      <form className="modal__panel" onSubmit={submit}>
        <h2 id="admin-login-title">관리자 로그인</h2>
        <input
          type="password"
          autoComplete="off"
          placeholder="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
        />
        {notice && <p className="modal__notice">{notice}</p>}
        <div className="modal__actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="primary" disabled={!pw || checking || disabled}>
            {checking ? '확인 중…' : '확인'}
          </button>
        </div>
      </form>
    </div>
  )
}
