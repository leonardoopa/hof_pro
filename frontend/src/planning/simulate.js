// Pré-visualização ilustrativa feita no navegador. Não é um modelo clínico nem generativo:
//  - toxina (U): suaviza a pele ao redor do ponto (efeito de relaxamento das linhas);
//  - produtos em ml: abaulamento local (efeito de volume), limitado para não distorcer o rosto;
//  - boca: preenchimento/bioestimulador aumenta o volume do lábio (elipse horizontal, leve realce de cor);
//    toxina/skinbooster suaviza as linhas periorais ("código de barras").
// A intensidade cresce com a quantidade planejada.
import { treatmentOf } from './regions'

const MAX_SIDE = 1200

// Quanto cada produto "empurra" a pele para fora (fração máxima do deslocamento).
const VOLUME_GAIN = { preenchimento: 1, bioestimulador: 0.6, skinbooster: 0.3, outro: 0.8 }

// Suavização: toxina em qualquer região; skinbooster só na boca (linhas periorais).
const isSmoothing = (p) => treatmentOf(p.treatment).unit === 'U' || (p.region === 'boca' && p.treatment === 'skinbooster')

function boxBlur(src, w, h, radius, passes = 2) {
  let a = Float32Array.from(src)
  let b = new Float32Array(src.length)
  const size = radius * 2 + 1
  for (let n = 0; n < passes; n++) {
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let x = -radius; x <= radius; x++) sum += a[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c]
        for (let x = 0; x < w; x++) {
          b[(y * w + x) * 4 + c] = sum / size
          sum += a[(y * w + Math.min(w - 1, x + radius + 1)) * 4 + c] - a[(y * w + Math.max(0, x - radius)) * 4 + c]
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let y = -radius; y <= radius; y++) sum += b[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c]
        for (let y = 0; y < h; y++) {
          a[(y * w + x) * 4 + c] = sum / size
          sum += b[(Math.min(h - 1, y + radius + 1) * w + x) * 4 + c] - b[(Math.max(0, y - radius) * w + x) * 4 + c]
        }
      }
    }
  }
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < out.length; i++) out[i] = i % 4 === 3 ? 255 : a[i]
  return out
}

function sample(data, w, h, x, y, out) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  for (let c = 0; c < 3; c++) {
    const top = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx
    const bottom = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx
    out[c] = top * (1 - fy) + bottom * fy
  }
}

const smooth = (t) => t * t * (3 - 2 * t)

export function renderSimulation(image, points) {
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
  const w = Math.round(image.naturalWidth * scale)
  const h = Math.round(image.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)

  const active = points.filter((p) => p.amount > 0)
  if (!active.length) return canvas

  const img = ctx.getImageData(0, 0, w, h)
  let data = img.data

  // 1) suavização (toxina; skinbooster na boca)
  const toxin = active.filter(isSmoothing)
  if (toxin.length) {
    const blurred = boxBlur(data, w, h, Math.max(3, Math.round(w * 0.01)), 3)
    for (const p of toxin) {
      const cx = p.x * w
      const cy = p.y * h
      const r = w * (0.06 + 0.02 * Math.sqrt(p.amount)) * (p.region === 'boca' ? 0.8 : 1)
      const strength = treatmentOf(p.treatment).unit === 'U' ? Math.min(0.92, 0.45 + 0.07 * p.amount) : Math.min(0.9, 0.5 + 0.4 * p.amount)
      for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x++) {
          const d = Math.hypot(x - cx, y - cy) / r
          if (d >= 1) continue
          const k = strength * smooth(1 - d)
          const i = (y * w + x) * 4
          for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - k) + blurred[i + c] * k
        }
      }
    }
  }

  // 2) volume (preenchimento, bioestimulador, skinbooster, outro)
  const out = [0, 0, 0]
  for (const p of active.filter((q) => !isSmoothing(q))) {
    const lips = p.region === 'boca'
    const cx = p.x * w
    const cy = p.y * h
    const r = w * (lips ? 0.03 + 0.022 * Math.sqrt(p.amount) : 0.045 + 0.035 * Math.sqrt(p.amount))
    const rx = lips ? r * 1.35 : r // lábio: elipse mais larga que alta
    const ry = lips ? r * 0.85 : r
    const gain = Math.min(lips ? 0.5 : 0.4, 0.17 * Math.sqrt(p.amount) + 0.06) * (VOLUME_GAIN[p.treatment] ?? 1)
    const before = new Uint8ClampedArray(data)
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
        const t = Math.hypot((x - cx) / rx, (y - cy) / ry)
        if (t >= 1) continue
        const pull = 1 - gain * (1 - t * t) ** 2
        sample(before, w, h, cx + (x - cx) * pull, cy + (y - cy) * pull, out)
        const i = (y * w + x) * 4
        const light = 1 + 0.12 * gain * (1 - t) // realce no topo do volume
        const warm = lips ? 1 + 0.25 * gain * (1 - t) : 1 // lábio ganha um pouco de cor
        data[i] = Math.min(255, out[0] * light * warm)
        data[i + 1] = Math.min(255, out[1] * light)
        data[i + 2] = Math.min(255, out[2] * light)
      }
    }
  }

  ctx.putImageData(img, 0, 0)
  return canvas
}
