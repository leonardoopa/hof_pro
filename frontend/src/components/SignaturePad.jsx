import { useEffect, useImperativeHandle, useRef, useState } from 'react'

// Campo de assinatura em canvas (mouse, toque e caneta via Pointer Events).
export default function SignaturePad({ padRef, onChange }) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useImperativeHandle(padRef, () => ({
    clear() {
      const c = canvas.current
      c.getContext('2d').clearRect(0, 0, c.width, c.height)
      setEmpty(true)
      onChange?.(true)
    },
    isEmpty: () => empty,
    toDataURL: () => canvas.current.toDataURL('image/png'),
  }))

  // Resolução proporcional ao tamanho na tela (nítida em telas de alta densidade).
  useEffect(() => {
    const c = canvas.current
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    c.width = c.clientWidth * ratio
    c.height = c.clientHeight * ratio
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111'
  }, [])

  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  function down(e) {
    e.preventDefault()
    canvas.current.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvas.current.getContext('2d')
    const [x, y] = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 0.01, y) // ponto simples também deixa marca
    ctx.stroke()
    if (empty) {
      setEmpty(false)
      onChange?.(false)
    }
  }

  function move(e) {
    if (!drawing.current) return
    const ctx = canvas.current.getContext('2d')
    const [x, y] = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  return (
    <canvas
      ref={canvas}
      className="sig-canvas"
      aria-label="Campo de assinatura"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => (drawing.current = false)}
      onPointerCancel={() => (drawing.current = false)}
    />
  )
}
