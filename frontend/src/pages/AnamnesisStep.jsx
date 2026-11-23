import { ClipboardList, PenLine, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import SignaturePad from '../components/SignaturePad'
import { useToast } from '../components/Toast'
import AnamnesisHistory from './AnamnesisHistory'

/** Assinatura do paciente sobre a versão salva. Alterar a anamnese cria versão nova, que pede assinatura nova. */
function AnamnesisSignature({ patient, version, signature, declaration, dirty, onSigned }) {
  const pad = useRef(null)
  const [name, setName] = useState(patient.full_name)
  const [agree, setAgree] = useState(false)
  const [blank, setBlank] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [imageUrl, setImageUrl] = useState(null)

  useEffect(() => {
    if (!signature) return
    let url
    api.anamnesis
      .signatureUrl(signature.id)
      .then((u) => setImageUrl((url = u)))
      .catch(() => setImageUrl(null))
    return () => url && URL.revokeObjectURL(url)
  }, [signature?.id])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSigned(await api.anamnesis.sign(patient.id, { signer_name: name.trim(), signature: pad.current.toDataURL() }))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (signature && !dirty) {
    return (
      <section className="card anamnesis-signature signed" aria-label="Assinatura da anamnese">
        <div className="card-title">
          <ShieldCheck size={18} /> Assinada pelo paciente
          <span className="sub">versão {signature.version}</span>
        </div>
        <p>
          {signature.signer_name}, em {new Date(signature.signed_at).toLocaleString('pt-BR')}.
        </p>
        {imageUrl && <img className="signature-image" src={imageUrl} alt={`Assinatura de ${signature.signer_name}`} />}
        <p className="hint">Código de verificação (SHA-256): {signature.document_hash}</p>
      </section>
    )
  }

  return (
    <section className="card anamnesis-signature" aria-label="Assinatura da anamnese">
      <div className="card-title">
        <PenLine size={18} /> Assinatura do paciente
        {version && <span className="sub">versão {version}</span>}
      </div>
      {!version || dirty ? (
        <p className="hint">
          {version ? 'Há alterações não salvas. Salve a anamnese' : 'Salve a anamnese'} antes de colher a assinatura: o paciente assina
          a versão salva.
        </p>
      ) : (
        <form onSubmit={submit}>
          <p className="declaration">{declaration}</p>
          <ErrorList error={error} />
          <label className="field">
            <span>Nome de quem assina</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={150} />
          </label>
          <div className="field">
            <span>Assinatura (use o dedo, caneta ou mouse)</span>
            <SignaturePad padRef={pad} onChange={setBlank} />
            <button type="button" className="btn ghost small" onClick={() => pad.current.clear()}>
              Limpar
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> O paciente leu a declaração e
            confirma as respostas.
          </label>
          <div className="save-bar">
            <button className="btn primary" disabled={busy || blank || !agree || name.trim().length < 2}>
              {busy ? 'Assinando…' : 'Assinar anamnese'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

export default function AnamnesisStep() {
  const { patient } = useOutletContext()
  const navigate = useNavigate()
  const [questions, setQuestions] = useState(null)
  const [answers, setAnswers] = useState({}) // question_id -> { answer: bool, detail }
  const [notes, setNotes] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  const [version, setVersion] = useState(null)
  const [signature, setSignature] = useState(null)
  const [declaration, setDeclaration] = useState('')
  const [dirty, setDirty] = useState(false)
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
        setVersion(saved.version)
        setSignature(saved.signature)
        setDeclaration(saved.declaration)
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

  const choose = (id, answer) => {
    setDirty(true)
    setAnswers((prev) => ({ ...prev, [id]: { answer, detail: answer ? (prev[id]?.detail ?? '') : '' } }))
  }
  const describe = (id, detail) => {
    setDirty(true)
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], detail } }))
  }

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
      setVersion(saved.version)
      setSignature(saved.signature)
      setDirty(false)
      toast(saved.version === version ? `Nada mudou: continua a versão ${version}` : 'Anamnese salva')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!questions) return error ? <ErrorList error={error} /> : <div className="boot">Carregando…</div>

  return (
    <>
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
          <textarea
            className="input"
            value={notes}
            onChange={(e) => {
              setDirty(true)
              setNotes(e.target.value)
            }}
          />
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
              <span className="hint">
                Versão {version}, salva em {new Date(savedAt).toLocaleString('pt-BR')}
              </span>
            </>
          )}
        </div>
        {toastNode}
      </div>
      <AnamnesisSignature
        patient={patient}
        version={version}
        signature={signature}
        declaration={declaration}
        dirty={dirty}
        onSigned={(saved) => {
          setSignature(saved.signature)
          toast('Anamnese assinada')
        }}
      />
      {version && <AnamnesisHistory key={signature?.id ?? 'unsigned'} patientId={patient.id} current={version} />}
    </>
  )
}
