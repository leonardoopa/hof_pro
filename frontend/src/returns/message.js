// Link do WhatsApp para o lembrete de retorno. Só gera o link: quem envia é o profissional.

export const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '')

// Telefone no formato do wa.me (só dígitos, com código do país). Vazio quando não dá para montar um número válido.
export function waNumber(phone) {
  const raw = String(phone ?? '').trim()
  let digits = onlyDigits(raw)
  if (!digits) return ''
  // "+1 415..." e outros países informados com "+": mantém como está.
  if (raw.startsWith('+') && !digits.startsWith('55')) return digits.length >= 8 && digits.length <= 15 ? digits : ''
  digits = digits.replace(/^0+/, '') // zero de tronco antes do DDD
  // Número nacional tem 10 ou 11 dígitos; com o 55 do país, 12 ou 13. O DDD 55 (RS) tem 10/11 dígitos sem o país.
  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith('55')) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return ''
}

// "" quando o paciente não tem telefone utilizável (o botão fica desabilitado).
export function waLink(phone, text = '') {
  const number = waNumber(phone)
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text ?? '')}` : ''
}

// Prazo em texto. `daysOverdue` negativo = faltam dias para o retorno.
export function dueLabel(daysOverdue) {
  if (daysOverdue > 0) return `Vencido há ${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'}`
  if (daysOverdue === 0) return 'Vence hoje'
  if (daysOverdue === -1) return 'Vence amanhã'
  return `Vence em ${-daysOverdue} dias`
}
