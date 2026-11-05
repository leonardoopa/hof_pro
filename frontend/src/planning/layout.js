// Layout dos hotspots da visão geral (sem zoom). Funções puras: entram centros em frações da foto (0..1)
// e o tamanho do palco em px; saem posições em frações e quais rótulos cabem.

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

/**
 * Afasta hotspots mais próximos que `min` px: cada par sobreposto é empurrado para lados opostos pela metade
 * da falta, algumas rodadas. Determinística (mesma entrada, mesma saída) e sempre dentro da foto.
 */
export function spreadHotspots(items, { width, height, min = 28, rounds = 40 }) {
  if (!width || !height) return items.map(({ x, y }) => ({ x, y }))
  const pts = items.map(({ x, y }) => ({ x: x * width, y: y * height }))
  const half = min / 2
  for (let round = 0; round < rounds; round++) {
    let moved = false
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]
        const b = pts[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= min - 0.01) continue
        if (d < 0.01) [dx, dy, d] = [1, 0, 1] // mesmo centro: separa na horizontal
        const push = (min - d) / 2
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
        moved = true
      }
    }
    for (const p of pts) {
      p.x = clamp(p.x, half, width - half)
      p.y = clamp(p.y, half, height - half)
    }
    if (!moved) break
  }
  return pts.map(({ x, y }) => ({ x: x / width, y: y / height }))
}

/**
 * Decide quais rótulos fixos (`want`) aparecem sem cobrir outro rótulo. A caixa é estimada pelo texto e segue
 * o CSS: acima do hotspot, D cresce para a esquerda, E para a direita, C centralizado. Na ordem recebida, o
 * rótulo que encostaria num já posto fica só para hover/foco.
 */
export function fitLabels(items, { width, height, hotspot = 26, charWidth = 7, lineHeight = 17 }) {
  const placed = []
  return items.map(({ x, y, side, lines, want }) => {
    if (!want || !width || !height) return false
    const w = Math.max(...lines.map((line) => line.length)) * charWidth + 20
    const h = lines.length * lineHeight + 6
    const cx = x * width
    const bottom = y * height - hotspot / 2 - 8
    const left = side === 'D' ? cx + hotspot / 2 + 4 - w : side === 'E' ? cx - hotspot / 2 - 4 : cx - w / 2
    const box = { l: left, r: left + w, t: bottom - h, b: bottom }
    if (placed.some((o) => box.l < o.r && o.l < box.r && box.t < o.b && o.t < box.b)) return false
    placed.push(box)
    return true
  })
}
