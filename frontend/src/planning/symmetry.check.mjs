// Verificação do cálculo de simetria (sem runner no projeto): node src/planning/symmetry.check.mjs
import assert from 'node:assert/strict'
import { computeSymmetry, suggestRegions } from './symmetry.js'

// Rosto sintético simétrico em torno de x = 0.5 (imagem 1000x1000).
const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
const set = (i, x, y) => (lm[i] = { x, y })
set(10, 0.5, 0.1)
set(152, 0.5, 0.9)
set(468, 0.4, 0.4) // pupila D (esquerda da imagem)
set(473, 0.6, 0.4)
const pairs = [[33, 263, 0.35, 0.4], [133, 362, 0.45, 0.4], [70, 300, 0.34, 0.3], [105, 334, 0.42, 0.3], [50, 280, 0.32, 0.55], [116, 345, 0.28, 0.5], [61, 291, 0.42, 0.7], [58, 288, 0.3, 0.75], [172, 397, 0.36, 0.8]]
for (const [r, l, dx, y] of pairs) {
  set(r, 0.5 - dx + 0.2 * 0, y)
  set(l, 0.5 + (0.5 - (0.5 - dx)), y)
}
const sym = computeSymmetry(lm, 1000, 1000)
assert.ok(sym.score >= 99, `esperado ~100, veio ${sym.score}`)
assert.equal(suggestRegions(sym).length, 0)

// Comissura direita 5% da largura mais perto da linha média e mais alta -> região comissuras lidera.
const bad = lm.map((p) => ({ ...p }))
bad[61] = { x: bad[61].x + 0.05, y: bad[61].y - 0.02 }
const asym = computeSymmetry(bad, 1000, 1000)
const top = suggestRegions(asym)[0]
assert.equal(top.key, 'comissuras')
assert.equal(top.side, 'D') // lado direito do paciente está mais perto da linha média
assert.ok(asym.score < sym.score)
// IPD = 200 px; deslocamento lateral de 50 px => 25% da IPD
assert.ok(Math.abs(top.lateral + 25) < 0.5, `lateral ${top.lateral}`)

// Inclinação da cabeça (rotação) não deve criar assimetria.
const ang = 0.2
const rot = lm.map(({ x, y }) => {
  const dx = x - 0.5, dy = y - 0.5
  return { x: 0.5 + dx * Math.cos(ang) - dy * Math.sin(ang), y: 0.5 + dx * Math.sin(ang) + dy * Math.cos(ang) }
})
assert.ok(computeSymmetry(rot, 1000, 1000).score >= 99)

assert.equal(computeSymmetry(null), null)
console.log('symmetry ok: score', sym.score, '->', asym.score)
