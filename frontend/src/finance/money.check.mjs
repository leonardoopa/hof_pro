// Verificação do dinheiro do financeiro (sem runner no projeto): node src/finance/money.check.mjs
import assert from 'node:assert/strict'
import { MAX_CENTS, centsToInput, formatBRL, formatQty, lineTotalCents, parseBRL, parseQty } from './money.js'

// formatBRL: centavos inteiros -> "R$ 1.234,56"
assert.equal(formatBRL(0), 'R$ 0,00')
assert.equal(formatBRL(5), 'R$ 0,05')
assert.equal(formatBRL(100), 'R$ 1,00')
assert.equal(formatBRL(123456), 'R$ 1.234,56')
assert.equal(formatBRL(100_000_000), 'R$ 1.000.000,00')
assert.equal(formatBRL(-1200), '-R$ 12,00')
assert.equal(formatBRL(-5), '-R$ 0,05')
assert.equal(formatBRL(-123456), '-R$ 1.234,56')
assert.equal(formatBRL(Number.NaN), 'R$ 0,00')
assert.equal(formatBRL(undefined), 'R$ 0,00')
assert.equal(centsToInput(123456), '1.234,56')
assert.equal(centsToInput(0), '0,00')

// parseBRL: texto -> centavos, ou null
assert.equal(parseBRL('1.234,56'), 123456)
assert.equal(parseBRL('10'), 1000)
assert.equal(parseBRL('10,5'), 1050)
assert.equal(parseBRL('10,50'), 1050)
assert.equal(parseBRL('0'), 0)
assert.equal(parseBRL('0,01'), 1)
assert.equal(parseBRL('1234,56'), 123456)
assert.equal(parseBRL('1.234'), 123400) // ponto com 3 dígitos é milhar
assert.equal(parseBRL('10.5'), 1050) // ponto com 1 ou 2 casas é decimal
assert.equal(parseBRL('R$ 1.234,56'), 123456)
assert.equal(parseBRL('  10  '), 1000)
assert.equal(parseBRL('1.000.000,00'), MAX_CENTS)
for (const bad of ['', '   ', 'abc', '10a', '12,', ',5', '-5', '-10,00', '10,555', '1.2.3', '1..234', '10,5,5', 'R$', '1 000', '1.000.000,01', '9999999999999', null, undefined, 12]) {
  assert.equal(parseBRL(bad), null, `deve recusar ${JSON.stringify(bad)}`)
}
// ida e volta
for (const cents of [0, 1, 99, 100, 123456, MAX_CENTS]) assert.equal(parseBRL(centsToInput(cents)), cents)

// quantidade
assert.equal(parseQty('1'), 1)
assert.equal(parseQty('0,5'), 0.5)
assert.equal(parseQty('2,25'), 2.25)
assert.equal(parseQty('0'), 0)
assert.equal(parseQty('100000'), 100000)
for (const bad of ['', 'x', '1,234', '-1', '100000,01']) assert.equal(parseQty(bad), null, `deve recusar ${JSON.stringify(bad)}`)
assert.equal(formatQty(1.5), '1,5')
assert.equal(formatQty(2), '2')
assert.equal(formatQty(0.3), '0,3')

// total da linha: meio para cima ao centavo, como no servidor
assert.equal(lineTotalCents(2, 1050), 2100)
assert.equal(lineTotalCents(0.5, 1), 1) // 0,5 centavo sobe
assert.equal(lineTotalCents(0.5, 3), 2) // 1,5 sobe para 2
assert.equal(lineTotalCents(1.25, 100), 125)
assert.equal(lineTotalCents(0.3, 25000), 7500) // sem erro de float
assert.equal(lineTotalCents(100000, 100_000_000), 10_000_000_000_000)

console.log('money.check ok')
