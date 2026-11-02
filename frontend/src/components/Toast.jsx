import { useCallback, useEffect, useRef, useState } from 'react'

export function useToast() {
  const [message, setMessage] = useState('')
  const timer = useRef()
  const show = useCallback((text) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 2600)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const node = message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null
  return [show, node]
}
