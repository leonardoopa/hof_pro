export const REGIONS = [
  { key: 'testa', label: 'Testa' },
  { key: 'temporas', label: 'Têmporas' },
  { key: 'olheiras', label: 'Olheiras' },
  { key: 'malar', label: 'Malar' },
  { key: 'nasolabial', label: 'Nasolabial' },
  { key: 'mandibula', label: 'Mandíbula' },
  { key: 'mento', label: 'Mento' },
  { key: 'boca', label: 'Boca (lábios)' },
]

// unit: toxina em unidades (U), demais produtos em ml. initial = dose ao ativar um ponto vazio.
export const TREATMENTS = [
  { key: 'botox', label: 'Botox', unit: 'U', step: 1, initial: 2, color: '#8b74a6' },
  { key: 'preenchimento', label: 'Preenchimento', unit: 'ml', step: 0.1, initial: 0.2, color: '#d98c9b' },
  { key: 'bioestimulador', label: 'Bioestimulador', unit: 'ml', step: 0.5, initial: 0.5, color: '#c4a05a' },
  { key: 'skinbooster', label: 'Skinbooster', unit: 'ml', step: 0.1, initial: 0.1, color: '#5f9f9a' },
  { key: 'outro', label: 'Outro', unit: 'ml', step: 0.1, initial: 0.1, color: '#8b8696' },
]

export const regionLabel = (key) => REGIONS.find((r) => r.key === key)?.label ?? key
export const treatmentOf = (key) => TREATMENTS.find((t) => t.key === key) ?? TREATMENTS[1]

export const round2 = (n) => Math.round(n * 100) / 100
export const formatAmount = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export function totalsOf(points) {
  let ml = 0
  let units = 0
  const areas = new Set()
  for (const p of points) {
    if (p.amount <= 0) continue
    areas.add(p.region)
    if (treatmentOf(p.treatment).unit === 'U') units += p.amount
    else ml += p.amount
  }
  return { ml: round2(ml), units: round2(units), areas: areas.size }
}

export function describeTotals({ ml, units }) {
  const parts = []
  if (units > 0) parts.push(`${formatAmount(units)} U`)
  if (ml > 0) parts.push(`${formatAmount(ml)} ml`)
  return parts.join(' · ') || '—'
}

// Regiões que existem dos dois lados do rosto. "Direito/Esquerdo" é do paciente (direito = esquerda da foto).
export const BILATERAL = new Set(['temporas', 'olheiras', 'malar', 'nasolabial', 'mandibula'])
export const SIDE_LABEL = { D: 'Lado direito', E: 'Lado esquerdo', C: '' }

/** Define o lado (D/E/C) de cada ponto a partir da linha média do rosto (testa e mento). */
export function assignSides(points) {
  const middle = points.filter((p) => p.region === 'testa' || p.region === 'mento')
  const cx = middle.length ? middle.reduce((sum, p) => sum + p.x, 0) / middle.length : 0.5
  return points.map((p) => ({ ...p, side: !BILATERAL.has(p.region) ? 'C' : p.x < cx ? 'D' : 'E' }))
}
