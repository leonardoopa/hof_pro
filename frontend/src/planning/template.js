import { assignSides } from './regions.js'

// Gera os pontos de aplicação sugeridos. Coordenadas de saída normalizadas (0..1) sobre a foto.
// "D" = lado direito do paciente (esquerda da imagem); "E" = lado esquerdo (direita da imagem).
// Índices são do Face Mesh do MediaPipe (468 pontos). Cada ponto leva o point_key do catálogo (regions.js).

const SIDES = {
  D: {
    sign: +1, browOuter: 70, browMid: 105, browInner: 107, eyeOuter: 33, eyeInner: 133, lowerLid: 145, faceEye: 127, faceTop: 21,
    ala: 129, alaTop: 49, noseSide: 196, noseRoot: 188, cheekbone: 116, cheek: 50, cheekLow: 187, mouth: 61, bow: 37,
    faceMid: 234, faceCheek: 93, faceRamus: 132, jawAngle: 58, jawBody: 172, jawRear: 136, jawMid: 150, jawFront: 149, jawChin: 176, chin: 171,
  },
  E: {
    sign: -1, browOuter: 300, browMid: 334, browInner: 336, eyeOuter: 263, eyeInner: 362, lowerLid: 374, faceEye: 356, faceTop: 251,
    ala: 358, alaTop: 279, noseSide: 419, noseRoot: 412, cheekbone: 345, cheek: 280, cheekLow: 411, mouth: 291, bow: 267,
    faceMid: 454, faceCheek: 323, faceRamus: 361, jawAngle: 288, jawBody: 397, jawRear: 365, jawMid: 379, jawFront: 378, jawChin: 400, chin: 396,
  },
}
// sign: direção "para dentro do rosto" no eixo x (+1 em D, -1 em E).

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export function buildTemplate(landmarks, width, height) {
  const P = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height })
  const faceW = Math.abs(P(454).x - P(234).x)
  const faceH = Math.abs(P(152).y - P(10).y)
  const eyeW = (Math.abs(P(33).x - P(133).x) + Math.abs(P(263).x - P(362).x)) / 2
  const out = []
  const add = (region, key, pt, side = 'C') =>
    out.push({ region, side, point_key: key, x: clamp01(pt.x / width), y: clamp01(pt.y / height) })
  // Região central com um ponto de cada lado: point_key termina em _d / _e.
  const paired = (region, key, at) => {
    for (const [side, s] of Object.entries(SIDES)) add(region, `${key}_${side.toLowerCase()}`, at(s))
  }

  // Testa: 5 pontos numa fileira entre a sobrancelha e a linha do cabelo.
  const browY = (P(105).y + P(334).y) / 2
  const rowY = browY + (P(10).y - browY) * 0.55
  const spanX = P(300).x - P(70).x
  const centerX = (P(300).x + P(70).x) / 2
  const FOREHEAD = ['frontal_lateral_d', 'frontal_medial_d', 'frontal_central', 'frontal_medial_e', 'frontal_lateral_e']
  for (let k = -2; k <= 2; k++) {
    add('testa', FOREHEAD[k + 2], { x: centerX + k * spanX * 0.22, y: rowY + Math.abs(k) * 0.012 * faceH })
  }

  // Glabela: prócero na linha média, entre as cabeças das sobrancelhas (acima do násio); corrugador medial logo
  // acima da cabeça da sobrancelha e lateral na linha da pupila, acima da sobrancelha.
  add('glabela', 'procero', P(8))
  paired('glabela', 'corrugador_medial', (s) => ({ x: P(s.browInner).x, y: P(s.browInner).y - 0.012 * faceH }))
  paired('glabela', 'corrugador_lateral', (s) => ({ x: (P(s.eyeOuter).x + P(s.eyeInner).x) / 2, y: P(s.browMid).y - 0.015 * faceH }))

  // Nariz: radix (násio), dorso, ponta e base da columela na linha média; bunny lines nas paredes laterais.
  add('nariz', 'radix', P(168))
  add('nariz', 'dorso', P(195))
  add('nariz', 'ponta', mix(P(4), P(1), 0.5))
  add('nariz', 'columela', mix(P(94), P(2), 0.5))
  paired('nariz', 'nasal', (s) => mix(P(s.noseSide), P(s.noseRoot), 0.4))

  for (const [side, s] of Object.entries(SIDES)) {
    const inward = (pt, amountOfFaceW) => ({ x: pt.x + s.sign * amountOfFaceW * faceW, y: pt.y })
    const d = side.toLowerCase()

    add('temporas', 'tempora', inward(mix(P(s.faceTop), P(s.faceEye), 0.55), 0.05), side)

    // Pés de galinha: leque de 3 pontos lateral ao canto externo do olho, por dentro do contorno do rosto.
    const crow = mix(P(s.eyeOuter), P(s.faceEye), 0.45)
    add('periorbital', 'superior', { x: crow.x + s.sign * 0.015 * faceW, y: crow.y - 0.05 * faceH }, side)
    add('periorbital', 'medio', crow, side)
    add('periorbital', 'inferior', { x: crow.x + s.sign * 0.015 * faceW, y: crow.y + 0.05 * faceH }, side)

    const lid = mix(P(s.lowerLid), P(s.eyeInner), 0.3)
    add('olheiras', 'sulco_lacrimal', { x: lid.x, y: lid.y + 0.28 * eyeW }, side)

    // Zigomático: arco junto ao contorno lateral; eminência entre o arco e o malar.
    add('zigomatico', 'arco', inward(P(s.faceMid), 0.045), side)
    add('zigomatico', 'eminencia', mix(P(s.cheekbone), P(s.cheek), 0.5), side)

    const eyeX = P(s.eyeOuter).x
    const alaX = P(s.ala).x
    const lidY = P(s.lowerLid).y
    const alaY = P(s.ala).y
    add('malar', 'lateral', { x: eyeX + (alaX - eyeX) * 0.05, y: lidY + (alaY - lidY) * 0.8 }, side)
    add('malar', 'medial', { x: eyeX + (alaX - eyeX) * 0.4, y: lidY + (alaY - lidY) * 0.62 }, side)

    add('submalar', 'depressao', inward(P(s.cheekLow), 0.03), side)

    add('nasolabial', 'sulco', inward(mix(P(s.ala), P(s.mouth), 0.55), -0.04), side)

    // LLSAN: sulco alar-facial, logo por fora da asa do nariz.
    add('gengival', 'llsan', inward(mix(P(s.ala), P(s.alaTop), 0.5), -0.012), side)

    // Marionete: da comissura para baixo; DAO lateral e abaixo, acima da borda da mandíbula.
    add('marionete', 'superior', mix(P(s.mouth), P(s.jawFront), 0.22), side)
    add('marionete', 'inferior', mix(P(s.mouth), P(s.jawFront), 0.5), side)
    add('dao', 'dao', mix(P(s.mouth), P(s.jawMid), 0.75), side)

    add('prejowl', 'sulco', { x: P(s.jawChin).x, y: P(s.jawChin).y - 0.015 * faceH }, side)

    const angle = inward(P(s.jawAngle), 0.035)
    add('mandibula', 'angulo', { x: angle.x, y: angle.y - 0.02 * faceH }, side)
    const body = inward(P(s.jawBody), 0.03)
    add('mandibula', 'corpo', { x: body.x, y: body.y - 0.01 * faceH }, side)

    // Masseter: terço inferior do músculo, acima do ângulo da mandíbula e por dentro do contorno.
    const ramus = mix(P(s.faceRamus), P(s.jawAngle), 0.5)
    add('masseter', 'superior', inward(mix(P(s.faceCheek), P(s.faceRamus), 0.8), 0.07), side)
    add('masseter', 'inferior_anterior', inward(ramus, 0.075), side)
    add('masseter', 'inferior_posterior', inward(ramus, 0.03), side)

    // Platisma: logo abaixo da borda da mandíbula (Nefertiti) e uma banda no pescoço.
    add('platisma', 'borda_anterior', { x: P(s.jawFront).x, y: P(s.jawFront).y + 0.025 * faceH }, side)
    add('platisma', 'borda_posterior', { x: inward(P(s.jawRear), 0.01).x, y: P(s.jawRear).y + 0.025 * faceH }, side)
    add('platisma', 'banda', { x: mix(P(152), P(s.jawFront), 0.55).x, y: P(152).y + 0.07 * faceH }, side)

    // Boca (pontos centrais, sem lado): arco do cupido, comissura e linhas periorais ("código de barras").
    add('boca', `arco_cupido_${d}`, P(s.bow))
    add('boca', `comissura_${d}`, P(s.mouth))
    const lipTop = P(0)
    add('boca', `perioral_${d}`, { x: lipTop.x + (P(s.mouth).x - lipTop.x) * 0.6, y: P(164).y + (lipTop.y - P(164).y) * 0.45 })
  }

  // Boca: centro do lábio superior e do inferior (contorno do vermelhão).
  add('boca', 'vermelhao_superior', mix(P(0), P(13), 0.45))
  add('boca', 'vermelhao_inferior', mix(P(17), P(14), 0.45))

  // Mento: pogônio (projeção) e os pontos do mentual, um de cada lado da linha média.
  add('mento', 'pogonio', mix(P(17), P(152), 0.62))
  paired('mento', 'mentual', (s) => mix(P(199), P(s.chin), 0.5))
  return out
}

