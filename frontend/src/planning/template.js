import { assignSides } from './regions'

// Gera os pontos de aplicação sugeridos. Coordenadas de saída normalizadas (0..1) sobre a foto.
// "D" = lado direito do paciente (esquerda da imagem); "E" = lado esquerdo (direita da imagem).
// Índices são do Face Mesh do MediaPipe (468 pontos).

const SIDES = {
  D: { sign: +1, browOuter: 70, browMid: 105, eyeOuter: 33, eyeInner: 133, lowerLid: 145, faceEye: 127, faceTop: 21, ala: 129, mouth: 61, jawAngle: 58, jawBody: 172 },
  E: { sign: -1, browOuter: 300, browMid: 334, eyeOuter: 263, eyeInner: 362, lowerLid: 374, faceEye: 356, faceTop: 251, ala: 358, mouth: 291, jawAngle: 288, jawBody: 397 },
}
// sign: direção "para dentro do rosto" no eixo x (+1 em D, -1 em E).

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export function buildTemplate(landmarks, width, height) {
  const P = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height })
  const faceW = Math.abs(P(454).x - P(234).x)
  const faceH = Math.abs(P(152).y - P(10).y)
  const eyeW = (Math.abs(P(33).x - P(133).x) + Math.abs(P(263).x - P(362).x)) / 2
  const out = []
  const add = (region, pt, side = 'C') =>
    out.push({ region, side, x: clamp01(pt.x / width), y: clamp01(pt.y / height) })

  // Testa: 5 pontos numa fileira entre a sobrancelha e a linha do cabelo.
  const browY = (P(105).y + P(334).y) / 2
  const rowY = browY + (P(10).y - browY) * 0.55
  const spanX = P(300).x - P(70).x
  const centerX = (P(300).x + P(70).x) / 2
  for (let k = -2; k <= 2; k++) {
    add('testa', { x: centerX + k * spanX * 0.22, y: rowY + Math.abs(k) * 0.012 * faceH })
  }

  for (const [side, s] of Object.entries(SIDES)) {
    const inward = (pt, amountOfFaceW) => ({ x: pt.x + s.sign * amountOfFaceW * faceW, y: pt.y })

    add('temporas', inward(mix(P(s.faceTop), P(s.faceEye), 0.55), 0.05), side)

    const lid = mix(P(s.lowerLid), P(s.eyeInner), 0.3)
    add('olheiras', { x: lid.x, y: lid.y + 0.28 * eyeW }, side)

    const eyeX = P(s.eyeOuter).x
    const alaX = P(s.ala).x
    const lidY = P(s.lowerLid).y
    const alaY = P(s.ala).y
    add('malar', { x: eyeX + (alaX - eyeX) * 0.05, y: lidY + (alaY - lidY) * 0.8 }, side)
    add('malar', { x: eyeX + (alaX - eyeX) * 0.4, y: lidY + (alaY - lidY) * 0.62 }, side)

    add('nasolabial', inward(mix(P(s.ala), P(s.mouth), 0.55), -0.04), side)

    const angle = inward(P(s.jawAngle), 0.035)
    add('mandibula', { x: angle.x, y: angle.y - 0.02 * faceH }, side)
    const body = inward(P(s.jawBody), 0.03)
    add('mandibula', { x: body.x, y: body.y - 0.01 * faceH }, side)
  }

  add('mento', mix(P(17), P(152), 0.62))
  return out
}

// Rosto não detectado: posições aproximadas para um retrato frontal centralizado.
export function fallbackTemplate() {
  return assignSides(fallbackPoints())
}

function fallbackPoints() {
  const at = (region, list) => list.map(([x, y]) => ({ region, x, y }))
  return [
    ...at('testa', [[0.38, 0.24], [0.44, 0.23], [0.5, 0.225], [0.56, 0.23], [0.62, 0.24]]),
    ...at('temporas', [[0.3, 0.33], [0.7, 0.33]]),
    ...at('olheiras', [[0.4, 0.46], [0.6, 0.46]]),
    ...at('malar', [[0.33, 0.52], [0.67, 0.52], [0.39, 0.57], [0.61, 0.57]]),
    ...at('nasolabial', [[0.43, 0.61], [0.57, 0.61]]),
    ...at('mandibula', [[0.33, 0.69], [0.67, 0.69], [0.38, 0.76], [0.62, 0.76]]),
    ...at('mento', [[0.5, 0.82]]),
  ]
}

const clamp01 = (n) => Math.min(1, Math.max(0, n))
