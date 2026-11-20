import {
  Camera,
  ChevronRight,
  CalendarDays,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  History,
  Receipt,
  ShieldAlert,
  Syringe,
  Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { formatWhen, groupByMonth, isUpcoming, itemPath } from './timeline.js'

const FIRST_PAGE = 100
const MAX_LIMIT = 300 // teto da rota

// Rótulo e ícone de cada tipo de item. A cor vem da classe `kind-<tipo>` em timeline.css.
const KINDS = {
  plano: { label: 'Plano', Icon: ClipboardList },
  aplicacao: { label: 'Aplicação', Icon: Syringe },
  termo: { label: 'Termo', Icon: FileSignature },
  intercorrencia: { label: 'Intercorrência', Icon: ShieldAlert },
  agendamento: { label: 'Agendamento', Icon: CalendarDays },
  foto: { label: 'Foto', Icon: Camera },
  anamnese: { label: 'Anamnese', Icon: ClipboardCheck },
  orcamento: { label: 'Orçamento', Icon: Receipt },
  pagamento: { label: 'Pagamento', Icon: Wallet },
}

function Row({ item, patientId, now }) {
  const { label, Icon } = KINDS[item.kind] ?? { label: item.kind, Icon: CircleDot }
  const path = itemPath(item, patientId)
  const content = (
    <>
      <span className="tl-text">
        <strong>{item.title}</strong>
        {item.detail && <span className="tl-detail">{item.detail}</span>}
        <span className="tl-when">
          {label} · {formatWhen(item.at)}
        </span>
      </span>
      {path && <ChevronRight size={16} className="tl-go" aria-hidden="true" />}
    </>
  )
  return (
    <li className={`tl-item kind-${item.kind}${isUpcoming(item, now) ? ' upcoming' : ''}`}>
      <span className="tl-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      {path ? (
        <Link className="tl-body" to={path}>
          {content}
        </Link>
      ) : (
        <div className="tl-body">{content}</div>
      )}
    </li>
  )
}

export default function TimelineStep() {
  const { patient } = useOutletContext()
  const hidden = Boolean(patient.anonymized_at)
  const [limit, setLimit] = useState(FIRST_PAGE)
  const [attempt, setAttempt] = useState(0)
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [now] = useState(() => new Date())

  // Ocultar ou mostrar os dados muda o que a rota devolve: sem isto o nome antigo ficaria na tela até a resposta chegar.
  useEffect(() => {
    setItems(null)
  }, [patient.id, hidden])

  useEffect(() => {
    let stale = false
    setError(null)
    api.timeline.get(patient.id, limit)
      .then((out) => !stale && setItems(out.items))
      .catch((err) => !stale && setError(err))
    return () => {
      stale = true
    }
  }, [patient.id, hidden, limit, attempt])

  const groups = groupByMonth(items)
  const maybeMore = items && items.length >= limit

  return (
    <div className="timeline">
      <section className="card timeline-head">
        <h2>
          <History size={20} /> Histórico
        </h2>
        <p className="inv-meta">Tudo o que já aconteceu com este paciente, do mais recente ao mais antigo. Toque num item para abrir a etapa.</p>
      </section>

      {hidden && (
        <p className="alert info">
          Dados ocultos: o histórico mostra só o tipo e a data de cada registro. Nomes, textos livres e fotos ficam de fora.
        </p>
      )}

      <ErrorList error={error} />
      {error && (
        <div>
          <button className="btn small" onClick={() => setAttempt((n) => n + 1)}>
            Tentar de novo
          </button>
        </div>
      )}
      {!items && !error && (
        <p className="inv-meta" role="status">
          Carregando histórico…
        </p>
      )}

      {items && !items.length && (
        <div className="empty-state">
          <History size={24} />
          <h2>Nada registrado ainda</h2>
          <p>Planos, aplicações, termos, intercorrências, agendamentos, fotos e anamnese deste paciente aparecem aqui.</p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.key} className="tl-month" aria-label={group.label}>
          <h3>
            {group.label} <span>{group.items.length === 1 ? '1 registro' : `${group.items.length} registros`}</span>
          </h3>
          <ol className="tl-list">
            {group.items.map((item) => (
              <Row key={`${item.kind}-${item.ref?.type}-${item.ref?.id}-${item.at}-${item.title}`} item={item} patientId={patient.id} now={now} />
            ))}
          </ol>
        </section>
      ))}

      {maybeMore && limit < MAX_LIMIT && (
        <button className="btn" onClick={() => setLimit(MAX_LIMIT)}>
          Mostrar registros mais antigos
        </button>
      )}
      {maybeMore && limit >= MAX_LIMIT && <p className="inv-meta">Mostrando os {MAX_LIMIT} registros mais recentes.</p>}
    </div>
  )
}