// Rosto não detectado: posições aproximadas para um retrato frontal centralizado.
export function fallbackTemplate() {
  return assignSides(fallbackPoints())
}

function fallbackPoints() {
  const at = (region, list) => list.map(([x, y, point_key]) => ({ region, point_key, x, y }))
  return [
    ...at('testa', [[0.38, 0.24, 'frontal_lateral_d'], [0.44, 0.23, 'frontal_medial_d'], [0.5, 0.225, 'frontal_central'], [0.56, 0.23, 'frontal_medial_e'], [0.62, 0.24, 'frontal_lateral_e']]),
    ...at('glabela', [
      [0.5, 0.33, 'procero'], [0.46, 0.29, 'corrugador_medial_d'], [0.54, 0.29, 'corrugador_medial_e'],
      [0.4, 0.285, 'corrugador_lateral_d'], [0.6, 0.285, 'corrugador_lateral_e'],
    ]),
    ...at('temporas', [[0.3, 0.33, 'tempora'], [0.7, 0.33, 'tempora']]),
    ...at('periorbital', [
      [0.315, 0.39, 'superior'], [0.685, 0.39, 'superior'], [0.305, 0.425, 'medio'], [0.695, 0.425, 'medio'],
      [0.315, 0.46, 'inferior'], [0.685, 0.46, 'inferior'],
    ]),
    ...at('olheiras', [[0.4, 0.46, 'sulco_lacrimal'], [0.6, 0.46, 'sulco_lacrimal']]),
    ...at('nariz', [
      [0.5, 0.37, 'radix'], [0.5, 0.47, 'dorso'], [0.5, 0.565, 'ponta'], [0.5, 0.61, 'columela'], [0.475, 0.44, 'nasal_d'], [0.525, 0.44, 'nasal_e'],
    ]),
    ...at('zigomatico', [[0.265, 0.485, 'arco'], [0.735, 0.485, 'arco'], [0.295, 0.505, 'eminencia'], [0.705, 0.505, 'eminencia']]),
    ...at('malar', [[0.33, 0.52, 'lateral'], [0.67, 0.52, 'lateral'], [0.39, 0.57, 'medial'], [0.61, 0.57, 'medial']]),
    ...at('submalar', [[0.355, 0.6, 'depressao'], [0.645, 0.6, 'depressao']]),
    ...at('nasolabial', [[0.43, 0.61, 'sulco'], [0.57, 0.61, 'sulco']]),
    ...at('gengival', [[0.44, 0.565, 'llsan'], [0.56, 0.565, 'llsan']]),
    ...at('boca', [
      [0.5, 0.68, 'vermelhao_superior'], [0.5, 0.725, 'vermelhao_inferior'], [0.465, 0.667, 'arco_cupido_d'], [0.535, 0.667, 'arco_cupido_e'],
      [0.42, 0.7, 'comissura_d'], [0.58, 0.7, 'comissura_e'], [0.43, 0.655, 'perioral_d'], [0.57, 0.655, 'perioral_e'],
    ]),
    ...at('marionete', [[0.42, 0.73, 'superior'], [0.58, 0.73, 'superior'], [0.42, 0.765, 'inferior'], [0.58, 0.765, 'inferior']]),
    ...at('dao', [[0.39, 0.785, 'dao'], [0.61, 0.785, 'dao']]),
    ...at('mento', [[0.5, 0.82, 'pogonio'], [0.475, 0.835, 'mentual_d'], [0.525, 0.835, 'mentual_e']]),
    ...at('prejowl', [[0.43, 0.84, 'sulco'], [0.57, 0.84, 'sulco']]),
    ...at('mandibula', [[0.33, 0.69, 'angulo'], [0.67, 0.69, 'angulo'], [0.38, 0.76, 'corpo'], [0.62, 0.76, 'corpo']]),
    ...at('masseter', [
      [0.305, 0.62, 'superior'], [0.695, 0.62, 'superior'], [0.34, 0.665, 'inferior_anterior'], [0.66, 0.665, 'inferior_anterior'],
      [0.305, 0.665, 'inferior_posterior'], [0.695, 0.665, 'inferior_posterior'],
    ]),
    ...at('platisma', [
      [0.42, 0.865, 'borda_anterior'], [0.58, 0.865, 'borda_anterior'], [0.37, 0.82, 'borda_posterior'], [0.63, 0.82, 'borda_posterior'],
      [0.45, 0.91, 'banda'], [0.55, 0.91, 'banda'],
    ]),
  ]
}

const clamp01 = (n) => Math.min(1, Math.max(0, n))
