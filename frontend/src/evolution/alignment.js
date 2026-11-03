// Alinhamento "depois" -> "antes" por transformação de similaridade (escala + rotação + translação).
// Dois pontos bastam para determinar a transformação: usamos o centro de cada olho (média dos dois
// cantos do olho no Face Mesh do MediaPipe). Tudo em pixels da imagem de origem.

// Índices do MediaPipe Face Mesh (478 pontos). "direito/esquerdo" é do ponto de vista do paciente.
const RIGHT_EYE = [33, 133] // canto externo, canto interno
const LEFT_EYE = [362, 263] // canto interno, canto externo

const mid = (landmarks, [i, j], w, h) => ({
  x: ((landmarks[i].x + landmarks[j].x) / 2) * w,
  y: ((landmarks[i].y + landmarks[j].y) / 2) * h,
})

/** Centro dos dois olhos em pixels, ou null se os landmarks não vierem. */
export function eyeCenters(landmarks, width, height) {
  if (!landmarks || landmarks.length < 364) return null
  return { a: mid(landmarks, RIGHT_EYE, width, height), b: mid(landmarks, LEFT_EYE, width, height) }
}

/**
 * Matriz [a, b, c, d, e, f] (formato de ctx.setTransform) que leva os olhos de `from` sobre os de `to`.
 * Retorna null se os olhos coincidirem (distância zero).
 */
export function similarity(from, to) {
  const fx = from.b.x - from.a.x
  const fy = from.b.y - from.a.y
  const tx = to.b.x - to.a.x
  const ty = to.b.y - to.a.y
  const fromLen = Math.hypot(fx, fy)
  const toLen = Math.hypot(tx, ty)
  if (fromLen < 1e-6 || toLen < 1e-6) return null
  const scale = toLen / fromLen
  const angle = Math.atan2(ty, tx) - Math.atan2(fy, fx)
  const cos = Math.cos(angle) * scale
  const sin = Math.sin(angle) * scale
  // t = to.a - sR * from.a  (os olhos "a" coincidem; "b" coincide por construção)
  const e = to.a.x - (cos * from.a.x - sin * from.a.y)
  const f = to.a.y - (sin * from.a.x + cos * from.a.y)
  return [cos, sin, -sin, cos, e, f]
}

/** Aplica a matriz a um ponto (usado nos testes e para conferir o alinhamento). */
export const apply = ([a, b, c, d, e, f], p) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f })

/** Matriz que encaixa a imagem (iw x ih) dentro do quadro (cw x ch) sem cortar, centralizada. */
export function contain(iw, ih, cw, ch) {
  const s = Math.min(cw / iw, ch / ih)
  return [s, 0, 0, s, (cw - iw * s) / 2, (ch - ih * s) / 2]
}
