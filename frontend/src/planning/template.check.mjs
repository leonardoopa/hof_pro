// Verificação do modelo de pontos (sem runner no projeto): node src/planning/template.check.mjs
// Rosto de teste: fixtures/canonical-face.json, os 468 pontos do canonical_face_model.obj do MediaPipe
// (Apache-2.0) projetados de frente numa imagem 1000x1250, com a linha média em x = 0.5.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

// O Vite resolve import relativo sem extensão ("./regions"); o Node não. Tenta "<spec>.js" quando falha.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\//.test(specifier) && !/\.[cm]?js$/.test(specifier)) {
        return nextResolve(`${specifier}.js`, context)
      }
      throw err
    }
  },
})
const { BILATERAL, REGIONS } = await import('./regions.js')
const { buildTemplate, fallbackTemplate } = await import('./template.js')

const face = JSON.parse(readFileSync(new URL('./fixtures/canonical-face.json', import.meta.url), 'utf8'))
const L = (i) => face.landmarks[i]
const built = buildTemplate(face.landmarks, face.width, face.height)
const fallback = fallbackTemplate()

const find = (pts, region, key, side) => {
  const p = pts.find((q) => q.region === region && q.point_key === key && (!side || q.side === side))
  assert.ok(p, `ponto ${region}.${key}${side ? ` ${side}` : ''} não encontrado`)
  return p
}

for (const [name, pts] of [['buildTemplate', built], ['fallbackTemplate', fallback]]) {
  const where = (p) => `${name}: ${p.region}.${p.point_key} ${p.side}`
  for (const region of REGIONS) {
    const own = pts.filter((p) => p.region === region.key)
    const sides = new Set(own.map((p) => p.side))
    assert.ok(own.length, `${name}: região ${region.key} sem pontos`)
    assert.deepEqual([...sides].sort(), region.bilateral ? ['D', 'E'] : ['C'], `${name}: lados de ${region.key}`)
    // região bilateral: os mesmos pontos nomeados dos dois lados
    if (region.bilateral) {
      const keysOf = (side) => own.filter((p) => p.side === side).map((p) => p.point_key).sort()
      assert.deepEqual(keysOf('D'), keysOf('E'), `${name}: pontos de ${region.key} diferem entre D e E`)
    }
  }
  assert.equal(new Set(pts.map((p) => p.region)).size, REGIONS.length, `${name}: região fora do catálogo`)

  const seen = new Set()
  for (const p of pts) {
    const region = REGIONS.find((r) => r.key === p.region)
    assert.ok(region, `${where(p)}: região fora do catálogo`)
    assert.equal(p.side, BILATERAL.has(p.region) ? p.side : 'C', `${where(p)}: região central com lado`)
    assert.match(p.point_key, /^[a-z0-9_]{1,40}$/, `${where(p)}: point_key inválido`) // mesmo formato do backend
    assert.ok(Object.hasOwn(region.points, p.point_key), `${where(p)}: point_key fora de regions.js`)
    const id = `${p.region}|${p.side}|${p.point_key}`
    assert.ok(!seen.has(id), `${where(p)}: point_key repetido`)
    seen.add(id)
    for (const c of [p.x, p.y]) assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `${where(p)}: coordenada ${c} fora de 0..1`)
    // D = lado direito do paciente = esquerda da foto (linha média em x = 0.5 nos dois casos)
    if (p.side === 'D' || p.point_key.endsWith('_d')) assert.ok(p.x < 0.5, `${where(p)}: D deveria estar à esquerda da foto`)
    if (p.side === 'E' || p.point_key.endsWith('_e')) assert.ok(p.x > 0.5, `${where(p)}: E deveria estar à direita da foto`)
  }
  // todo ponto nomeado do catálogo aparece no modelo
  for (const region of REGIONS) {
    for (const key of Object.keys(region.points)) assert.ok(seen.has(`${region.key}|${region.bilateral ? 'D' : 'C'}|${key}`), `${name}: falta ${region.key}.${key}`)
  }

  // Rosto simétrico: cada ponto D/E (ou _d/_e) tem o espelho no outro lado.
  for (const p of pts) {
    const mirror = p.side === 'D' ? find(pts, p.region, p.point_key, 'E')
      : p.point_key.endsWith('_d') ? find(pts, p.region, p.point_key.replace(/_d$/, '_e'))
      : null
    if (!mirror) continue
    assert.ok(Math.abs(p.x - (1 - mirror.x)) < 1e-3 && Math.abs(p.y - mirror.y) < 1e-3, `${where(p)}: não espelha ${mirror.side}`)
  }
}

