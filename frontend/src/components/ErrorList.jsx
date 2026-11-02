export default function ErrorList({ error, kind = 'error' }) {
  if (!error) return null
  const messages = error.messages ?? [error.message ?? String(error)]
  return (
    <div className={`alert ${kind}`} role="alert">
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
