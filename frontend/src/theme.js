import { useCallback, useEffect, useState } from 'react'

const KEY = 'hofpro.theme'

function stored() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null // storage indisponível: segue o sistema
  }
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

/** Aplica a escolha salva (se houver) antes do primeiro render, evitando flash de tema. */
export function initTheme() {
  const choice = stored()
  if (choice) document.documentElement.dataset.theme = choice
}

/** Tema efetivo + alternância. Sem escolha salva, segue o sistema. */
export function useTheme() {
  const [choice, setChoice] = useState(stored)
  const [dark, setDark] = useState(systemDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const effective = choice ?? (dark ? 'dark' : 'light')

  const toggle = useCallback(() => {
    const next = effective === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* ignore */
    }
    setChoice(next)
  }, [effective])

  return { theme: effective, toggle }
}
