import { FileSignature, Printer, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'
import SignaturePad from '../components/SignaturePad'
import { useToast } from '../components/Toast'
import { fmtDate } from '../planning/technique'

const fmtDateTime = (iso) => new Date(iso).toLocaleString('pt-BR')

function SignModal({ term, patient, onClose, onSigned }) {
  const pad = useRef(null)
  const [name, setName] = useState(patient.full_name)
  const [agree, setAgree] = useState(false)
  const [blank, setBlank] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (pad.current.isEmpty()) return
    setBusy(true)
    setError(null)
    try {
      onSigned(await api.consent.sign(patient.id, { term_id: term.id, signer_name: name, signature: pad.current.toDataURL() }))
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title={term.title} onClose={onClose}>
      <form onSubmit={submit} className="sign-form">
        <ErrorList error={error} />
        <div className="term-text" tabIndex={0}>
          {term.content}
        </div>
        <label className="field">
          <span>Nome de quem assina</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <div className="field">
          <span>Assinatura (use o dedo, caneta ou mouse)</span>
          <SignaturePad padRef={pad} onChange={setBlank} />
          <button type="button" className="btn ghost small" onClick={() => pad.current.clear()}>
            Limpar
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Li o termo acima e concordo.
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || blank || !agree || name.trim().length < 2}>
            {busy ? 'Registrando…' : 'Assinar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function TermRow({ term, signatures, onSign, onRevoke }) {
  const mine = signatures.filter((s) => s.kind === term.kind)
  const valid = mine.find((s) => s.version === term.version && !s.revoked_at)
  const stale = !valid && mine.find((s) => !s.revoked_at)
  return (
    <div className="term-row">
      <div>
        <strong>{term.title}</strong>
        <span className="inv-meta">Versão {term.version}</span>
      </div>
      <span className="spacer" />
      {valid ? (
        <span className="chip ok">Assinado em {new Date(valid.signed_at).toLocaleDateString('pt-BR')}</span>
      ) : stale ? (
        <span className="chip warn">Assinado na v{stale.version}</span>
      ) : mine.some((s) => s.revoked_at) ? (
        <span className="chip warn">Revogado</span>
      ) : (
        <span className="chip">Pendente</span>
      )}
      {valid && term.kind === 'uso_imagem' && (
        <button className="btn ghost small" onClick={() => onRevoke(valid)}>
          Revogar
        </button>
      )}
      <button className="btn small" onClick={() => onSign(term)}>
        <FileSignature size={15} /> {valid ? 'Nova assinatura' : 'Coletar assinatura'}
      </button>
    </div>
  )
}

export default function ConsentStep() {
  const { patient } = useOutletContext()
  const [terms, setTerms] = useState(null)
  const [signatures, setSignatures] = useState([])
  const [trace, setTrace] = useState(null)
  const [error, setError] = useState(null)
  const [signing, setSigning] = useState(null)
  const [revoking, setRevoking] = useState(null) // assinatura a revogar
  const [toast, toastNode] = useToast()

  const load = useCallback(async () => {
    try {
      const [t, s, tr] = await Promise.all([api.consent.terms(), api.consent.list(patient.id), api.inventory.traceability(patient.id)])
      setTerms(t)
      setSignatures(s)
      setTrace(tr)
    } catch (err) {
      setError(err)
    }
  }, [patient.id])

  useEffect(() => {
    load()
  }, [load])

  const print = (path) => api.openPrintable(path).catch(setError)

  async function revoke(signature) {
    try {
      await api.consent.revoke(signature.id)
      await load()
      toast('Autorização revogada')
    } catch (err) {
      setError(err)
    }
  }

  if (!terms) return error ? <ErrorList error={error} /> : <div className="boot">Carregando…</div>

  const procedureTerms = terms.filter((t) => t.kind !== 'uso_imagem')
  const imageTerms = terms.filter((t) => t.kind === 'uso_imagem')
  const rowProps = { signatures, onSign: setSigning, onRevoke: setRevoking }

  return (
    <div className="consent">
      <ErrorList error={error} />

      <section className="card">
        <div className="card-title">
          <FileSignature size={18} /> Termos de consentimento do procedimento
        </div>
        {procedureTerms.map((t) => (
          <TermRow key={t.id} term={t} {...rowProps} />
        ))}
        {!procedureTerms.length && <p className="note">Nenhum termo ativo. Cadastre no admin.</p>}
      </section>

      <section className="card">
        <div className="card-title">
          <ShieldCheck size={18} /> Uso de imagem para divulgação
          <span className="sub">Separado do procedimento e opcional: recusar não muda o atendimento.</span>
        </div>
        {imageTerms.map((t) => (
          <TermRow key={t.id} term={t} {...rowProps} />
        ))}
      </section>

      <section className="card">
        <div className="card-title">Assinaturas registradas</div>
        {signatures.length ? (
          <table className="inv-table">
            <thead>
              <tr>
                <th>Termo</th>
                <th>Assinante</th>
                <th>Data/hora</th>
                <th>Hash (SHA-256)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {signatures.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.title} <small>v{s.version}</small>
                    {s.revoked_at && <span className="chip warn"> revogado</span>}
                  </td>
                  <td>{s.signer_name}</td>
                  <td>{fmtDateTime(s.signed_at)}</td>
                  <td>
                    <code title={s.document_hash}>{s.document_hash.slice(0, 12)}…</code>
                  </td>
                  <td className="inv-actions">
                    <button className="btn ghost small" onClick={() => print(`/consents/${s.id}/document`)}>
                      <Printer size={14} /> PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="note">Nenhuma assinatura ainda.</p>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          Rastreabilidade das aplicações
          <span className="sub">Produto, lote e validade de cada ponto aplicado.</span>
          <span className="spacer" />
          <button className="btn small" onClick={() => print(`/patients/${patient.id}/traceability/print`)}>
            <Printer size={14} /> Cartão (PDF)
          </button>
        </div>
        {trace?.rows.length ? (
          <table className="inv-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Região</th>
                <th>Produto</th>
                <th>Lote</th>
                <th>Qtd.</th>
              </tr>
            </thead>
            <tbody>
              {trace.rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.applied_at)}</td>
                  <td>{r.region}</td>
                  <td>{r.product}</td>
                  <td>
                    {r.lot_number} <small>val. {fmtDate(r.lot_expires_on)}</small>
                  </td>
                  <td>
                    {r.amount} {r.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="note">Nenhuma aplicação registrada. Marque o plano como aplicado no Planejamento.</p>
        )}
      </section>

      {signing && (
        <SignModal
          term={signing}
          patient={patient}
          onClose={() => setSigning(null)}
          onSigned={() => {
            setSigning(null)
            load()
            toast('Assinatura registrada')
          }}
        />
      )}
      {revoking && (
        <ConfirmModal
          title="Revogar autorização"
          message="Revogar a autorização de uso de imagem? O material deixa de poder ser divulgado."
          confirmLabel="Revogar"
          danger
          onConfirm={() => revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}
      {toastNode}
    </div>
  )
}
