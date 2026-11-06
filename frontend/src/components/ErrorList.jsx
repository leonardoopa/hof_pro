import { useEffect, useRef } from 'react'

export default function ErrorList({ error, kind = 'error' }) {
  const box = useRef(null)
  // O erro pode nascer longe do botão que o causou. Com 'nearest', só rola se a mensagem estiver fora da tela.
  useEffect(() => {
    if (error) box.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  if (!error) return null
  const messages = error.messages ?? [error.message ?? String(error)]
  return (
    <div ref={box} className={`alert ${kind}`} role="alert">
      {messages.length > 1 ? (
        <ul>
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : (
        messages[0]
      )}
    </div>
  )
}
