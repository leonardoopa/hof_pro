import { Camera, Columns2, EyeOff, ImagePlus, ScanFace, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { useToast } from '../components/Toast'
import CameraCapture from '../planning/CameraCapture'
import { detectFace } from '../planning/faceLandmarks'
import { eyeCenters } from './alignment'
import '../styles/evolution.css'
import CompareCanvas, { placeAfter } from './CompareCanvas'
import LabelPhotos, { LABEL_CAMERA, LABEL_KIND } from './LabelPhotos'

const KINDS = [
  { value: 'frontal', label: 'Frontal' },
  { value: 'perfil_direito', label: 'Perfil direito' },
  { value: 'perfil_esquerdo', label: 'Perfil esquerdo' },
  { value: 'outra', label: 'Outra' },
]
const kindLabel = (kind) => KINDS.find((k) => k.value === kind)?.label ?? kind
// A etiqueta do produto não é foto do rosto: fica no próprio card e fora da comparação.
const isFace = (p) => p.kind !== LABEL_KIND

const photoLabel = (p) =>
  `${kindLabel(p.kind)} · ${new Date(p.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/** Baixa a foto (rota autenticada) e detecta o rosto no navegador. status: loading | ready | error. */
function usePhotoData(photoId) {
  const [data, setData] = useState({ id: null, status: 'loading' })

  useEffect(() => {
    if (photoId == null) return
    let alive = true
    let url
    ;(async () => {
      try {
        url = await api.photos.objectUrl(photoId)
        const img = await loadImage(url)
        if (alive) setData({ id: photoId, status: 'ready', img, eyes: null, detect: 'running' })
        let eyes = null
        let detect = 'none'
        try {
          eyes = eyeCenters(await detectFace(img), img.naturalWidth, img.naturalHeight)
          detect = eyes ? 'found' : 'none'
        } catch {
          detect = 'error'
        }
        if (alive) setData({ id: photoId, status: 'ready', img, eyes, detect })
      } catch {
        if (alive) setData({ id: photoId, status: 'error' })
      }
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [photoId])

  return photoId == null || data.id !== photoId ? { status: 'loading' } : data
}

export default function EvolutionPage() {
  const { patient } = useOutletContext()
  const [photos, setPhotos] = useState(null)
  const [error, setError] = useState(null)
  const [beforeId, setBeforeId] = useState(null)
  const [afterId, setAfterId] = useState(null)
  const [align, setAlign] = useState(true)
  const [split, setSplit] = useState(50)
  const [uploadKind, setUploadKind] = useState('frontal')
  const [camera, setCamera] = useState(null) // tipo da foto que a câmera aberta vai enviar
  const [busy, setBusy] = useState(false)
  const [toast, toastNode] = useToast()
  const fileInput = useRef(null)
  const fileKind = useRef(null) // tipo escolhido pelo botão que abriu o seletor de arquivo

  function pickFile(kind) {
    fileKind.current = kind
    fileInput.current.click()
  }

  function pickDefaults(list) {
    // A API devolve da mais nova para a mais antiga: "depois" = mais nova, "antes" = mais antiga do mesmo tipo.
    const newest = list[0]
    const oldest = [...list].reverse().find((p) => p.kind === newest?.kind && p.id !== newest.id) ?? list[1]
    setAfterId(newest?.id ?? null)
    setBeforeId(oldest?.id ?? null)
  }

  useEffect(() => {
    if (patient.anonymized_at) return
    let alive = true
    setPhotos(null)
    api.photos
      .list(patient.id)
      .then((list) => {
        if (!alive) return
        setPhotos(list)
        pickDefaults(list.filter(isFace))
      })
      .catch((err) => alive && setError(err))
    return () => {
      alive = false
    }
  }, [patient.id, patient.anonymized_at])

  async function upload(file, kind) {
    setBusy(true)
    setError(null)
    try {
      const meta = await api.photos.upload(patient.id, file, kind)
      setPhotos((list) => [meta, ...(list ?? [])])
      if (kind === LABEL_KIND) {
        toast('Etiqueta adicionada.')
      } else {
        setBeforeId((id) => id ?? afterId) // até aqui só havia uma foto: ela vira o "antes"
        setAfterId(meta.id) // a foto nova entra como "depois"
        toast('Foto adicionada.')
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const facePhotos = photos?.filter(isFace) ?? []
  const labelPhotos = photos?.filter((p) => !isFace(p)) ?? []
  const before = usePhotoData(beforeId)
  const after = usePhotoData(afterId)
  const ready = before.status === 'ready' && after.status === 'ready'
  const beforeMeta = photos?.find((p) => p.id === beforeId)
  const afterMeta = photos?.find((p) => p.id === afterId)
  const mixedKinds = beforeMeta && afterMeta && beforeMeta.kind !== afterMeta.kind
  const aligned = useMemo(() => ready && placeAfter(before, after, align).aligned, [ready, before, after, align])

  let note = ''
  if (ready) {
    if (!align) note = 'Alinhamento desligado: a foto "depois" é só encaixada no quadro.'
    else if (aligned) note = 'Fotos alinhadas pelos olhos (escala, rotação e posição). Arraste o controle para comparar.'
    else if (before.detect === 'running' || after.detect === 'running') note = 'Detectando o rosto nas fotos…'
    else if (before.detect === 'error' || after.detect === 'error')
      note = 'Detecção indisponível (sem conexão?): fotos sobrepostas sem alinhamento.'
    else note = 'Rosto não detectado em uma das fotos: sobrepostas sem alinhamento.'
  }

  const fileAndCamera = (
    <>
      <label className="evo-kind">
        <span>Tipo da nova foto</span>
        <select className="input mini" value={uploadKind} onChange={(e) => setUploadKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <button className="btn" onClick={() => pickFile(uploadKind)} disabled={busy}>
        <Upload size={16} /> Enviar foto
      </button>
      <button className="btn" onClick={() => setCamera(uploadKind)} disabled={busy}>
        <Camera size={16} /> Tirar foto
      </button>
    </>
  )

  if (patient.anonymized_at) {
    return (
      <div className="empty-state">
        <EyeOff size={28} />
        <h2>Fotos ocultas</h2>
        <p>As fotos continuam guardadas. Use "Mostrar dados" para vê-las.</p>
      </div>
    )
  }
  if (error && !photos) return <ErrorList error={error} />
  if (!photos) return <div className="boot">Carregando…</div>

  return (
    <div className="evolution">
      <ErrorList error={error} />
      {/* Um só seletor de arquivo para as fotos do rosto e as etiquetas: o botão que o abre define o tipo. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) upload(file, fileKind.current ?? uploadKind)
        }}
      />

      {facePhotos.length < 2 ? (
        <div className="empty-state">
          <ImagePlus size={28} />
          <h2>Comparação antes e depois</h2>
          <p>
            {facePhotos.length === 0 ? 'Este paciente ainda não tem fotos.' : 'Este paciente tem apenas uma foto.'} Envie ou
            tire pelo menos duas fotos (com a mesma pose) para compará-las alinhadas pelo rosto.
          </p>
          <div className="photo-actions">{fileAndCamera}</div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="evo-pickers">
              {[
                ['Antes', beforeId, setBeforeId],
                ['Depois', afterId, setAfterId],
              ].map(([label, value, set]) => (
                <label key={label} className="field">
                  <span>{label}</span>
                  <select className="input" value={value ?? ''} onChange={(e) => set(Number(e.target.value))}>
                    {facePhotos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {photoLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="photo-actions evo-actions">{fileAndCamera}</div>
            {mixedKinds && (
              <div className="alert warn">
                As fotos são de tipos diferentes ({kindLabel(beforeMeta.kind)} e {kindLabel(afterMeta.kind)}). O
                alinhamento por olhos funciona melhor com duas fotos frontais.
              </div>
            )}
          </div>

          <div className="card evo-stage-card">
            <div className="stage-toolbar">
              <strong>
                <Columns2 size={16} /> Comparação
              </strong>
              <label className="split">
                <input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} />
                <ScanFace size={15} /> Alinhar pelo rosto
              </label>
            </div>

            {before.status === 'error' || after.status === 'error' ? (
              <div className="alert error">Não foi possível carregar uma das fotos.</div>
            ) : !ready ? (
              <div className="evo-loading">Carregando fotos…</div>
            ) : (
              <>
                <div className="evo-frame" style={{ '--aspect': before.img.naturalWidth / before.img.naturalHeight }}>
                  <CompareCanvas before={before} after={after} align={align} split={split} />
                  <span className="evo-tag left">Antes</span>
                  <span className="evo-tag right">Depois</span>
                </div>
                <div className="stage-foot">
                  <label className="split evo-slider">
                    <span>Divisor</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={split}
                      onChange={(e) => setSplit(Number(e.target.value))}
                      aria-label="Posição do divisor entre antes e depois"
                    />
                  </label>
                </div>
                <p className="note center">{note}</p>
              </>
            )}
          </div>
        </>
      )}

      <LabelPhotos
        photos={labelPhotos}
        busy={busy}
        onUpload={() => pickFile(LABEL_KIND)}
        onCamera={() => setCamera(LABEL_KIND)}
      />

      {camera && (
        <CameraCapture
          {...(camera === LABEL_KIND ? LABEL_CAMERA : {})}
          onClose={() => setCamera(null)}
          onCapture={(file) => {
            setCamera(null)
            upload(file, camera)
          }}
        />
      )}
      {toastNode}
    </div>
  )
}
