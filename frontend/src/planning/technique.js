import { formatAmount } from './regions.js'

// Técnica e profundidade/plano de cada ponto (opcionais; "" = não informado).
export const TECHNIQUES = [
  { key: 'bolus', label: 'Bolus' },
  { key: 'retroinjecao', label: 'Retroinjeção' },
  { key: 'leque', label: 'Leque' },
  { key: 'canula', label: 'Cânula' },
  { key: 'microgotas', label: 'Microgotas' },
  { key: 'papula', label: 'Pápula' },
  { key: 'outra', label: 'Outra' },
]

export const DEPTHS = [
  { key: 'intradermico', label: 'Intradérmico' },
  { key: 'subdermico', label: 'Subdérmico' },
  { key: 'subcutaneo', label: 'Subcutâneo' },
  { key: 'supraperiosteal', label: 'Supraperiosteal' },
  { key: 'intramuscular', label: 'Intramuscular' },
]

export const UNIT_BY_TREATMENT = { botox: 'U', preenchimento: 'ml', bioestimulador: 'ml', skinbooster: 'ml', outro: 'ml' }

const fmtDate = (iso) => iso.split('-').reverse().join('/')

export const lotLabel = (lot) =>
  `${lot.product_label} · lote ${lot.number} · val. ${fmtDate(lot.expires_on)} · ${formatAmount(lot.balance)} ${lot.unit}`

// Fuso da clínica, o mesmo de TIME_ZONE em backend/config/settings.py: é o servidor que diz se um lote venceu.
export const CLINIC_TIME_ZONE = 'America/Sao_Paulo'

/** Hoje (AAAA-MM-DD) no fuso da clínica, não no do aparelho. */
export const clinicToday = (now = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: CLINIC_TIME_ZONE })
export { fmtDate }
