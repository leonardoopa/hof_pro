// Escore de simetria facial a partir dos landmarks do MediaPipe (Face Mesh, índices de template.js).
// É um APOIO ao planejamento: mede só a geometria da foto (pose, expressão e lente influenciam)
// e nunca substitui a avaliação clínica. "D" = lado direito do paciente (esquerda da imagem).

// Regiões comparadas: pares [direito, esquerdo] de landmarks e a região do planejamento que as cobre.
export const SYMMETRY_REGIONS = [
  { key: 'olhos', label: 'Olhos', planRegion: 'olheiras', pairs: [[33, 263], [133, 362]] },
  { key: 'sobrancelhas', label: 'Sobrancelhas', planRegion: 'testa', pairs: [[70, 300], [105, 334]] },
  { key: 'malar', label: 'Malar', planRegion: 'malar', pairs: [[50, 280], [116, 345]] },
  { key: 'comissuras', label: 'Comissuras labiais', planRegion: 'boca', pairs: [[61, 291]] },
  { key: 'mandibula', label: 'Mandíbula', planRegion: 'mandibula', pairs: [[58, 288], [172, 397]] },
]

const TOP = 10 // topo da testa
const CHIN = 152
const PUPILS = [468, 473] // centros da íris (só existem na saída de 478 pontos)
const EYE_CORNERS = [[33, 133], [263, 362]] // alternativa quando não há íris

/** Diferença acima da qual a região entra nas sugestões (em % da distância interpupilar). */
export const SUGGEST_THRESHOLD = 3

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function interpupillary(P, landmarks) {
  if (landmarks[PUPILS[0]] && landmarks[PUPILS[1]]) return dist(P(PUPILS[0]), P(PUPILS[1]))
  const [a, b] = EYE_CORNERS.map(([i, j]) => mid(P(i), P(j)))
  return dist(a, b)
}

/**
 * Calcula as assimetrias em relação à linha média (testa -> mento).
 * Para cada par: diferença da distância até a linha média (lateral) e da altura ao longo dela (vertical),
 * normalizadas pela distância interpupilar (resultado em % dela).
 * Retorna null se faltar landmark ou a medida de referência for inválida.
 */
export function computeSymmetry(landmarks, width = 1, height = 1) {
  if (!landmarks || landmarks.length < 468) return null
  const P = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height })
  const top = P(TOP)
  const chin = P(CHIN)
  const len = dist(top, chin)
  const ipd = interpupillary(P, landmarks)
  if (!len || !ipd) return null

  // Eixo unitário da linha média e seu perpendicular (apontando para a esquerda da imagem = direita do paciente).
  const ax = (chin.x - top.x) / len
  const ay = (chin.y - top.y) / len
  const nx = ay
  const ny = -ax
  const along = (p) => (p.x - top.x) * ax + (p.y - top.y) * ay
  const across = (p) => (p.x - top.x) * nx + (p.y - top.y) * ny // positivo no lado direito do paciente

  const regions = SYMMETRY_REGIONS.map((region) => {
    let lateral = 0 // distância D - distância E até a linha média
    let vertical = 0 // altura E - altura D (positivo: lado direito mais alto)
    for (const [r, l] of region.pairs) {
      const pr = P(r)
      const pl = P(l)
      lateral += Math.abs(across(pr)) - Math.abs(across(pl))
      vertical += along(pl) - along(pr)
    }
    lateral = (lateral / region.pairs.length / ipd) * 100
    vertical = (vertical / region.pairs.length / ipd) * 100

    const lateralDominant = Math.abs(lateral) >= Math.abs(vertical)
    const diff = Math.hypot(lateral, vertical)
    // Lado "menor": mais próximo da linha média (lateral) ou mais baixo (vertical).
    const side = lateralDominant ? (lateral < 0 ? 'D' : 'E') : vertical > 0 ? 'E' : 'D'
    return {
      key: region.key,
      label: region.label,
      planRegion: region.planRegion,
      lateral,
      vertical,
      diff,
      side: diff < 0.05 ? null : side,
      kind: lateralDominant ? 'lateral' : 'vertical',
    }
  })

  const mean = regions.reduce((sum, r) => sum + r.diff, 0) / regions.length
  const score = Math.max(0, Math.round(100 - mean * 4))
  return { score, band: bandOf(score), meanDiff: mean, regions }
}

export function bandOf(score) {
  if (score >= 85) return 'baixa'
  if (score >= 70) return 'leve'
  return 'moderada'
}

/** Regiões com maior assimetria (até 2), só as acima do limiar. Apenas destaca; não define doses. */
export function suggestRegions(result, threshold = SUGGEST_THRESHOLD) {
  if (!result) return []
  return [...result.regions]
    .sort((a, b) => b.diff - a.diff)
    .filter((r) => r.diff >= threshold)
    .slice(0, 2)
}
