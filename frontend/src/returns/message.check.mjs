import assert from 'node:assert/strict'
import { dueLabel, onlyDigits, waLink } from './message.js'

// onlyDigits
assert.equal(onlyDigits('(11) 98765-4321'), '11987654321')
assert.equal(onlyDigits('+55 11 98765-4321'), '5511987654321')
assert.equal(onlyDigits(''), '')
assert.equal(onlyDigits(null), '')
assert.equal(onlyDigits(undefined), '')
assert.equal(onlyDigits(11987654321), '11987654321')

// waLink: telefone com máscara ganha o 55
const text = 'Olá, Maria! Tudo bem? Já faz um tempo.'
const enc = encodeURIComponent(text)
assert.equal(waLink('(11) 98765-4321', text), `https://wa.me/5511987654321?text=${enc}`)
// fixo com 10 dígitos
assert.equal(waLink('11 3456-7890', text), `https://wa.me/551134567890?text=${enc}`)
// já com 55 (com ou sem +): não duplica
assert.equal(waLink('+55 (11) 98765-4321', text), `https://wa.me/5511987654321?text=${enc}`)
assert.equal(waLink('5511987654321', text), `https://wa.me/5511987654321?text=${enc}`)
// DDD 55 (Santa Maria/RS) sem código do país não pode ser confundido com o 55 do país
assert.equal(waLink('(55) 99123-4567', text), `https://wa.me/5555991234567?text=${enc}`)
assert.equal(waLink('55991234567', text), `https://wa.me/5555991234567?text=${enc}`)
// zero de tronco na frente do DDD
assert.equal(waLink('011 98765-4321', text), `https://wa.me/5511987654321?text=${enc}`)
// número internacional informado com + e outro país: mantém como está
assert.equal(waLink('+1 415 555 2671', text), `https://wa.me/14155552671?text=${enc}`)

// vazio ou inválido: sem link (botão desabilitado)
assert.equal(waLink('', text), '')
assert.equal(waLink(null, text), '')
assert.equal(waLink(undefined, text), '')
assert.equal(waLink('   ', text), '')
assert.equal(waLink('12345', text), '') // curto demais
assert.equal(waLink('abc', text), '')

// texto: caracteres especiais codificados; texto ausente vira vazio
assert.equal(waLink('11987654321', 'a b&c=d?e#f'), 'https://wa.me/5511987654321?text=a%20b%26c%3Dd%3Fe%23f')
assert.equal(waLink('11987654321'), 'https://wa.me/5511987654321?text=')

// dueLabel: texto do prazo (negativo = faltam dias)
assert.equal(dueLabel(10), 'Vencido há 10 dias')
assert.equal(dueLabel(1), 'Vencido há 1 dia')
assert.equal(dueLabel(0), 'Vence hoje')
assert.equal(dueLabel(-1), 'Vence amanhã')
assert.equal(dueLabel(-20), 'Vence em 20 dias')

console.log('message.check ok')
