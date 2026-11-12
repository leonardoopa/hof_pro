// Checks puros de technique.js: o "hoje" da clínica e o rótulo do lote.
import assert from 'node:assert/strict'
import { clinicToday, lotLabel } from './technique.js'

process.env.TZ = 'Asia/Tokyo' // aparelho noutro fuso: o dia continua sendo o da clínica (São Paulo)

// 23h30 do dia 10 em São Paulo já é dia 11 em Tóquio e em UTC.
assert.equal(clinicToday(new Date('2026-11-11T02:30:00Z')), '2026-11-10')
assert.equal(clinicToday(new Date('2026-11-11T03:00:00Z')), '2026-11-11')
// 9h do dia 11 em Tóquio ainda é dia 10 em São Paulo.
assert.equal(clinicToday(new Date('2026-11-11T00:00:00+09:00')), '2026-11-10')

assert.equal(
  lotLabel({ product_label: 'Marca Ácido', number: 'AH-02', expires_on: '2099-12-31', balance: 2.5, unit: 'ml' }),
  'Marca Ácido · lote AH-02 · val. 31/12/2099 · 2,5 ml',
)
console.log('technique.check ok')
