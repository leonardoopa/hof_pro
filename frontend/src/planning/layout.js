// Layout dos hotspots da visão geral (sem zoom). Funções puras: entram centros em frações da foto (0..1)
// e o tamanho do palco em px; saem posições em frações e onde cada rótulo cabe.

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

const PLACES = { D: ['side', 'above', 'below'], E: ['side', 'above', 'below'], C: ['above', 'below'] }
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

/**
 * Escolhe onde cada rótulo fixo (`want`, região preenchida) aparece: ao lado, para fora do rosto, acima ou abaixo
 * do hotspot. A caixa é estimada pelo texto e segue o CSS. O rótulo fica dentro do palco e nunca cobre outro rótulo
 * nem hotspot preenchido. Prefere não cobrir hotspot vazio, mas pode: o rótulo não captura o clique e a lista de
 * regiões mostra todas. Sem lugar, devolve null e o rótulo fica só para hover/foco.
 */
export function fitLabels(items, { width, height, hotspot = 26, gap = 8, charWidth = 7, lineHeight = 17 }) {
  if (!width || !height) return items.map(() => null)
  const half = hotspot / 2
  const spots = items.map(({ x, y, want }) => ({
    want,
    l: x * width - half,
    r: x * width + half,
    t: y * height - half,
    b: y * height + half,
  }))

  const boxAt = (place, i) => {
    const { side, lines } = items[i]
    const { l, r, t, b } = spots[i]
    const w = Math.max(...lines.map((line) => line.length)) * charWidth + 20
    const h = lines.length * lineHeight + 6
    if (place === 'side') {
      const left = side === 'D' ? l - gap - w : r + gap
      return { l: left, r: left + w, t: (t + b - h) / 2, b: (t + b + h) / 2 }
    }
    const left = side === 'D' ? r + 4 - w : side === 'E' ? l - 4 : (l + r - w) / 2
    const top = place === 'above' ? t - gap - h : b + gap
    return { l: left, r: left + w, t: top, b: top + h }
  }

  const placed = []
  return items.map(({ want, side }, i) => {
    if (!want) return null
    const others = spots.filter((_, j) => j !== i)
    for (const blockers of [others, others.filter((spot) => spot.want)]) {
      for (const place of PLACES[side]) {
        const box = boxAt(place, i)
        const inside = box.l >= 0 && box.t >= 0 && box.r <= width && box.b <= height
        if (inside && ![...blockers, ...placed].some((other) => overlap(box, other))) {
          placed.push(box)
          return place
        }
      }
    }
    return null
  })
}
