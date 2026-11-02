import { Hourglass } from 'lucide-react'

export default function ComingSoon({ title, text }) {
  return (
    <div className="card empty">
      <Hourglass size={28} />
      <h2>{title}</h2>
      <p>{text}</p>
      <span className="chip">Em breve</span>
    </div>
  )
}
