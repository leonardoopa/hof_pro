// Verificação do agrupamento do histórico por mês (sem runner no projeto): node src/pages/timeline.check.mjs
import assert from 'node:assert/strict'
import { formatWhen, groupByMonth, isUpcoming, itemPath, monthKey, monthLabel } from './timeline.js'

const item = (at, kind = 'plano', ref = { type: 'plan', id: 1 }) => ({ at, kind, title: kind, detail: '', ref })

// O mês vale no fuso da clínica (UTC-3), não no UTC: 1º de dezembro 01:00Z ainda é 30 de novembro à noite em São Paulo.
assert.equal(monthKey('2026-12-01T01:00:00Z'), '2026-11')
assert.equal(monthKey('2026-12-01T03:00:00Z'), '2026-12')
assert.equal(monthKey('2026-01-15T12:00:00.123456Z'), '2026-01')

assert.equal(monthLabel('2026-11'), 'Novembro de 2026')
assert.equal(monthLabel('2027-03'), 'Março de 2027')

// Agrupa na ordem recebida (do mais novo para o mais antigo), sem reordenar nem perder item.
const items = [
  item('2026-12-02T15:00:00Z', 'agendamento'),
  item('2026-12-01T01:00:00Z', 'aplicacao'),
  item('2026-11-10T12:00:00Z', 'termo'),
  item('2026-11-02T12:00:00Z', 'foto'),
  item('2025-12-31T12:00:00Z', 'anamnese'),
]
const groups = groupByMonth(items)
assert.deepEqual(
  groups.map((g) => [g.key, g.label, g.items.map((i) => i.kind)]),
  [
    ['2026-12', 'Dezembro de 2026', ['agendamento']],
    ['2026-11', 'Novembro de 2026', ['aplicacao', 'termo', 'foto']],
    ['2025-12', 'Dezembro de 2025', ['anamnese']],
  ],
)
assert.deepEqual(groupByMonth([]), [])
assert.deepEqual(groupByMonth(undefined), [])

// Hora no fuso da clínica, sempre no mesmo formato.
assert.equal(formatWhen('2026-11-20T17:05:00Z'), '20/11/2026 14:05')
assert.equal(formatWhen('2026-12-01T01:00:00Z'), '30/11/2026 22:00')

// O que ainda vai acontecer (agendamento futuro) é marcado.
const now = new Date('2026-11-20T12:00:00Z')
assert.equal(isUpcoming(item('2026-11-21T12:00:00Z'), now), true)
assert.equal(isUpcoming(item('2026-11-20T11:59:00Z'), now), false)

// Cada referência leva à aba certa do paciente (ou à agenda, que não é do paciente).
const at = (type) => itemPath({ ref: { type, id: 7 } }, 42)
assert.equal(at('plan'), '/pacientes/42/planejamento')
assert.equal(at('application'), '/pacientes/42/prontuario')
assert.equal(at('signature'), '/pacientes/42/prontuario')
assert.equal(at('adverse_event'), '/pacientes/42/intercorrencias')
assert.equal(at('photo'), '/pacientes/42/evolucao')
assert.equal(at('anamnesis'), '/pacientes/42/anamnese')
assert.equal(at('appointment'), '/agenda')
assert.equal(at('budget'), '/financeiro')
assert.equal(at('desconhecido'), null) // tipo sem tela: o item aparece, sem link
assert.equal(itemPath({ ref: null }, 42), null)

console.log('timeline ok')
