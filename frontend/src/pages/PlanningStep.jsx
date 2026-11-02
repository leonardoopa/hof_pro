import { Camera, ChevronLeft, Crosshair, Minus, Plus, Save, ScanFace, Sparkles, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { useToast } from '../components/Toast'
import CameraCapture from '../planning/CameraCapture'
import { detectFace } from '../planning/faceLandmarks'
import FaceStage from '../planning/FaceStage'
import {
  BILATERAL,
  REGIONS,
  SIDE_LABEL,
  TREATMENTS,
  assignSides,
  describeTotals,
  formatAmount,
  regionLabel,
  round2,
  totalsOf,
  treatmentOf,
} from '../planning/regions'
import { renderSimulation } from '../planning/simulate'
import { buildTemplate, fallbackTemplate } from '../planning/template'

let uidCounter = 0
const withUid = (point) => ({ uid: `p${++uidCounter}`, ...point })
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const round4 = (n) => Math.round(n * 10000) / 10000

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

const DETECT_NOTE = {
  running: 'Detectando o rosto…',
  found: 'Pontos ajustados ao rosto. Arraste para refinar.',
  fallback: 'Rosto não detectado: pontos na posição padrão. Arraste para ajustar.',
  error: 'Detecção indisponível (sem conexão?): pontos na posição padrão. Arraste para ajustar.',
}

export default function PlanningStep() {
  const { patient } = useOutletContext()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [anamnesisDone, setAnamnesisDone] = useState(true)

  const [photo, setPhoto] = useState(null)
  const [image, setImage] = useState(null)
  const [detect, setDetect] = useState('idle')
  const [plan, setPlan] = useState(null)
  const [points, setPoints] = useState([])
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState(false)

  const [treatment, setTreatment] = useState('preenchimento')
  const [zone, setZone] = useState(null) // { region, side } em zoom
  const [hoverRegion, setHoverRegion] = useState(null)
  const [selected, setSelected] = useState(null)
  const [adding, setAdding] = useState(false)

  const [compare, setCompare] = useState(false)
  const [split, setSplit] = useState(50)
  const [simUrl, setSimUrl] = useState(null)
  const [toast, toastNode] = useToast()

  const fileInput = useRef(null)
  const blobUrl = useRef(null)
  const totals = useMemo(() => totalsOf(points), [points])

  // ---- carregar foto + pontos ----
  const placeToken = useRef(0)
  const placeAutomatically = useCallback(async (img) => {
    const token = ++placeToken.current // ignora o resultado se outra foto entrou no lugar
    setDetect('running')
    let template
    try {
      const landmarks = await detectFace(img)
      template = landmarks ? buildTemplate(landmarks, img.naturalWidth, img.naturalHeight) : fallbackTemplate()
      setDetect(landmarks ? 'found' : 'fallback')
    } catch {
      template = fallbackTemplate()
      setDetect('error')
    }
    if (token !== placeToken.current) return
    setPoints(template.map((t) => withUid({ ...t, treatment: 'preenchimento', amount: 0 })))
  }, [])

  const showPhoto = useCallback(
    async (meta, savedPoints) => {
      const url = await api.photos.objectUrl(meta.id)
      const img = await loadImage(url)
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
      blobUrl.current = url
      setPhoto(meta)
      setImage(img)
      if (savedPoints?.length) {
        placeToken.current++
        setPoints(
          assignSides(savedPoints.map((p) => withUid({ region: p.region, treatment: p.treatment, x: p.x, y: p.y, amount: p.amount }))),
        )
        setDetect('idle')
      } else {
        placeAutomatically(img) // em segundo plano: a foto já aparece enquanto o modelo carrega
      }
    },
    [placeAutomatically],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [photos, plans, anamnesis] = await Promise.all([
          api.photos.list(patient.id),
          api.plans.list(patient.id),
          api.anamnesis.get(patient.id),
        ])
        const saved = plans[0] ? await api.plans.get(plans[0].id) : null
        if (!alive) return
        setAnamnesisDone(Boolean(anamnesis.updated_at))
        setPlan(saved)
        setNotes(saved?.notes ?? '')
        const meta = photos.find((p) => p.id === saved?.photo_id) ?? photos.find((p) => p.kind === 'frontal') ?? null
        if (meta) await showPhoto(meta, saved?.points)
      } catch (err) {
        if (alive) setError(err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
    }
  }, [patient.id, showPhoto])

  useEffect(() => {
    if (!dirty) return
    const warn = (e) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // ---- simulação ----
  useEffect(() => {
    if (!compare || !image) return
    let alive = true
    const timer = setTimeout(() => {
      renderSimulation(image, points).toBlob(
        (blob) => {
          if (!alive || !blob) return
          setSimUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return URL.createObjectURL(blob)
          })
        },
        'image/jpeg',
        0.9,
      )
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [compare, image, points])

  useEffect(() => {
    if (compare) return
    setSimUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [compare])

  // ---- edição de pontos ----
  const edit = (fn) => {
    setPoints(fn)
    setDirty(true)
  }
  const patchPoint = (id, patch) => edit((ps) => ps.map((p) => (p.uid === id ? { ...p, ...patch } : p)))

  const stepAmount = (id, direction) =>
    edit((ps) =>
      ps.map((p) => {
        if (p.uid !== id) return p
        if (p.amount === 0 && direction > 0) {
          const t = treatmentOf(treatment)
          return { ...p, treatment: t.key, amount: t.initial }
        }
        const t = treatmentOf(p.treatment)
        return { ...p, amount: clamp(round2(p.amount + direction * t.step), 0, 200) }
      }),
    )

  const typeAmount = (id, raw) =>
    edit((ps) =>
      ps.map((p) => {
        if (p.uid !== id) return p
        const amount = clamp(round2(parseFloat(raw) || 0), 0, 200)
        return { ...p, amount, treatment: p.amount === 0 && amount > 0 ? treatment : p.treatment }
      }),
    )

  const movePoint = (id, x, y) => patchPoint(id, { x, y })
  const removePoint = (id) => {
    edit((ps) => ps.filter((p) => p.uid !== id))
    setSelected(null)
  }

  function addPoint(x, y) {
    const t = treatmentOf(treatment)
    const point = withUid({ region: zone.region, side: zone.side, x, y, treatment: t.key, amount: t.initial })
    edit((ps) => [...ps, point])
    setSelected(point.uid)
    setAdding(false)
  }

  function openRegion(region, side) {
    const sides = BILATERAL.has(region) ? ['D', 'E'] : ['C']
    const target = side ?? sides[0]
    setZone({ region, side: target })
    setAdding(false)
    setSelected(points.find((p) => p.region === region && p.side === target)?.uid ?? null)
  }

  const closeRegion = () => {
    setZone(null)
    setAdding(false)
    setSelected(null)
  }

  // ---- foto ----
  async function addPhoto(file) {
    if (!file) return
    if (points.some((p) => p.amount > 0) && !window.confirm('Trocar a foto recria os pontos e zera as quantidades. Continuar?')) return
    setBusy(true)
    setError(null)
    try {
      const meta = await api.photos.upload(patient.id, file, 'frontal')
      await showPhoto(meta, null)
      closeRegion()
      setCamera(false)
      setDirty(true)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  // ---- salvar ----
  async function save() {
    setBusy(true)
    setError(null)
    const body = {
      photo_id: photo?.id ?? null,
      title: plan?.title ?? '',
      notes,
      points: points.map(({ region, treatment: t, x, y, amount }) => ({ region, treatment: t, x: round4(x), y: round4(y), amount })),
    }
    try {
      setPlan(plan ? await api.plans.update(plan.id, body) : await api.plans.create(patient.id, body))
      setDirty(false)
      toast('Plano salvo')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="boot">Carregando…</div>

  const zonePoints = zone ? points.filter((p) => p.region === zone.region && p.side === zone.side) : []
  const filePicker = (
    <input
      ref={fileInput}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      onChange={(e) => {
        addPhoto(e.target.files[0])
        e.target.value = ''
      }}
    />
  )

  return (
    <div className="planning">
      <section className="card stage-card">
        <div className="card-title">
          <ScanFace size={18} /> Planejamento facial
          <span className="sub">Toque numa região para ampliar e definir a quantidade em cada ponto.</span>
        </div>

        {!anamnesisDone && (
          <div className="alert warn">
            Anamnese ainda não preenchida. <Link to="../anamnese">Preencher agora</Link>
          </div>
        )}
        <ErrorList error={error} />

        <div className="treatments" role="group" aria-label="Tratamento a aplicar">
          {TREATMENTS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`treatment ${treatment === t.key ? 'active' : ''}`}
              style={{ '--c': t.color }}
              aria-pressed={treatment === t.key}
              onClick={() => setTreatment(t.key)}
            >
              <i /> {t.label} <small>{t.unit}</small>
            </button>
          ))}
        </div>

        {!image ? (
          <div className="photo-empty">
            <ScanFace size={34} />
            <h2>Foto frontal do paciente</h2>
            <p>Tire uma foto agora ou envie uma já existente. Rosto de frente, boa luz, cabelo afastado da testa.</p>
            <div className="photo-actions">
              <button className="btn primary" onClick={() => setCamera(true)} disabled={busy}>
                <Camera size={17} /> Tirar foto
              </button>
              <button className="btn" onClick={() => fileInput.current.click()} disabled={busy}>
                <Upload size={17} /> Enviar foto
              </button>
            </div>
          </div>
        ) : (
          <>
            {zone && (
              <div className="stage-toolbar">
                <button className="btn small" onClick={closeRegion}>
                  <ChevronLeft size={15} /> Todas as regiões
                </button>
                <strong>{regionLabel(zone.region)}</strong>
                {BILATERAL.has(zone.region) && (
                  <div className="yesno" role="group" aria-label="Lado do rosto">
                    {['D', 'E'].map((side) => (
                      <button key={side} type="button" aria-pressed={zone.side === side} onClick={() => openRegion(zone.region, side)}>
                        {SIDE_LABEL[side]}
                      </button>
                    ))}
                  </div>
                )}
                <button className={`btn small ${adding ? 'primary' : ''}`} onClick={() => setAdding(!adding)}>
                  <Crosshair size={15} /> {adding ? 'Toque na foto…' : 'Adicionar ponto'}
                </button>
              </div>
            )}

            <FaceStage
              imageUrl={image.src}
              aspect={image.naturalWidth / image.naturalHeight}
              points={points}
              zone={zone}
              selectedId={selected}
              hoverRegion={hoverRegion}
              adding={adding}
              simUrl={compare ? simUrl : null}
              split={split}
              onPickRegion={openRegion}
              onHoverRegion={setHoverRegion}
              onSelectPoint={setSelected}
              onMovePoint={movePoint}
              onAddPoint={addPoint}
            />

            <div className="stage-foot">
              <button className={`btn small ${compare ? 'primary' : ''}`} onClick={() => setCompare(!compare)} aria-pressed={compare}>
                <Sparkles size={15} /> Simular resultado
              </button>
              {compare && (
                <label className="split">
                  <span>Antes</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={split}
                    onChange={(e) => setSplit(Number(e.target.value))}
                    aria-label="Comparar antes e depois"
                  />
                  <span>Depois</span>
                </label>
              )}
              <span className="spacer" />
              <button className="btn ghost small" onClick={() => setCamera(true)} disabled={busy}>
                <Camera size={15} /> Nova foto
              </button>
              <button className="btn ghost small" onClick={() => fileInput.current.click()} disabled={busy}>
                <Upload size={15} /> Trocar foto
              </button>
            </div>
            <p className="note">{DETECT_NOTE[detect]}</p>
            {compare && (
              <p className="note">
                Simulação ilustrativa feita a partir das quantidades planejadas. Não representa garantia de resultado clínico.
              </p>
            )}
          </>
        )}
        {filePicker}
      </section>

      <aside className="side">
        <section className="card">
          <div className="card-title">Resumo do plano</div>
          <dl className="summary">
            <div>
              <dt>Total de ml (preenchimento)</dt>
              <dd>{formatAmount(totals.ml)} ml</dd>
            </div>
            <div>
              <dt>Total de unidades (toxina)</dt>
              <dd>{formatAmount(totals.units)} un</dd>
            </div>
            <div>
              <dt>Número de áreas</dt>
              <dd>{totals.areas}</dd>
            </div>
          </dl>
          <button className="btn primary wide" onClick={save} disabled={busy || !photo}>
            <Save size={16} /> {busy ? 'Salvando…' : 'Salvar plano'}
          </button>
          <p className="note center">
            {dirty ? 'Alterações não salvas' : plan ? `Salvo em ${new Date(plan.updated_at).toLocaleString('pt-BR')}` : ''}
          </p>
        </section>

        {image && (
          <section className="card">
            {!zone ? (
              <>
                <div className="card-title">Regiões</div>
                <div className="region-list">
                  {REGIONS.map(({ key, label }) => {
                    const total = totalsOf(points.filter((p) => p.region === key))
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`region-row ${hoverRegion === key ? 'hover' : ''}`}
                        onClick={() => openRegion(key)}
                        onMouseEnter={() => setHoverRegion(key)}
                        onMouseLeave={() => setHoverRegion(null)}
                      >
                        <span>{label}</span>
                        <b className={total.areas ? '' : 'muted'}>{describeTotals(total)}</b>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="card-title">
                  {regionLabel(zone.region)}
                  {SIDE_LABEL[zone.side] && ` · ${SIDE_LABEL[zone.side]}`}
                  <span className="sub">{describeTotals(totalsOf(zonePoints))}</span>
                </div>
                <div className="point-list">
                  {zonePoints.map((p, index) => {
                    const t = treatmentOf(p.treatment)
                    return (
                      <div key={p.uid} className={`prow ${selected === p.uid ? 'selected' : ''}`} onClick={() => setSelected(p.uid)}>
                        <span className="badge" style={{ '--c': t.color }}>
                          {index + 1}
                        </span>
                        <select
                          className="input mini"
                          value={p.treatment}
                          onChange={(e) => patchPoint(p.uid, { treatment: e.target.value })}
                          aria-label={`Tratamento do ponto ${index + 1}`}
                        >
                          {TREATMENTS.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <div className="amount">
                          <button className="icon-btn" onClick={() => stepAmount(p.uid, -1)} disabled={p.amount <= 0} aria-label="Diminuir">
                            <Minus size={14} />
                          </button>
                          <input
                            className="input mini"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="200"
                            step={t.step}
                            value={p.amount}
                            onChange={(e) => typeAmount(p.uid, e.target.value)}
                            aria-label={`Quantidade do ponto ${index + 1} em ${t.unit}`}
                          />
                          <span className="unit">{t.unit}</span>
                          <button className="icon-btn" onClick={() => stepAmount(p.uid, 1)} aria-label="Aumentar">
                            <Plus size={14} />
                          </button>
                        </div>
                        <button className="icon-btn" onClick={() => removePoint(p.uid)} aria-label={`Remover ponto ${index + 1}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                  {!zonePoints.length && <p className="note">Nenhum ponto nesta região. Use “Adicionar ponto”.</p>}
                </div>
              </>
            )}
          </section>
        )}

        <section className="card">
          <div className="card-title">Observações</div>
          <textarea
            className="input"
            placeholder="Ex.: assimetria leve em malar direito. Paciente relata bruxismo."
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setDirty(true)
            }}
          />
        </section>
      </aside>

      {camera && <CameraCapture onCapture={addPhoto} onClose={() => setCamera(false)} />}
      {toastNode}
    </div>
  )
}
