// Dinheiro do financeiro: sempre em centavos inteiros (nunca float). Sem dependências, para rodar no node.

export const MAX_CENTS = 100_000_000 // R$ 1.000.000,00: o mesmo teto do servidor
export const MAX_QTY = 100_000

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** 123456 -> "R$ 1.234,56"; negativo -> "-R$ 12,00" (estorno). Valor que não é número vira R$ 0,00. */
export function formatBRL(cents) {
  const n = Number.isFinite(cents) ? Math.round(cents) : 0
  const abs = Math.abs(n)
  const reais = Math.floor(abs / 100)
  return `${n < 0 ? '-' : ''}R$ ${group(String(reais))},${String(abs % 100).padStart(2, '0')}`
}

/** Mesmo valor sem o "R$", para preencher um campo de texto: 123456 -> "1.234,56". */
export const centsToInput = (cents) => formatBRL(Math.abs(cents)).slice(3)

/**
 * Texto em centésimos (inteiro) ou null. Aceita "1.234,56", "10", "10,5", "R$ 10,00" e também "10.5" (ponto com 1 ou 2
 * casas, que não pode ser separador de milhar). Recusa vazio, letras, negativo, mais de 2 casas e milhar fora de lugar.
 */
function parseHundredths(text) {
  if (typeof text !== 'string') return null
  const s = text.trim().replace(/^R\$\s*/i, '')
  let int
  let frac = ''
  let m = s.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/)
  if (m) {
    int = m[1].replaceAll('.', '')
    frac = m[2] ?? ''
  } else if ((m = s.match(/^(\d+)\.(\d{1,2})$/))) {
    int = m[1]
    frac = m[2]
  } else return null
  if (int.length > 12) return null
  return Number(int) * 100 + Number(frac.padEnd(2, '0'))
}

/** "1.234,56" -> 123456. null quando o texto não é um valor em reais válido (ou passa do teto do servidor). */
export function parseBRL(text) {
  const h = parseHundredths(text)
  return h === null || h > MAX_CENTS ? null : h
}

/** Quantidade de um item: "0,5" -> 0.5. null se inválida ou acima do limite. Zero volta 0 (quem chama decide se aceita). */
export function parseQty(text) {
  const h = parseHundredths(text)
  return h === null || h > MAX_QTY * 100 ? null : h / 100
}

/** 1.5 -> "1,5". */
export const formatQty = (qty) => String(Number(Number(qty).toFixed(2))).replace('.', ',')

/** Quantidade x preço unitário, arredondado ao centavo (meio para cima), igual ao servidor. Aritmética inteira. */
export const lineTotalCents = (qty, unitCents) => Math.floor((Math.round(qty * 100) * unitCents + 50) / 100)
