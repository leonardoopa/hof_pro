import { AlertTriangle, Camera, Check, CheckCheck, ChevronLeft, Eye, EyeOff, MousePointerClick, Minus, PackagePlus, Pencil, Plus, Save, ScanFace, Smile, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import ErrorList from '../components/ErrorList'
import { useToast } from '../components/Toast'
import CameraCapture from '../planning/CameraCapture'
import { detectFace } from '../planning/faceLandmarks'
import Modal from '../components/Modal'
import FaceStage from '../planning/FaceStage'
import { MODEL_FACE, MODEL_TEMPLATE } from '../planning/modelFace'
import NewLotModal from '../planning/NewLotModal'
import {
  BILATERAL,
  GROUPS,
  REGIONS,
  SIDE_LABEL,
  TREATMENTS,
  assignSides,
  describeTotals,
  formatAmount,
  parseAmount,
  pointLabel,
  regionLabel,
  regionOf,
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
  found: 'Pontos sugeridos ajustados ao rosto. Arraste para refinar.',
  fallback: 'Rosto não detectado: pontos sugeridos na posição padrão. Arraste para ajustar.',
  error: 'Detecção indisponível (sem conexão?): pontos sugeridos na posição padrão. Arraste para ajustar.',
}

const clampAmount = (n) => clamp(round2(n), 0, 200)

/**
 * Quantidade de um ponto. É campo de texto de propósito: input type=number descarta a vírgula em navegador fora
 * de pt-BR, e "0,3" viraria 3, dose dez vezes maior.
 */
function AmountField({ value, onChange, onStep, ...props }) {
  const [draft, setDraft] = useState(null) // texto em digitação; null = mostra a quantidade guardada
  return (
    <input
      {...props}
      className="input mini"
      inputMode="decimal"
      autoComplete="off"
      value={draft ?? formatAmount(value)}
      onChange={(e) => {
        const text = e.target.value.replace(/[^\d.,-]/g, '')
        const typed = parseAmount(text)
        const amount = clampAmount(typed)
        setDraft(typed === amount ? text : null) // fora do limite ou com casas demais: mostra o que ficou valendo
        onChange(amount)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        setDraft(null)
        onStep(e.key === 'ArrowUp' ? 1 : -1)
      }}
    />
  )
}

export default function PlanningStep() {
  const { patient } = useOutletContext()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [anamnesisDone, setAnamnesisDone] = useState(true)

  const [photo, setPhoto] = useState(null)
  const [image, setImage] = useState(null)
  // Planejar sobre o rosto simétrico de referência (sem foto): o plano é salvo sem photo_id.
  const modelMode = image?.isModel === true
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
  const [lotFor, setLotFor] = useState(null) // ponto que recebe um lote novo, criado no modal

  const [treatment, setTreatment] = useState('preenchimento')
  const [zone, setZone] = useState(null) // { region, side } em zoom
  const [hoverRegion, setHoverRegion] = useState(null)
  const [selected, setSelected] = useState(null)
  const [adding, setAdding] = useState(false)
  const [showMarks, setShowMarks] = useState(true) // false = foto limpa, sem pontos nem rótulos
  const [notesOpen, setNotesOpen] = useState(false)

  // Simulação: liga sozinha quando algum ponto tem quantidade; o botão só sobrepõe essa escolha.
  const [simChoice, setSimChoice] = useState(null) // null = automático
  const [split, setSplit] = useState(100) // 100 = só "depois"; reduza para comparar com o "antes"
  const [simUrl, setSimUrl] = useState(null)
  const [toast, toastNode] = useToast()

  const fileInput = useRef(null)
  const blobUrl = useRef(null)
  const totals = useMemo(() => totalsOf(points), [points])
  const compare = !modelMode && (simChoice ?? points.some((p) => p.amount > 0)) // simular só faz sentido sobre uma foto

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

  // Posição sugerida de cada região na imagem atual: tocar no rosto abre a região mais próxima, e a região vazia também
  // amplia. Na foto, a detecção refina as posições quando terminar; até lá, ou sem detecção, vale a posição padrão.
  const [template, setTemplate] = useState([])
  useEffect(() => {
    if (!image) {
      setTemplate([])
      return
    }
    if (image.isModel) {
      setTemplate(MODEL_TEMPLATE)
      return
    }
    setTemplate(fallbackTemplate())
    let alive = true
    getLandmarks(image)
      .then((landmarks) => alive && landmarks && setTemplate(buildTemplate(landmarks, image.naturalWidth, image.naturalHeight)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [image, getLandmarks])

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
        placeToken.current += 1
        const loaded = assignSides(
          savedPoints.map((p) =>
            withUid({
              region: p.region,
              point_key: p.point_key ?? '',
              treatment: p.treatment,
              x: p.x,
              y: p.y,
              amount: p.amount,
              technique: p.technique,
              depth: p.depth,
              lot_id: p.lot_id,
            }),
          ),
        )
        setPoints(loaded)
        setDetect('idle')
      } else {
        placeToken.current += 1 // descarta uma sugestão automática ainda em andamento
        setPoints([]) // foto nova: os pontos são colocados pelo profissional, região por região
        setDetect('idle')
      }
    },
    [],
  )

  // Rosto simétrico de referência no lugar da foto. Com pontos salvos, eles vêm junto.
  const showModel = useCallback((savedPoints) => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
    blobUrl.current = null
    placeToken.current += 1
    setPhoto(null)
    setImage(MODEL_FACE)
    setDetect('idle')
    setPoints(
      assignSides(
        (savedPoints ?? []).map((p) =>
          withUid({
            region: p.region,
            point_key: p.point_key ?? '',
            treatment: p.treatment,
            x: p.x,
            y: p.y,
            amount: p.amount,
            technique: p.technique,
            depth: p.depth,
            lot_id: p.lot_id,
          }),
        ),
      ),
    )
  }, [])

  useEffect(() => {
    // Com os dados ocultos não carrega nada. Ao mostrar de novo, se a foto já estava aberta, o rascunho continua como estava.
    if (patient.anonymized_at || image) return
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
        // Plano salvo sem foto e com pontos: foi feito sobre o rosto simétrico de referência.
        if (saved && !saved.photo_id && saved.points?.length) showModel(saved.points)
        else if (meta) await showPhoto(meta, saved?.points)
      } catch (err) {
        if (alive) setError(err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [patient.id, patient.anonymized_at, showPhoto, showModel])

  useEffect(() => () => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (e) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Esc encerra a marcação de pontos; sem marcação, volta para o rosto inteiro. Modal aberto ou campo em edição ficam com a tecla.
  useEffect(() => {
    if (!zone) return
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.overlay') || e.target.closest?.('input, select, textarea')) return
      if (adding) setAdding(false)
      else {
        setZone(null)
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zone, adding])

  // Ao abrir uma região, ou ao escolher a imagem, o rosto inteiro vem para a tela, com os controles que ficam embaixo dele.
  const stageWrap = useRef(null)
  const reveal = () =>
    requestAnimationFrame(() =>
      stageWrap.current?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      }),
    )
  useEffect(() => {
    if (zone) reveal()
  }, [zone?.region, zone?.side])

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
        return { ...p, amount: clampAmount(p.amount + direction * t.step) }
      }),
    )

  const typeAmount = (id, amount) =>
    edit((ps) =>
      ps.map((p) => (p.uid === id ? { ...p, amount, treatment: p.amount === 0 && amount > 0 ? treatment : p.treatment } : p)),
    )

  const movePoint = (id, x, y) => patchPoint(id, { x, y })
  const removePoint = (id) => {
    edit((ps) => ps.filter((p) => p.uid !== id))
    setSelected(null)
  }

  // `key` vem de uma posição sugerida tocada na imagem; toque livre cria ponto sem nome.
  function addPoint(x, y, key = '') {
    const t = treatmentOf(treatment)
    const point = withUid({ region: zone.region, side: zone.side, point_key: key, x, y, treatment: t.key, amount: t.initial })
    edit((ps) => [...ps, point])
    setSelected(point.uid)
    if (key) {
      setAdding(true) // tocar numa posição sugerida arma o tratamento: os próximos toques seguem marcando
      setShowMarks(true)
    }
  }

  // O tratamento escolhido sobre a imagem arma a marcação: cada toque coloca um ponto dele. Tocar de novo desarma.
  function pickTreatment(key) {
    const again = adding && treatment === key
    setTreatment(key)
    setAdding(!again)
    if (!again) setShowMarks(true) // o ponto novo precisa aparecer
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

  function toggleMarks() {
    if (showMarks) {
      setSimChoice(true) // sem os pontos na frente, mostra o resultado simulado
      setAdding(false)
    } else {
      setSimChoice(null) // pontos de volta: a simulação volta a seguir as quantidades
    }
    setShowMarks(!showMarks)
  }

  // ---- foto ----
  function addPhoto(file) {
    if (!file) return
    if (points.length) {
      setConfirm({
        title: 'Trocar a foto',
        message: 'Trocar a foto apaga os pontos colocados, porque as posições são da imagem atual. Continuar?',
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
      setShowMarks(true) // foto nova: pontos recriados ficam visíveis para ajuste
      setCamera(false)
      setDirty(true)
      reveal()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  // ---- rosto simétrico de referência e sugestão de pontos ----
  function chooseModelFace() {
    if (points.length) {
      setConfirm({
        title: 'Usar o rosto simétrico',
        message: 'Trocar para o rosto simétrico apaga os pontos colocados, porque as posições são da imagem atual. Continuar?',
        confirmLabel: 'Usar rosto simétrico',
        onConfirm: applyModelFace,
      })
      return
    }
    applyModelFace()
  }

  function applyModelFace() {
    showModel(null)
    closeRegion()
    setShowMarks(true)
    setCamera(false)
    setDirty(true)
    reveal()
  }

  // Opcional: o profissional pode pedir os pontos sugeridos (posicionados pelo rosto da foto, ou na posição padrão do
  // rosto de referência). Por padrão o plano começa vazio e as regiões aparecem conforme os pontos são colocados.
  async function suggestPoints() {
    setShowMarks(true)
    if (modelMode) {
      setPoints(MODEL_TEMPLATE.map((t) => withUid({ ...t, treatment: 'preenchimento', amount: 0 })))
      setDetect('idle')
    } else {
      await placeAutomatically(image)
    }
    setDirty(true)
  }

  // ---- salvar ----
  async function save() {
    setBusy(true)
    setError(null)
    const body = {
      photo_id: photo?.id ?? null,
      title: plan?.title ?? '',
      notes,
      points: points.map(({ region, point_key, treatment: t, x, y, amount, technique, depth, lot_id }) => ({
        region,
        point_key: point_key ?? '',
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

  if (patient.anonymized_at) {
    return (
      <div className="empty-state">
        <EyeOff size={28} />
        <h2>Planejamento oculto</h2>
        <p>A foto e os pontos continuam guardados. Use "Mostrar dados" para vê-los e editar o plano.</p>
      </div>
    )
  }
  if (loading) return <div className="boot">Carregando…</div>

  const applied = Boolean(plan?.applied_at)
  const lotOptions = (p) => {
    const unit = UNIT_BY_TREATMENT[p.treatment]
    const list = lots.filter((l) => l.unit === unit)
    return p.lot_id && !list.some((l) => l.id === p.lot_id) ? [...list, { id: p.lot_id, stale: true }] : list
  }
  const pickedLot = (p) => (p.lot_id ? lots.find((l) => l.id === p.lot_id) : null)
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

  const selectedIndex = zonePoints.findIndex((p) => p.uid === selected)
  const selectedPoint = selectedIndex >= 0 ? zonePoints[selectedIndex] : null
  const savedText = dirty ? 'Alterações não salvas' : plan ? `Salvo em ${new Date(plan.updated_at).toLocaleString('pt-BR')}` : ''

  return (
    <div className={`planning ${zone ? 'zoomed' : ''}`}>
      <section className="card planner-card">
        <header className="planner-head">
          <div className="planner-title">
            <ScanFace size={18} />
            <div>
              <strong>Planejamento facial</strong>
              <span className="planner-status">{savedText}</span>
            </div>
          </div>
          {/* Totais em uma linha, sem painel: a tela é do rosto. */}
          {!anamnesisDone && (
            <Link to="../anamnese" className="chip warn" title="Anamnese ainda não preenchida">
              Anamnese pendente
            </Link>
          )}
          <div className="totals">
            <span title="Total de unidades (toxina)">{formatAmount(totals.units)} U</span>
            <span title="Total de ml (preenchimento e demais)">{formatAmount(totals.ml)} ml</span>
            <span title="Número de áreas">
              {totals.areas} {totals.areas === 1 ? 'área' : 'áreas'}
            </span>
          </div>
          <div className="planner-actions">
            {image && (
              <select
                className="input mini region-jump"
                value=""
                onChange={(e) => e.target.value && openRegion(e.target.value)}
                aria-label="Ir para região"
              >
                <option value="">Ir para região…</option>
                {GROUPS.map((group) => (
                  <optgroup key={group.key} label={group.label}>
                    {REGIONS.filter((r) => r.group === group.key).map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            <button className="btn" onClick={() => setNotesOpen(true)}>
              <Pencil size={16} /> Observações{notes.trim() && <i className="has-notes" aria-label="com texto" />}
            </button>
            {applied ? (
              <button className="btn" onClick={startNewPlan}>
                Novo plano a partir deste
              </button>
            ) : (
              plan && (
                <button className="btn" onClick={askMarkApplied} disabled={busy || dirty} title={dirty ? 'Salve o plano antes' : undefined}>
                  <CheckCheck size={16} /> Marcar como aplicado
                </button>
              )
            )}
            <button className="btn primary" onClick={save} disabled={busy || (!photo && !modelMode) || applied}>
              <Save size={16} /> {busy ? 'Salvando…' : 'Salvar plano'}
            </button>
          </div>
        </header>

        {applied && (
          <div className="alert ok">Aplicado em {new Date(plan.applied_at).toLocaleString('pt-BR')}. Plano travado; estoque baixado.</div>
        )}
        <ErrorList error={error} />

        {!image ? (
          <div className="photo-empty">
            <ScanFace size={34} />
            <h2>Foto do paciente ou rosto simétrico</h2>
            <p>
              Tire ou envie a foto do paciente (rosto de frente, boa luz, cabelo afastado da testa), ou planeje sobre um rosto
              simétrico de referência, sem foto.
            </p>
            <div className="photo-actions">
              <button className="btn primary" onClick={() => setCamera(true)} disabled={busy}>
                <Camera size={17} /> Tirar foto
              </button>
              <button className="btn" onClick={() => fileInput.current.click()} disabled={busy}>
                <Upload size={17} /> Enviar foto
              </button>
              <button className="btn" onClick={chooseModelFace} disabled={busy}>
                <Smile size={17} /> Rosto simétrico
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={`planner ${zone ? 'zoomed' : ''}`}>
              <div ref={stageWrap} className={`planner-stage ${compare ? 'has-sim' : ''}`} style={{ '--aspect': image.naturalWidth / image.naturalHeight }}>
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
                  </div>
                )}

                <FaceStage
                  imageUrl={image.src}
                  alt={modelMode ? 'Rosto simétrico de referência' : 'Foto frontal do paciente'}
                  aspect={image.naturalWidth / image.naturalHeight}
                  points={points}
                  zone={zone}
                  selectedId={selected}
                  hoverRegion={hoverRegion}
                  suggested={suggested}
                  adding={adding && !applied}
                  readOnly={applied}
                  simUrl={compare ? simUrl : null}
                  split={split}
                  showMarks={showMarks}
                  template={template}
                  onPickRegion={openRegion}
                  onHoverRegion={setHoverRegion}
                  onSelectPoint={setSelected}
                  onMovePoint={movePoint}
                  onAddPoint={addPoint}
                />

                <div className="stage-tools" role="toolbar" aria-label="Ferramentas da imagem">
                  {!modelMode && (
                    <button
                      className={`tool ${compare ? 'on' : ''}`}
                      style={{ '--i': 0 }}
                      data-label="Simular resultado"
                      aria-label="Simular resultado"
                      aria-pressed={compare}
                      onClick={() => setSimChoice(!compare)}
                    >
                      <Sparkles size={18} />
                    </button>
                  )}
                  <button
                    className={`tool ${showMarks ? '' : 'on'}`}
                    style={{ '--i': 1 }}
                    data-label={showMarks ? 'Ocultar pontos' : 'Mostrar pontos'}
                    aria-label={showMarks ? 'Ocultar pontos' : 'Mostrar pontos'}
                    aria-pressed={!showMarks}
                    onClick={toggleMarks}
                  >
                    {showMarks ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  {!applied && !points.length && (
                    <button className="tool" style={{ '--i': 2 }} data-label="Sugerir pontos" aria-label="Sugerir pontos" onClick={suggestPoints} disabled={busy}>
                      <Wand2 size={18} />
                    </button>
                  )}
                  {!modelMode && (
                    <button className="tool" style={{ '--i': 3 }} data-label="Rosto simétrico" aria-label="Rosto simétrico" onClick={chooseModelFace} disabled={busy || applied}>
                      <Smile size={18} />
                    </button>
                  )}
                  <button
                    className="tool"
                    style={{ '--i': 4 }}
                    data-label={modelMode ? 'Usar foto do paciente' : 'Nova foto'}
                    aria-label={modelMode ? 'Usar foto do paciente' : 'Nova foto'}
                    onClick={() => setCamera(true)}
                    disabled={busy || applied}
                  >
                    <Camera size={18} />
                  </button>
                  <button
                    className="tool"
                    style={{ '--i': 5 }}
                    data-label={modelMode ? 'Enviar foto' : 'Trocar foto'}
                    aria-label={modelMode ? 'Enviar foto' : 'Trocar foto'}
                    onClick={() => fileInput.current.click()}
                    disabled={busy || applied}
                  >
                    <Upload size={18} />
                  </button>
                </div>

                {compare && (
                  <div className="sim-bar">
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
                    <small>Simulação ilustrativa a partir das quantidades planejadas. Não garante resultado clínico.</small>
                  </div>
                )}

                {!zone && showMarks && (
                  <p className="hud-hint hud-top" key="overview">
                    <MousePointerClick size={14} />
                    {DETECT_NOTE[detect] ??
                      (points.length
                        ? 'Toque numa região para ampliar e editar os pontos.'
                        : `${modelMode ? 'Rosto de referência. ' : ''}Toque numa região do rosto (por exemplo, o nariz) para começar.`)}
                  </p>
                )}

                {zone && !applied && (
                  <div className="hud-bottom" key={`${zone.region}-${zone.side}`}>
                    {selectedPoint && (
                      <div className="hud-point" key={selectedPoint.uid}>
                        <span className="badge" style={{ '--c': treatmentOf(selectedPoint.treatment).color }}>
                          {selectedIndex + 1}
                        </span>
                        <span className="hud-point-name">
                          {pointLabel(selectedPoint.region, selectedPoint.point_key) || `Ponto ${selectedIndex + 1}`}
                          <small>{treatmentOf(selectedPoint.treatment).label}</small>
                        </span>
                        <button className="icon-btn" onClick={() => stepAmount(selectedPoint.uid, -1)} disabled={selectedPoint.amount <= 0} aria-label="Diminuir o ponto selecionado">
                          <Minus size={14} />
                        </button>
                        <b className="hud-point-amount" aria-live="polite">
                          {formatAmount(selectedPoint.amount)} {treatmentOf(selectedPoint.treatment).unit}
                        </b>
                        <button className="icon-btn" onClick={() => stepAmount(selectedPoint.uid, 1)} aria-label="Aumentar o ponto selecionado">
                          <Plus size={14} />
                        </button>
                        <button className="icon-btn" onClick={() => removePoint(selectedPoint.uid)} aria-label="Remover o ponto selecionado">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                    <div className="treatments" role="group" aria-label="Tratamento a aplicar">
                      {TREATMENTS.map((t, i) => (
                        <button
                          key={t.key}
                          type="button"
                          className={`treatment ${adding && treatment === t.key ? 'active' : ''}`}
                          style={{ '--c': t.color, '--i': i }}
                          aria-pressed={adding && treatment === t.key}
                          onClick={() => pickTreatment(t.key)}
                        >
                          <i /> {t.label} <small>{t.unit}</small>
                        </button>
                      ))}
                    </div>
                    <p className="hud-hint">
                      {adding ? (
                        <>
                          Toque na imagem para marcar cada ponto de {treatmentOf(treatment).label}.
                          <button type="button" className="btn small" onClick={() => setAdding(false)}>
                            <Check size={14} /> Concluir
                          </button>
                        </>
                      ) : (
                        'Escolha o tratamento e toque na imagem para marcar os pontos.'
                      )}
                    </p>
                  </div>
                )}
              </div>

              {zone && (
                <aside className="zone-panel" key={`${zone.region}-${zone.side}`}>
                  <div className="card-title">
                    {regionLabel(zone.region)}
                    {SIDE_LABEL[zone.side] && ` · ${SIDE_LABEL[zone.side]}`}
                    <span className="sub">{describeTotals(totalsOf(zonePoints))}</span>
                  </div>
                  {regionOf(zone.region)?.risk && (
                    <p className="risk-note">
                      <AlertTriangle size={14} /> {regionOf(zone.region).risk}
                    </p>
                  )}
                  <fieldset className="point-list" disabled={applied}>
                    {zonePoints.map((p, index) => {
                      const t = treatmentOf(p.treatment)
                      const name = pointLabel(p.region, p.point_key)
                      return (
                        <Fragment key={p.uid}>
                          <div className={`prow ${selected === p.uid ? 'selected' : ''}`} onClick={() => setSelected(p.uid)}>
                            {name && <span className="pname">{name}</span>}
                            <span className="badge" style={{ '--c': t.color }}>
                              {index + 1}
                            </span>
                            <select
                              className="input mini"
                              value={p.treatment}
                              onChange={(e) => {
                                // Ponto zerado recebe o tratamento ativo ao ganhar quantidade: o ativo acompanha a escolha feita aqui.
                                if (p.amount === 0) setTreatment(e.target.value)
                                patchPoint(
                                  p.uid,
                                  UNIT_BY_TREATMENT[e.target.value] === UNIT_BY_TREATMENT[p.treatment]
                                    ? { treatment: e.target.value }
                                    : { treatment: e.target.value, lot_id: null },
                                )
                              }}
                              aria-label={`Tratamento do ponto ${index + 1}`}
                            >
                              {TREATMENTS.map((opt) => (
                                <option key={opt.key} value={opt.key}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <div className="amount">
                              <span className="amount-name">Quantidade</span>
                              <button className="icon-btn" onClick={() => stepAmount(p.uid, -1)} disabled={p.amount <= 0} aria-label="Diminuir">
                                <Minus size={14} />
                              </button>
                              <AmountField
                                value={p.amount}
                                onChange={(amount) => typeAmount(p.uid, amount)}
                                onStep={(direction) => stepAmount(p.uid, direction)}
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
                              <div className="lot">
                                <label>
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
                                {!applied && (
                                  <button type="button" className="btn small" onClick={() => setLotFor({ uid: p.uid, treatment: p.treatment })}>
                                    <PackagePlus size={15} /> Novo lote
                                  </button>
                                )}
                              </div>
                              {/* O select fechado corta o texto em tela estreita: o lote escolhido aparece inteiro aqui. */}
                              {pickedLot(p) && <p className="lot-picked">{lotLabel(pickedLot(p))}</p>}
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                    {!zonePoints.length && (
                      <p className="note">Nenhum ponto nesta região. Escolha o tratamento sobre a imagem e toque nela para marcar.</p>
                    )}
                  </fieldset>
                </aside>
              )}
            </div>
          </>
        )}
        {filePicker}
      </section>

      {image && !modelMode && <SymmetryPanel image={image} getLandmarks={getLandmarks} suggested={suggested} onSuggest={setSuggested} />}

      {notesOpen && (
        <Modal title="Observações" onClose={() => setNotesOpen(false)}>
          <textarea
            className="input"
            autoFocus
            disabled={applied}
            placeholder="Ex.: assimetria leve em malar direito. Paciente relata bruxismo."
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setDirty(true)
            }}
          />
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setNotesOpen(false)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
      {camera && <CameraCapture onCapture={addPhoto} onClose={() => setCamera(false)} />}
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {lotFor && (
        <NewLotModal
          treatment={lotFor.treatment}
          onClose={() => setLotFor(null)}
          onSaved={(lot) => {
            // O lote novo já é estoque de verdade; escolhê-lo no ponto é alteração do plano, como qualquer outra.
            setLots((ls) => [...ls, lot])
            patchPoint(lotFor.uid, { lot_id: lot.id })
            setLotFor(null)
          }}
        />
      )}
      {toastNode}
    </div>
  )
}
