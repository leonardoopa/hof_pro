import { Camera, CheckCheck, ChevronLeft, Crosshair, Minus, Plus, Save, ScanFace, Sparkles, Trash2, Upload } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
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
import SymmetryPanel from '../planning/SymmetryPanel'
import { DEPTHS, TECHNIQUES, UNIT_BY_TREATMENT, lotLabel } from '../planning/technique'
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
  const [confirm, setConfirm] = useState(null) // { title, message, confirmLabel, onConfirm }
  const [suggested, setSuggested] = useState([]) // regiões destacadas pelo painel de simetria
  const [lots, setLots] = useState([]) // lotes disponíveis (saldo > 0 e válidos) do estoque

  const [treatment, setTreatment] = useState('preenchimento')
  const [zone, setZone] = useState(null) // { region, side } em zoom
  const [hoverRegion, setHoverRegion] = useState(null)
  const [selected, setSelected] = useState(null)
  const [adding, setAdding] = useState(false)

  // Simulação: liga sozinha quando algum ponto tem quantidade; o botão só sobrepõe essa escolha.
  const [simChoice, setSimChoice] = useState(null) // null = automático
  const [split, setSplit] = useState(100) // 100 = só "depois"; reduza para comparar com o "antes"
  const [simUrl, setSimUrl] = useState(null)
  const [toast, toastNode] = useToast()

  const fileInput = useRef(null)
  const blobUrl = useRef(null)
  const totals = useMemo(() => totalsOf(points), [points])
  const compare = simChoice ?? points.some((p) => p.amount > 0)

  // ---- carregar foto + pontos ----
  // Detecção feita uma única vez por imagem; o posicionamento dos pontos e o painel de simetria compartilham o resultado.
  const landmarkCache = useRef(new WeakMap())
  const getLandmarks = useCallback((img) => {
    if (!landmarkCache.current.has(img)) {
      const pending = detectFace(img)
      landmarkCache.current.set(img, pending)
      pending.catch(() => landmarkCache.current.delete(img)) // permite tentar de novo após falha
    }
    return landmarkCache.current.get(img)
  }, [])

  const placeToken = useRef(0)
  const placeAutomatically = useCallback(async (img) => {
    const token = ++placeToken.current // ignora o resultado se outra foto entrou no lugar
    setDetect('running')
    let template
    try {
      const landmarks = await getLandmarks(img)
      template = landmarks ? buildTemplate(landmarks, img.naturalWidth, img.naturalHeight) : fallbackTemplate()
      setDetect(landmarks ? 'found' : 'fallback')
    } catch {
      template = fallbackTemplate()
      setDetect('error')
    }
    if (token !== placeToken.current) return
    setPoints(template.map((t) => withUid({ ...t, treatment: 'preenchimento', amount: 0 })))
  }, [getLandmarks])

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
        const loaded = assignSides(
          savedPoints.map((p) =>
            withUid({ region: p.region, treatment: p.treatment, x: p.x, y: p.y, amount: p.amount, technique: p.technique, depth: p.depth, lot_id: p.lot_id }),
          ),
        )
        // Planos salvos antes da região "boca" existir: sugere os pontos padrão (quantidade 0), ajustáveis.
        if (!loaded.some((p) => p.region === 'boca')) {
          loaded.push(...fallbackTemplate().filter((t) => t.region === 'boca').map((t) => withUid({ ...t, treatment: 'preenchimento', amount: 0 })))
        }
        setPoints(loaded)
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
        const [photos, plans, anamnesis, availableLots] = await Promise.all([
          api.photos.list(patient.id),
          api.plans.list(patient.id),
          api.anamnesis.get(patient.id),
          api.inventory.lots({ available: true }).catch(() => []), // estoque é opcional para planejar
        ])
        const saved = plans[0] ? await api.plans.get(plans[0].id) : null
        if (!alive) return
        setAnamnesisDone(Boolean(anamnesis.updated_at))
        setLots(availableLots)
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
    }, 80)
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
  function addPhoto(file) {
    if (!file) return
    if (points.some((p) => p.amount > 0)) {
      setConfirm({
        title: 'Trocar a foto',
        message: 'Trocar a foto recria os pontos e zera as quantidades. Continuar?',
        confirmLabel: 'Trocar foto',
        onConfirm: () => uploadPhoto(file),
      })
      setCamera(false)
      return
    }
    return uploadPhoto(file)
  }

  async function uploadPhoto(file) {
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
      points: points.map(({ region, treatment: t, x, y, amount, technique, depth, lot_id }) => ({
        region,
        treatment: t,
        x: round4(x),
        y: round4(y),
        amount,
        technique: technique ?? '',
        depth: depth ?? '',
        lot_id: lot_id ?? null,
      })),
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

  function askMarkApplied() {
    setConfirm({
      title: 'Marcar como aplicado',
      message: 'Marcar como aplicado dá baixa no saldo dos lotes informados e trava a edição deste plano. Continuar?',
      confirmLabel: 'Marcar como aplicado',
      onConfirm: markApplied,
    })
  }

  async function markApplied() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.plans.apply(plan.id)
      setPlan(await api.plans.get(plan.id))
      setLots(await api.inventory.lots({ available: true }))
      toast(
        result.without_lot
          ? `Aplicado. ${result.applications} baixa(s); ${result.without_lot} ponto(s) sem lote`
          : `Aplicado. ${result.applications} baixa(s) no estoque`,
      )
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  // Plano aplicado fica travado: um novo plano parte dos mesmos pontos, sem lotes.
  function startNewPlan() {
    setPlan(null)
    setPoints((ps) => ps.map((p) => ({ ...p, lot_id: null })))
    setDirty(true)
  }

  if (loading) return <div className="boot">Carregando…</div>

  const applied = Boolean(plan?.applied_at)
  const lotOptions = (p) => {
    const unit = UNIT_BY_TREATMENT[p.treatment]
    const list = lots.filter((l) => l.unit === unit)
    return p.lot_id && !list.some((l) => l.id === p.lot_id) ? [...list, { id: p.lot_id, stale: true }] : list
  }
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
              suggested={suggested}
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
              <button className={`btn small ${compare ? 'primary' : ''}`} onClick={() => setSimChoice(!compare)} aria-pressed={compare}>
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
                Simulação ilustrativa (atualiza a cada alteração de quantidade) feita a partir das quantidades planejadas. Não representa garantia de resultado clínico.
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
          <button className="btn primary wide" onClick={save} disabled={busy || !photo || applied}>
            <Save size={16} /> {busy ? 'Salvando…' : 'Salvar plano'}
          </button>
          {plan && !applied && (
            <div className="applied-bar">
              <button className="btn wide" onClick={askMarkApplied} disabled={busy || dirty} title={dirty ? 'Salve o plano antes' : undefined}>
                <CheckCheck size={16} /> Marcar como aplicado
              </button>
            </div>
          )}
          {applied && (
            <div className="applied-bar">
              <div className="alert ok">Aplicado em {new Date(plan.applied_at).toLocaleString('pt-BR')}. Plano travado; estoque baixado.</div>
              <button className="btn wide" onClick={startNewPlan}>
                Novo plano a partir deste
              </button>
            </div>
          )}
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
                        className={`region-row ${hoverRegion === key ? 'hover' : ''} ${suggested.includes(key) ? 'suggest' : ''}`}
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
                      <Fragment key={p.uid}>
                      <div className={`prow ${selected === p.uid ? 'selected' : ''}`} onClick={() => setSelected(p.uid)}>
                        <span className="badge" style={{ '--c': t.color }}>
                          {index + 1}
                        </span>
                        <select
                          className="input mini"
                          value={p.treatment}
                          onChange={(e) =>
                            patchPoint(
                              p.uid,
                              UNIT_BY_TREATMENT[e.target.value] === UNIT_BY_TREATMENT[p.treatment]
                                ? { treatment: e.target.value }
                                : { treatment: e.target.value, lot_id: null },
                            )
                          }
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
                      {selected === p.uid && (
                        <div className="pdetail">
                          <label>
                            <span>Técnica</span>
                            <select className="input mini" value={p.technique ?? ''} onChange={(e) => patchPoint(p.uid, { technique: e.target.value })}>
                              <option value="">—</option>
                              {TECHNIQUES.map((o) => (
                                <option key={o.key} value={o.key}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Profundidade / plano</span>
                            <select className="input mini" value={p.depth ?? ''} onChange={(e) => patchPoint(p.uid, { depth: e.target.value })}>
                              <option value="">—</option>
                              {DEPTHS.map((o) => (
                                <option key={o.key} value={o.key}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="lot">
                            <span>Lote (opcional)</span>
                            <select
                              className="input mini"
                              value={p.lot_id ?? ''}
                              onChange={(e) => patchPoint(p.uid, { lot_id: e.target.value ? Number(e.target.value) : null })}
                            >
                              <option value="">Sem lote</option>
                              {lotOptions(p).map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.stale ? `Lote #${l.id} (indisponível)` : lotLabel(l)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                      </Fragment>
                    )
                  })}
                  {!zonePoints.length && <p className="note">Nenhum ponto nesta região. Use “Adicionar ponto”.</p>}
                </div>
              </>
            )}
          </section>
        )}

        {image && <SymmetryPanel image={image} getLandmarks={getLandmarks} suggested={suggested} onSuggest={setSuggested} />}

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
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {toastNode}
    </div>
  )
}