// Relações anatômicas no rosto canônico (buildTemplate).
const D = (region, key) => find(built, region, key, 'D')
const E = (region, key) => find(built, region, key, 'E')

const procero = find(built, 'glabela', 'procero')
assert.ok(procero.x > L(107).x && procero.x < L(336).x, 'prócero entre as cabeças das sobrancelhas (107/336)')
assert.ok(procero.y < find(built, 'nariz', 'radix').y, 'prócero acima do radix')
for (const side of ['d', 'e']) {
  const medial = find(built, 'glabela', `corrugador_medial_${side}`)
  const lateral = find(built, 'glabela', `corrugador_lateral_${side}`)
  assert.ok(Math.abs(lateral.x - 0.5) > Math.abs(medial.x - 0.5), `corrugador lateral ${side} mais longe da linha média que o medial`)
  assert.ok(medial.y < procero.y, `corrugador medial ${side} acima do prócero`)
}

const radix = find(built, 'nariz', 'radix')
const dorso = find(built, 'nariz', 'dorso')
const ponta = find(built, 'nariz', 'ponta')
const columela = find(built, 'nariz', 'columela')
assert.ok(radix.y < dorso.y && dorso.y < ponta.y && ponta.y < columela.y, 'nariz: radix, dorso, ponta e columela de cima para baixo')
assert.ok(columela.y < L(0).y, 'columela acima do lábio superior (0)')

for (const key of ['superior', 'medio', 'inferior']) {
  assert.ok(D('periorbital', key).x < L(33).x, `pé de galinha ${key} D lateral ao canto externo do olho (33)`)
  assert.ok(E('periorbital', key).x > L(263).x, `pé de galinha ${key} E lateral ao canto externo do olho (263)`)
  assert.ok(D('periorbital', key).x > L(234).x, `pé de galinha ${key} D por dentro do contorno do rosto`)
}
assert.ok(D('periorbital', 'superior').y < D('periorbital', 'medio').y && D('periorbital', 'medio').y < D('periorbital', 'inferior').y, 'pés de galinha em leque vertical')

for (const key of ['superior', 'inferior_anterior', 'inferior_posterior']) {
  assert.ok(D('masseter', key).x > L(234).x, `masseter ${key} D medial ao contorno do rosto (234)`)
  assert.ok(E('masseter', key).x < L(454).x, `masseter ${key} E medial ao contorno do rosto (454)`)
  assert.ok(D('masseter', key).y > L(1).y, `masseter ${key} abaixo da ponta do nariz`)
}
assert.ok(D('masseter', 'inferior_anterior').x > D('masseter', 'inferior_posterior').x, 'masseter anterior mais perto da linha média que o posterior')

for (const key of ['borda_anterior', 'borda_posterior', 'banda']) {
  assert.ok(D('platisma', key).y > L(key === 'borda_posterior' ? 136 : 149).y, `platisma ${key} abaixo da borda da mandíbula`)
}
assert.ok(D('platisma', 'banda').y > L(152).y && E('platisma', 'banda').y > L(152).y, 'banda do platisma abaixo do mento (152)')

assert.ok(D('zigomatico', 'arco').x < D('zigomatico', 'eminencia').x, 'arco zigomático lateral à eminência')
assert.ok(D('olheiras', 'sulco_lacrimal').y > L(145).y, 'sulco lacrimal abaixo da pálpebra inferior (145)')
assert.ok(D('gengival', 'llsan').x < L(129).x, 'LLSAN por fora da asa do nariz (129)')
assert.ok(D('marionete', 'superior').y < D('marionete', 'inferior').y && D('marionete', 'superior').y > L(61).y, 'marionete abaixo da comissura (61)')
assert.ok(D('dao', 'dao').y > D('marionete', 'superior').y, 'DAO abaixo da marionete superior')
const pogonio = find(built, 'mento', 'pogonio')
assert.ok(pogonio.y > L(17).y && pogonio.y < L(152).y, 'pogônio entre o lábio inferior (17) e o mento (152)')

console.log(`template ok: ${built.length} pontos no rosto canônico, ${fallback.length} no modelo sem rosto, ${REGIONS.length} regiões`)
