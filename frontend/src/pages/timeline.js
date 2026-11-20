// Funções puras do histórico do paciente. Verificação sem tela: node src/pages/timeline.check.mjs
import { CLINIC_TIME_ZONE } from '../planning/technique.js'

const parts = (iso, options, tz) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  )

/** Mês (AAAA-MM) de um instante, no fuso da clínica: o que passou da meia-noite em UTC não vira o mês seguinte. */
export function monthKey(iso, tz = CLINIC_TIME_ZONE) {
  const { year, month } = parts(iso, { year: 'numeric', month: '2-digit' }, tz)
  return `${year}-${month}`
}

/** "2026-11" vira "Novembro de 2026". */
export function monthLabel(key) {
  const [year, month] = key.split('-').map(Number)
  const text = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, month - 1, 1))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Agrupa por mês na ordem recebida (do mais novo para o mais antigo): [{ key, label, items }]. */
export function groupByMonth(items, tz = CLINIC_TIME_ZONE) {
  const groups = new Map()
  for (const item of items ?? []) {
    const key = monthKey(item.at, tz)
    if (!groups.has(key)) groups.set(key, { key, label: monthLabel(key), items: [] })
    groups.get(key).items.push(item)
  }
  return [...groups.values()]
}

/** "20/11/2026 14:05" no fuso da clínica, sempre no mesmo formato. */
export function formatWhen(iso, tz = CLINIC_TIME_ZONE) {
  const p = parts(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz)
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

/** Item que ainda vai acontecer (agendamento futuro). */
export const isUpcoming = (item, now = new Date()) => new Date(item.at).getTime() > now.getTime()

// Aba do paciente (ou rota) de cada tipo de referência. A rastreabilidade das aplicações fica em "Prontuário / Termos".
const TAB_BY_REF = {
  plan: 'planejamento',
  application: 'prontuario',
  signature: 'prontuario',
  adverse_event: 'intercorrencias',
  photo: 'evolucao',
  anamnesis: 'anamnese',
}

/** Caminho para onde o item leva, ou null quando o tipo ainda não tem tela. */
export function itemPath(item, patientId) {
  const type = item.ref?.type
  if (type === 'appointment') return '/agenda'
  if (type === 'budget') return '/financeiro'
  return TAB_BY_REF[type] ? `/pacientes/${patientId}/${TAB_BY_REF[type]}` : null
}
