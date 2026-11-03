import { useState } from 'react'
import Modal from './Modal'

/** Substitui window.confirm: pergunta e executa onConfirm (pode ser assíncrono) ao confirmar. */
export default function ConfirmModal({ title, message, confirmLabel = 'Confirmar', danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={confirm} disabled={busy} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
