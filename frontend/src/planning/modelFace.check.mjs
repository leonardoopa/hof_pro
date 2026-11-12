// Verificação do rosto de referência (sem runner no projeto): npm test
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { MODEL_FACE, MODEL_TEMPLATE } from './modelFace.js'
import { BILATERAL, REGIONS } from './regions.js'

// A imagem existe e tem o tamanho declarado (JPEG: marcador SOF0/SOF2 traz altura e largura).
const file = new URL('../../public/reference-face.jpg', import.meta.url)
assert.ok(existsSync(file), 'public/reference-face.jpg')
const jpeg = readFileSync(file)
let i = 2
let size = null
while (i < jpeg.length) {
  assert.equal(jpeg[i], 0xff, 'marcador JPEG')
  const marker = jpeg[i + 1]
  const length = jpeg.readUInt16BE(i + 2)
  if (marker === 0xc0 || marker === 0xc2) {
    size = { height: jpeg.readUInt16BE(i + 5), width: jpeg.readUInt16BE(i + 7) }
    break
  }
  i += 2 + length
}
assert.deepEqual(size, { width: MODEL_FACE.naturalWidth, height: MODEL_FACE.naturalHeight })
assert.equal(MODEL_FACE.src, '/reference-face.jpg')
assert.equal(MODEL_FACE.isModel, true)

// Posições sugeridas: toda região do catálogo, nos lados certos, dentro da imagem, sem ponto repetido.
const seen = new Set()
for (const p of MODEL_TEMPLATE) {
  const region = REGIONS.find((r) => r.key === p.region)
  assert.ok(region, `${p.region}: região fora do catálogo`)
  assert.ok(Object.hasOwn(region.points, p.point_key), `${p.region}.${p.point_key}: ponto fora de regions.js`)
  assert.equal(p.side, BILATERAL.has(p.region) ? p.side : 'C', `${p.region}: lado`)
  assert.ok(['C', 'D', 'E'].includes(p.side))
  for (const c of [p.x, p.y]) assert.ok(c >= 0 && c <= 1, `${p.region}.${p.point_key}: coordenada ${c}`)
  const id = `${p.region}|${p.side}|${p.point_key}`
  assert.ok(!seen.has(id), `${id} repetido`)
  seen.add(id)
  if (p.side === 'D') assert.ok(p.x < 0.5, `${id}: lado direito do paciente fica à esquerda da foto`)
  if (p.side === 'E') assert.ok(p.x > 0.5, `${id}: lado esquerdo do paciente fica à direita da foto`)
}
for (const region of REGIONS) {
  for (const key of Object.keys(region.points)) {
    assert.ok(seen.has(`${region.key}|${region.bilateral ? 'D' : 'C'}|${key}`), `falta ${region.key}.${key}`)
  }
}
assert.equal(new Set(MODEL_TEMPLATE.map((p) => p.region)).size, REGIONS.length)

// O rosto é quase simétrico: cada ponto D tem o espelho E perto de 1 - x (tolerância de 3% da largura).
for (const p of MODEL_TEMPLATE.filter((q) => q.side === 'D')) {
  const mirror = MODEL_TEMPLATE.find((q) => q.region === p.region && q.side === 'E' && q.point_key === p.point_key)
  assert.ok(mirror, `${p.region}.${p.point_key}: sem espelho`)
  assert.ok(Math.abs(mirror.x - (1 - p.x)) < 0.03 && Math.abs(mirror.y - p.y) < 0.03, `${p.region}.${p.point_key}: espelho longe`)
}
console.log('modelFace.check ok')
