import { useEffect, useRef } from 'react'
import { contain, similarity } from './alignment'

const MAX_WIDTH = 1200

/** Matriz (em pixels da foto "antes") que posiciona a foto "depois"; alinhada por olhos, se possível. */
export function placeAfter(before, after, align) {
  const bw = before.img.naturalWidth
  const bh = before.img.naturalHeight
  if (align && before.eyes && after.eyes) {
    const m = similarity(after.eyes, before.eyes)
    if (m) return { matrix: m, aligned: true }
  }
  return { matrix: contain(after.img.naturalWidth, after.img.naturalHeight, bw, bh), aligned: false }
}

/**
 * Canvas único: "antes" inteiro e, à direita do divisor, o "depois" já alinhado.
 * split = posição do divisor em % da largura.
 */
export default function CompareCanvas({ before, after, align, split }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const bw = before.img.naturalWidth
    const bh = before.img.naturalHeight
    const k = Math.min(1, MAX_WIDTH / bw)
    canvas.width = Math.round(bw * k)
    canvas.height = Math.round(bh * k)
    const ctx = canvas.getContext('2d')
    const edge = canvas.width * (split / 100)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(before.img, 0, 0, canvas.width, canvas.height)

    ctx.save()
    ctx.beginPath()
    ctx.rect(edge, 0, canvas.width - edge, canvas.height)
    ctx.clip()
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--stage-bg') || '#e9e5ee'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.transform(...placeAfter(before, after, align).matrix)
    ctx.drawImage(after.img, 0, 0)
    ctx.restore()

    // divisor
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
    ctx.shadowBlur = 4
    ctx.fillRect(edge - 1.5, 0, 3, canvas.height)
  }, [before, after, align, split])

  return (
    <canvas
      ref={ref}
      className="compare-canvas"
      role="img"
      aria-label="Comparação antes e depois"
    />
  )
}
