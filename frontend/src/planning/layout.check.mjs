// Verificação do layout dos hotspots (sem runner no projeto): npm test
// Usa os centros reais da visão geral: um hotspot por região e lado, no rosto canônico e no modelo padrão.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fitLabels, spreadHotspots } from './layout.js'
import { buildTemplate, fallbackTemplate } from './template.js'

const face = JSON.parse(readFileSync(new URL('./fixtures/canonical-face.json', import.meta.url), 'utf8'))

function hotspots(points) {
  const groups = new Map()
  for (const p of points) {
    const key = `${p.region}-${p.side}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.values()].map((pts) => ({
    side: pts[0].side,
    x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
    y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
  }))
}

function minDistance(items, { width, height }) {
  let min = Infinity
  items.forEach((a, i) => {
    for (const b of items.slice(i + 1)) min = Math.min(min, Math.hypot((a.x - b.x) * width, (a.y - b.y) * height))
  })
  return min
}

const SURFACES = {
  'rosto canônico': hotspots(buildTemplate(face.landmarks, face.width, face.height)),
  'modelo padrão': hotspots(fallbackTemplate()),
}
const STAGES = [
  { width: 340, height: 425 },
  { width: 480, height: 600 },
  { width: 900, height: 1125 },
]

for (const [name, items] of Object.entries(SURFACES)) {
  assert.equal(items.length, 33, `${name}: esperava 33 hotspots`)
  for (const stage of STAGES) {
    const where = `${name} em ${stage.width}x${stage.height}`
    const spread = spreadHotspots(items, stage)
    assert.ok(minDistance(spread, stage) >= 27.9, `${where}: hotspots a menos de 28 px`)
    for (const [i, p] of spread.entries()) {
      assert.ok(p.x * stage.width >= 14 - 1e-6 && p.x * stage.width <= stage.width - 14 + 1e-6, `${where}: hotspot ${i} fora da foto em x`)
      assert.ok(p.y * stage.height >= 14 - 1e-6 && p.y * stage.height <= stage.height - 14 + 1e-6, `${where}: hotspot ${i} fora da foto em y`)
      // Hotspot que anda muito deixa de indicar a própria região.
      const moved = Math.hypot((p.x - items[i].x) * stage.width, (p.y - items[i].y) * stage.height)
      assert.ok(moved <= 15, `${where}: hotspot ${i} andou ${moved.toFixed(1)} px`)
    }
    assert.deepEqual(spreadHotspots(items, stage), spread, `${where}: layout não determinístico`)

    // Todas as regiões preenchidas: o rótulo fixo aparece onde cabe e os demais ficam para hover/foco.
    const labels = spread.map((p, i) => ({ ...p, side: items[i].side, lines: ['Nome da região', '1 ml'], want: true }))
    const shown = fitLabels(labels, stage).filter(Boolean).length
    assert.ok(shown >= 5 && shown <= items.length, `${where}: ${shown} rótulos fixos`)
  }
}

// Hotspots já afastados ficam onde estão.
const far = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }]
assert.deepEqual(spreadHotspots(far, { width: 500, height: 500 }), far)

// Mesmo centro: separa em vez de dividir por zero.
const twins = spreadHotspots([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }], { width: 500, height: 500 })
assert.ok(Math.hypot((twins[0].x - twins[1].x) * 500, (twins[0].y - twins[1].y) * 500) >= 27.9, 'mesmo centro não separou')

// Palco ainda sem tamanho (antes do primeiro ResizeObserver): não mexe em nada e não mostra rótulo.
assert.deepEqual(spreadHotspots(far, { width: 0, height: 0 }), far)
assert.deepEqual(fitLabels([{ ...far[0], side: 'C', lines: ['Testa'], want: true }], { width: 0, height: 0 }), [false])

const STAGE = { width: 500, height: 500 }
const label = (x, y, side, want = true) => ({ x, y, side, lines: ['Nome da região'], want })

// Sem quantidade: sem rótulo fixo, e não ocupa lugar de outro.
assert.deepEqual(fitLabels([label(0.5, 0.5, 'C', false), label(0.5, 0.5, 'C')], STAGE), [false, true])
// Mesmo lugar: fica o primeiro.
assert.deepEqual(fitLabels([label(0.5, 0.5, 'C'), label(0.5, 0.5, 'C')], STAGE), [true, false])
// D cresce para a esquerda e E para a direita: pares simétricos no mesmo y não colidem.
assert.deepEqual(fitLabels([label(0.4, 0.5, 'D'), label(0.6, 0.5, 'E')], STAGE), [true, true])
// Invertidos, os dois crescem para o meio e colidem.
assert.deepEqual(fitLabels([label(0.6, 0.5, 'D'), label(0.4, 0.5, 'E')], STAGE), [true, false])

console.log('layout.check: ok')
