import { useState } from 'react'

/**
 * 사용자 톤 선택. 선택값은 localStorage에 저장되어 재방문 시에도 유지됨.
 * 첫 렌더 전 적용은 index.html의 인라인 스크립트가 담당 (깜빡임 방지).
 * 새 톤 추가: styles.css에 --palette-* 와 :root[data-tone='...'] 규칙을 만들고 여기 TONES에 추가.
 */
const STORAGE_KEY = 'chat:tone'
const TONES = [
  { id: 'clay', label: 'Clay', color: 'var(--palette-clay)' },
  { id: 'olive', label: 'Olive', color: 'var(--palette-olive)' },
] as const
type Tone = (typeof TONES)[number]['id']
const DEFAULT_TONE: Tone = 'clay'

function currentTone(): Tone {
  const t = document.documentElement.dataset.tone
  return TONES.some((x) => x.id === t) ? (t as Tone) : DEFAULT_TONE
}

export function ToneSwitcher() {
  const [tone, setTone] = useState<Tone>(currentTone)

  const select = (next: Tone) => {
    setTone(next)
    document.documentElement.dataset.tone = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 사생활 보호 모드 등 저장소 접근 불가 → 이번 방문 동안만 적용
    }
  }

  return (
    <div className="tone-switcher" role="radiogroup" aria-label="테마 선택">
      {TONES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={tone === t.id}
          className={tone === t.id ? 'is-active' : ''}
          onClick={() => select(t.id)}
        >
          <span className="tone-switcher__swatch" style={{ background: t.color }} />
          {t.label}
        </button>
      ))}
    </div>
  )
}
