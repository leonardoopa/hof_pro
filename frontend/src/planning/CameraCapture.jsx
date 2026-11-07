import { Camera, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Modal from '../components/Modal'
import PoseGuide from '../evolution/PoseGuide'

// Os padrões são os da foto do rosto; a foto da etiqueta troca câmera, textos e tira o guia de pose.
export default function CameraCapture({
  onCapture,
  onClose,
  title = 'Tirar foto do paciente',
  hint = 'Rosto de frente, olhar para a câmera, cabelo afastado da testa e boa luz.',
  facingMode = 'user',
  poseGuide = true,
}) {
  const videoRef = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [guide, setGuide] = useState(true)

  useEffect(() => {
    let stream
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1440 } } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        videoRef.current.srcObject = s
      })
      .catch(() => setError('Não foi possível acessar a câmera. Verifique a permissão do navegador ou envie uma foto.'))
    if (!navigator.mediaDevices) setError('Câmera indisponível neste navegador. Envie uma foto.')
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facingMode])

  function capture() {
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob((blob) => blob && onCapture(new File([blob], 'camera.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92)
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error ? (
        <div className="alert error">{error}</div>
      ) : (
        <div className="camera-wrap">
          <video ref={videoRef} className="camera" autoPlay playsInline muted onLoadedMetadata={() => setReady(true)} />
          {poseGuide && guide && <PoseGuide />}
        </div>
      )}
      <p className="camera-hint">{hint}</p>
      {poseGuide && (
        <label className="guide-toggle">
          <input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} /> Guia de pose (oval, olhos e eixo central)
        </label>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          <X size={16} /> Fechar
        </button>
        <button className="btn primary" onClick={capture} disabled={!ready || Boolean(error)}>
          <Camera size={16} /> Capturar
        </button>
      </div>
    </Modal>
  )
}
