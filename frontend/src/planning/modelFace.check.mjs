// Verificação do rosto simétrico de referência (sem runner no projeto): npm test
import assert from 'node:assert/strict'
import { MODEL_FACE, modelFaceSvg } from './modelFace.js'

const svg = modelFaceSvg()
assert.match(svg, /^<svg [^>]*viewBox="0 0 800 1000"/)
assert.ok(MODEL_FACE.src.startsWith('data:image/svg+xml'))
assert.equal(MODEL_FACE.naturalWidth / MODEL_FACE.naturalHeight, 0.8) // mesma proporção do retrato do fallbackTemplate

// Simetria por construção: o x de cada ponto do lado esquerdo é 800 - x do lado direito.
const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
const coords = (d) => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])])
const centered = paths.filter((d) => coords(d).every(([x]) => x === 400))
assert.ok(centered.length >= 1, 'linha média no centro')
const sides = paths.filter((d) => !centered.includes(d) && coords(d).some(([x]) => x !== 400))
let pairs = 0
for (const a of sides) {
  const mirror = coords(a).map(([x, y]) => `${(800 - x).toFixed(1)} ${y.toFixed(1)}`).join('|')
  if (sides.some((b) => b !== a && coords(b).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('|') === mirror)) pairs += 1
}
assert.ok(pairs >= 14, `esperava ao menos 7 pares de traços espelhados, achei ${pairs / 2}`)
console.log('modelFace.check ok')
