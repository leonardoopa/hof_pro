// Verificação da comparação entre versões (sem runner no projeto): node src/pages/anamnesisVersions.check.mjs
import assert from 'node:assert/strict'
import { changesLabel, versionRows } from './anamnesisVersions.js'

const answer = (question_id, question_text, value, detail = '') => ({ question_id, question_text, answer: value, detail })
const version = (answers, notes = '') => ({ answers, notes })

const first = version([answer(1, 'Alergia?', false), answer(2, 'Fuma?', true, '10 por dia')], 'Obs')

// A primeira versão mostra o que tem, sem nada marcado como alterado.
assert.deepEqual(versionRows(first, undefined), [
  { label: 'Alergia?', value: 'Não', before: null },
  { label: 'Fuma?', value: 'Sim: 10 por dia', before: null },
  { label: 'Observações gerais', value: 'Obs', before: null },
])
assert.equal(changesLabel(versionRows(first, undefined), undefined), 'Primeira versão guardada')

// Resposta invertida e só a descrição trocada contam; o que não mudou fica sem `before`.
const edited = version([answer(1, 'Alergia?', true, 'Dipirona'), answer(2, 'Fuma?', true, '5 por dia')], 'Obs')
const rows = versionRows(edited, first)
assert.deepEqual(rows, [
  { label: 'Alergia?', value: 'Sim: Dipirona', before: 'Não' },
  { label: 'Fuma?', value: 'Sim: 5 por dia', before: 'Sim: 10 por dia' },
  { label: 'Observações gerais', value: 'Obs', before: null },
])
assert.equal(changesLabel(rows, first), '2 alterações')

// Pergunta reescrita sem mudar a resposta não é alteração, e a linha usa o texto desta versão.
const reworded = versionRows(version([answer(1, 'Tem alergia?', false)]), version([answer(1, 'Alergia?', false)]))
assert.deepEqual(reworded, [{ label: 'Tem alergia?', value: 'Não', before: null }])
assert.equal(changesLabel(reworded, first), '0 alterações')

// Resposta nova e resposta que saiu aparecem, com o texto de onde ela existe.
const previous = version([answer(1, 'Alergia?', true, 'Dipirona')])
assert.deepEqual(versionRows(version([answer(2, 'Fuma?', false)]), previous), [
  { label: 'Fuma?', value: 'Não', before: 'Sem resposta' },
  { label: 'Alergia?', value: 'Sem resposta', before: 'Sim: Dipirona' },
])

// Observação: entra, sai, muda; em branco nas duas versões não vira linha.
const notes = (now, before) => versionRows(version([], now), version([], before))
assert.deepEqual(notes('Nova', ''), [{ label: 'Observações gerais', value: 'Nova', before: '' }])
assert.deepEqual(notes('', 'Velha'), [{ label: 'Observações gerais', value: '', before: 'Velha' }])
assert.equal(changesLabel(notes('', 'Velha'), version([])), '1 alteração')
assert.deepEqual(notes('', ''), [])
assert.deepEqual(versionRows(version([]), undefined), [])

console.log('anamnesisVersions ok')
