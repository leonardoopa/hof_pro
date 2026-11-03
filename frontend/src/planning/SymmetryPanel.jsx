import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SIDE_LABEL } from './regions'
import { SUGGEST_THRESHOLD, computeSymmetry, suggestRegions } from './symmetry'

const BAND_TEXT = {
  baixa: 'Assimetria baixa',
  leve: 'Assimetria leve',
  moderada: 'Assimetria moderada',
}

const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function sideText(r) {
  if (!r.side) return '—'
  const side = SIDE_LABEL[r.side] ?? r.side
  return r.kind === 'lateral' ? `${side} (mais próximo da linha média)` : `${side} (posição mais baixa)`
}

/**
 * Painel de apoio ao planejamento. Os landmarks vêm de `getLandmarks` (cache da detecção já feita
 * na foto); o painel só calcula quando aberto e nunca altera doses.
 */
export default function SymmetryPanel({ image, getLandmarks, suggested, onSuggest }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ status: 'idle', result: null }) // idle | loading | ready | none | error

  useEffect(() => {
    setState({ status: 'idle', result: null })
    onSuggest([])
  }, [image]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !image || state.status !== 'idle') return
    let alive = true
    setState({ status: 'loading', result: null })
    getLandmarks(image)
      .then((landmarks) => {
        if (!alive) return
        const result = landmarks ? computeSymmetry(landmarks, image.naturalWidth, image.naturalHeight) : null
        setState(result ? { status: 'ready', result } : { status: 'none', result: null })
      })
      .catch(() => alive && setState({ status: 'error', result: null }))
    return () => {
      alive = false
    }
  }, [open, image, state.status, getLandmarks])

  const { status, result } = state
  const picks = result ? suggestRegions(result) : []

  return (
    <section className="card symmetry">
      <button type="button" className="card-title symmetry-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />} Simetria
        {result && <span className="sub">Escore {result.score}/100</span>}
      </button>

      {open && (
        <div className="symmetry-body">
          <p className="note">Apoio ao planejamento, não substitui avaliação clínica. Pose, expressão e lente da foto influenciam as medidas.</p>

          {status === 'loading' && <p className="note">Analisando o rosto…</p>}
          {status === 'none' && <p className="note">Rosto não detectado nesta foto: não foi possível calcular a simetria. Use uma foto frontal, com boa luz.</p>}
          {status === 'error' && <p className="note">Detecção indisponível (sem conexão?). Tente de novo mais tarde.</p>}

          {status === 'ready' && (
            <>
              <p className="symmetry-score">
                <b>{result.score}</b>/100 · {BAND_TEXT[result.band]}
              </p>
              <table className="symmetry-table">
                <thead>
                  <tr>
                    <th>Região</th>
                    <th>Diferença</th>
                    <th>Lado menor</th>
                  </tr>
                </thead>
                <tbody>
                  {result.regions.map((r) => (
                    <tr key={r.key} className={suggested.includes(r.planRegion) ? 'flagged' : ''}>
                      <td>{r.label}</td>
                      <td>{fmt(r.diff)}% da DIP</td>
                      <td>{sideText(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">DIP = distância interpupilar. Diferenças em relação à linha média (testa ao mento).</p>
              <button type="button" className="btn small" onClick={() => onSuggest(picks.map((r) => r.planRegion))}>
                <Lightbulb size={15} /> Sugerir pontos
              </button>
              {suggested.length > 0 && (
                <p className="note">
                  Regiões em destaque na foto: {picks.map((r) => r.label).join(', ')}. Sugestão não vinculante; as doses não foram alteradas.
                </p>
              )}
              {suggested.length === 0 && picks.length === 0 && (
                <p className="note">Nenhuma região acima de {SUGGEST_THRESHOLD}% da DIP; nada a destacar.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
