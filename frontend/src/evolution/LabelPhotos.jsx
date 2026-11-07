import { Camera, Tag, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Modal from '../components/Modal'

export const LABEL_KIND = 'etiqueta'

// Etiqueta se fotografa com a câmera traseira e sem o guia de pose do rosto.
export const LABEL_CAMERA = {
  title: 'Tirar foto da etiqueta',
  hint: 'Etiqueta inteira no quadro, sem reflexo, com lote e validade legíveis.',
  facingMode: 'environment',
  poseGuide: false,
}

const when = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Baixa a foto (rota autenticada) como object URL, revogado ao desmontar. */
function usePhotoUrl(photoId) {
  const [state, setState] = useState({ id: null })

  useEffect(() => {
    let alive = true
    let url
    api.photos.objectUrl(photoId).then(
      (u) => {
        if (!alive) return URL.revokeObjectURL(u) // desmontou antes de a foto chegar
        url = u
        setState({ id: photoId, url: u })
      },
      () => alive && setState({ id: photoId, failed: true }),
    )
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [photoId])

  return state.id === photoId ? state : {}
}

function LabelThumb({ photo, onOpen }) {
  const { url, failed } = usePhotoUrl(photo.id)
  const date = when(photo.created_at)
  return (
    <button
      type="button"
      className="evo-label"
      onClick={() => onOpen({ date, url })}
      disabled={!url}
      aria-label={`Ampliar etiqueta de ${date}`}
    >
      <span className="evo-label-img">{url ? <img src={url} alt="" /> : failed ? 'Erro ao carregar' : 'Carregando…'}</span>
      <span className="evo-label-date">{date}</span>
    </button>
  )
}

/** Fotos da etiqueta da caixa do produto, guardadas com o paciente e fora da comparação antes/depois. */
export default function LabelPhotos({ photos, busy, onUpload, onCamera }) {
  // A foto ampliada reaproveita o object URL da miniatura: as duas só saem da tela juntas (nada se apaga).
  const [open, setOpen] = useState(null)

  return (
    <section className="card evo-labels" aria-label="Etiquetas dos produtos">
      <div className="card-title">
        <Tag size={18} /> Etiquetas dos produtos
      </div>
      <p className="note evo-labels-note">Foto da etiqueta da caixa (marca, lote e validade) para guardar com o paciente.</p>
      <div className="photo-actions evo-actions">
        <button className="btn" onClick={onUpload} disabled={busy}>
          <Upload size={16} /> Enviar foto da etiqueta
        </button>
        <button className="btn" onClick={onCamera} disabled={busy}>
          <Camera size={16} /> Tirar foto da etiqueta
        </button>
      </div>
      {photos.length ? (
        <div className="evo-label-grid">
          {photos.map((p) => (
            <LabelThumb key={p.id} photo={p} onOpen={setOpen} />
          ))}
        </div>
      ) : (
        <p className="note">Nenhuma etiqueta registrada para este paciente.</p>
      )}

      {open && (
        <Modal title={`Etiqueta de ${open.date}`} onClose={() => setOpen(null)} className="evo-label-modal">
          <img className="evo-label-full" src={open.url} alt={`Etiqueta do produto, foto de ${open.date}`} />
          <div className="modal-actions">
            <button className="btn" onClick={() => setOpen(null)}>
              <X size={16} /> Fechar
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
