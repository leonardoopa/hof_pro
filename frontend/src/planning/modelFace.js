// Rosto simétrico de referência: um desenho de linhas, sem foto, para planejar sem a imagem do paciente.
// Metade direita desenhada em frações (0..1) e espelhada em x, então o rosto é simétrico por construção.
// As posições seguem o `fallbackTemplate` (template.js): olhos em y≈0.42, boca em y≈0.70, mento em y≈0.82.
const W = 800
const H = 1000

const mirrorX = (x) => 1 - x
const pt = (x, y) => `${(x * W).toFixed(1)} ${(y * H).toFixed(1)}`

/** Caminho de uma curva de Bézier cúbica de cada lado: `[x, y]` pontos da metade direita (x ≥ 0.5). */
function mirrored(segments) {
  const right = segments.map(([cmd, ...pts]) => `${cmd} ${pts.map(([x, y]) => pt(x, y)).join(' ')}`).join(' ')
  const left = segments.map(([cmd, ...pts]) => `${cmd} ${pts.map(([x, y]) => pt(mirrorX(x), y)).join(' ')}`).join(' ')
  return [right, left]
}

const STROKE = '#8e79b8'
const stroke = (d, extra = '') => `<path d="${d}" fill="none" stroke="${STROKE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`

export function modelFaceSvg() {
  const parts = []

  // contorno do rosto (do topo da cabeça até o mento), pescoço e orelhas
  parts.push(
    ...mirrored([
      ['M', [0.5, 0.09]],
      ['C', [0.68, 0.09], [0.77, 0.22], [0.77, 0.4]],
      ['C', [0.77, 0.58], [0.74, 0.7], [0.68, 0.79]],
      ['C', [0.63, 0.86], [0.57, 0.895], [0.5, 0.895]],
    ]).map((d) => stroke(d, 'fill-opacity="0"')),
  )
  parts.push(...mirrored([['M', [0.6, 0.87]], ['L', [0.62, 1]]]).map((d) => stroke(d)))
  parts.push(...mirrored([['M', [0.775, 0.43]], ['C', [0.83, 0.42], [0.84, 0.56], [0.78, 0.61]]]).map((d) => stroke(d)))
  // linha do cabelo
  parts.push(...mirrored([['M', [0.5, 0.17]], ['Q', [0.64, 0.17], [0.74, 0.3]]]).map((d) => stroke(d, 'stroke-dasharray="2 9" opacity="0.7"')))
  // sobrancelhas, olhos e íris
  parts.push(...mirrored([['M', [0.555, 0.35]], ['Q', [0.63, 0.315], [0.71, 0.345]]]).map((d) => stroke(d)))
  parts.push(...mirrored([['M', [0.565, 0.415]], ['Q', [0.635, 0.385], [0.705, 0.415]], ['Q', [0.635, 0.44], [0.565, 0.415]]]).map((d) => stroke(d)))
  for (const x of [0.635, mirrorX(0.635)]) parts.push(`<circle cx="${x * W}" cy="${0.413 * H}" r="13" fill="${STROKE}" opacity="0.55"/>`)
  // nariz
  parts.push(...mirrored([['M', [0.525, 0.4]], ['L', [0.532, 0.545]], ['C', [0.558, 0.56], [0.553, 0.6], [0.53, 0.605]], ['Q', [0.515, 0.615], [0.5, 0.615]]]).map((d) => stroke(d)))
  // boca
  parts.push(...mirrored([['M', [0.5, 0.675]], ['Q', [0.535, 0.665], [0.58, 0.7]], ['Q', [0.54, 0.745], [0.5, 0.745]]]).map((d) => stroke(d)))
  parts.push(...mirrored([['M', [0.5, 0.706]], ['Q', [0.54, 0.708], [0.58, 0.7]]]).map((d) => stroke(d)))
  // linha média
  parts.push(`<path d="M ${pt(0.5, 0.09)} L ${pt(0.5, 0.895)}" stroke="${STROKE}" stroke-width="2" stroke-dasharray="3 10" opacity="0.45" fill="none"/>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="#f5f1fb"/>` +
    `<path d="M ${pt(0.5, 0.09)} C ${pt(0.68, 0.09)} ${pt(0.77, 0.22)} ${pt(0.77, 0.4)} C ${pt(0.77, 0.58)} ${pt(0.74, 0.7)} ${pt(0.68, 0.79)} C ${pt(0.63, 0.86)} ${pt(0.57, 0.895)} ${pt(0.5, 0.895)} ` +
    `C ${pt(0.43, 0.895)} ${pt(0.37, 0.86)} ${pt(0.32, 0.79)} C ${pt(0.26, 0.7)} ${pt(0.23, 0.58)} ${pt(0.23, 0.4)} C ${pt(0.23, 0.22)} ${pt(0.32, 0.09)} ${pt(0.5, 0.09)} Z" fill="#ffffff" opacity="0.9"/>` +
    parts.join('') +
    '</svg>'
}

/** Substituto de uma imagem carregada: o palco só precisa de `src` e do tamanho natural. */
export const MODEL_FACE = {
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(modelFaceSvg())}`,
  naturalWidth: W,
  naturalHeight: H,
  isModel: true,
}
