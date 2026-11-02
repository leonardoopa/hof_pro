import { ClipboardList } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { useToast } from '../components/Toast'

export default function AnamnesisStep() {
  const { patient } = useOutletContext()
  const navigate = useNavigate()
  const [questions, setQuestions] = useState(null)
  const [answers, setAnswers] = useState({}) // question_id -> { answer: bool, detail }
  const [notes, setNotes] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  const [showMissing, setShowMissing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, toastNode] = useToast()

  useEffect(() => {
    let alive = true
    Promise.all([api.anamnesis.questions(), api.anamnesis.get(patient.id)])
      .then(([qs, saved]) => {
        if (!alive) return
        setQuestions(qs)
        setAnswers(Object.fromEntries(saved.answers.map((a) => [a.question_id, { answer: a.answer, detail: a.detail }])))
        setNotes(saved.notes)
        setSavedAt(saved.updated_at)
      })
      .catch((err) => alive && setError(err))
    return () => {
      alive = false
    }
  }, [patient.id])

  const answered = useMemo(() => Object.keys(answers).length, [answers])
  const missing = useMemo(
    () => (questions ?? []).filter((q) => answers[q.id]?.answer && !answers[q.id].detail.trim()),
    [questions, answers],
  )

  const choose = (id, answer) =>
    setAnswers((prev) => ({ ...prev, [id]: { answer, detail: answer ? (prev[id]?.detail ?? '') : '' } }))
  const describe = (id, detail) => setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], detail } }))

  async function save() {
    if (missing.length) {
      setShowMissing(true)
      setError({ messages: ['Descreva a resposta de todas as perguntas marcadas como “Sim”.'] })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        notes,
        answers: Object.entries(answers).map(([id, a]) => ({ question_id: Number(id), answer: a.answer, detail: a.detail })),
      }
      const saved = await api.anamnesis.save(patient.id, body)
      setSavedAt(saved.updated_at)
      toast('Anamnese salva')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!questions) return error ? <ErrorList error={error} /> : <div className="boot">Carregando…</div>

  return (
    <div className="card anamnesis">
      <div className="card-title">
        <ClipboardList size={18} /> Anamnese
        <span className="sub">
          {answered} de {questions.length} respondidas
        </span>
      </div>
      <div className="progress" aria-hidden>
        <i style={{ width: `${(answered / questions.length) * 100}%` }} />
      </div>

      <ErrorList error={error} />

      {questions.map((q) => {
        const current = answers[q.id]
        const invalid = showMissing && current?.answer && !current.detail.trim()
        return (
          <div className="question" key={q.id}>
            <div className="question-main">
              <p>{q.text}</p>
              <div className="yesno" role="group" aria-label={q.text}>
                <button type="button" className="yes" aria-pressed={current?.answer === true} onClick={() => choose(q.id, true)}>
                  Sim
                </button>
                <button type="button" aria-pressed={current?.answer === false} onClick={() => choose(q.id, false)}>
                  Não
                </button>
              </div>
            </div>
            {current?.answer && (
              <input
                className={`input detail ${invalid ? 'invalid' : ''}`}
                placeholder={q.detail_prompt}
                aria-label={`${q.text} — ${q.detail_prompt}`}
                value={current.detail}
                maxLength={500}
                onChange={(e) => describe(q.id, e.target.value)}
              />
            )}
          </div>
        )
      })}

      <label className="field" style={{ marginTop: 14 }}>
        <span>Observações gerais</span>
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="save-bar">
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar anamnese'}
        </button>
        {savedAt && (
          <>
            <button className="btn" onClick={() => navigate('../planejamento')}>
              Ir para o planejamento
            </button>
            <span className="hint">Salva em {new Date(savedAt).toLocaleString('pt-BR')}</span>
          </>
        )}
      </div>
      {toastNode}
    </div>
  )
}
