import assert from 'node:assert/strict'
import { csvCell } from './csv.js'

assert.equal(csvCell('Ana'), '"Ana"')
assert.equal(csvCell(null), '""')
assert.equal(csvCell(12.5), '"12.5"')
assert.equal(csvCell('diz "oi"'), '"diz ""oi"""')
assert.equal(csvCell('a;b'), '"a;b"')
for (const bad of ['=1+1', '+SOMA(A1)', '-2', '@cmd', '\tx', '\rx']) {
  assert.ok(csvCell(bad).startsWith('"\''), `deve neutralizar ${JSON.stringify(bad)}`)
}
assert.equal(csvCell(-2), '"-2"') // número de verdade não é texto
console.log('csv.check ok')
