// Catálogo das regiões, na ordem de exibição. Só nomes anatômicos: as doses de referência da literatura
// ainda não foram validadas, então não aparecem.
//  - bilateral: a região tem lado direito e esquerdo (D/E, do paciente);
//  - short: rótulo curto sobre a foto (se faltar, vale o label);
//  - points: nome de cada ponto do template (point_key -> rótulo); pontos sem nome usam point_key "";
//  - risk: alerta mostrado ao abrir a região.
export const GROUPS = [
  { key: 'superior', label: 'Terço superior' },
  { key: 'medio', label: 'Terço médio' },
  { key: 'inferior', label: 'Terço inferior' },
  { key: 'pescoco', label: 'Pescoço' },
]

export const REGIONS = [
  {
    key: 'testa',
    label: 'Testa',
    group: 'superior',
    bilateral: false,
    risk: 'Preenchedor: risco vascular muito alto. Evite o forame supraorbital.',
    points: {
      frontal_lateral_d: 'Frontal lateral D',
      frontal_medial_d: 'Frontal medial D',
      frontal_central: 'Frontal central',
      frontal_medial_e: 'Frontal medial E',
      frontal_lateral_e: 'Frontal lateral E',
    },
  },
  {
    key: 'glabela',
    label: 'Glabela',
    group: 'superior',
    bilateral: false,
    risk: 'Preenchedor: risco vascular muito alto. A artéria supratroclear sai da órbita a cerca de 2 cm da linha média e se liga à oftálmica.',
    points: {
      procero: 'Prócero',
      corrugador_medial_d: 'Corrugador medial D',
      corrugador_medial_e: 'Corrugador medial E',
      corrugador_lateral_d: 'Corrugador lateral D',
      corrugador_lateral_e: 'Corrugador lateral E',
    },
  },
  {
    key: 'temporas',
    label: 'Têmporas',
    group: 'superior',
    bilateral: true,
    risk: 'Preenchedor: risco vascular alto. Não use agulha no compartimento temporal inferior.',
    points: { tempora: 'Têmpora' },
  },
  {
    key: 'periorbital',
    label: 'Periorbital (pés de galinha)',
    short: 'Pés de galinha',
    group: 'superior',
    bilateral: true,
    risk: 'Preenchedor: risco vascular alto na região periocular.',
    points: { superior: 'Pé de galinha superior', medio: 'Pé de galinha médio', inferior: 'Pé de galinha inferior' },
  },
  {
    key: 'olheiras',
    label: 'Olheiras',
    group: 'medio',
    bilateral: true,
    risk: 'A artéria angular cruza o sulco nasojugal (área do sulco lacrimal).',
    points: { sulco_lacrimal: 'Sulco lacrimal' },
  },
  {
    key: 'nariz',
    label: 'Nariz',
    group: 'medio',
    bilateral: false,
    risk: 'Preenchedor: risco vascular muito alto (artéria nasal dorsal, ligada à oftálmica).',
    points: {
      radix: 'Radix',
      dorso: 'Dorso',
      ponta: 'Ponta',
      columela: 'Columela',
      nasal_d: 'Nasal D (bunny lines)',
      nasal_e: 'Nasal E (bunny lines)',
    },
  },
  {
    key: 'zigomatico',
    label: 'Zigomático',
    group: 'medio',
    bilateral: true,
    points: { arco: 'Arco zigomático', eminencia: 'Eminência zigomática' },
  },
  {
    key: 'malar',
    label: 'Malar',
    group: 'medio',
    bilateral: true,
    risk: 'Preenchedor: risco vascular alto no malar medial.',
    points: { lateral: 'Malar lateral', medial: 'Malar medial' },
  },
  {
    key: 'submalar',
    label: 'Submalar',
    group: 'medio',
    bilateral: true,
    points: { depressao: 'Depressão submalar' },
  },
  {
    key: 'nasolabial',
    label: 'Nasolabial',
    group: 'medio',
    bilateral: true,
    risk: 'Preenchedor: risco vascular alto.',
    points: { sulco: 'Sulco nasolabial' },
  },
  {
    key: 'gengival',
    label: 'Sorriso gengival (LLSAN)',
    short: 'LLSAN',
    group: 'medio',
    bilateral: true,
    points: { llsan: 'LLSAN' },
  },
  {
    key: 'boca',
    label: 'Boca (lábios)',
    short: 'Boca',
    group: 'inferior',
    bilateral: false,
    risk: 'Artérias labiais mais superficiais perto da linha média; a artéria facial passa cerca de 1 cm lateral à comissura.',
    points: {
      arco_cupido_d: 'Arco do cupido D',
      arco_cupido_e: 'Arco do cupido E',
      comissura_d: 'Comissura D',
      comissura_e: 'Comissura E',
      perioral_d: 'Perioral D',
      perioral_e: 'Perioral E',
      vermelhao_superior: 'Vermelhão superior',
      vermelhao_inferior: 'Vermelhão inferior',
    },
  },
  {
    key: 'marionete',
    label: 'Marionete',
    group: 'inferior',
    bilateral: true,
    risk: 'A artéria facial passa cerca de 1 cm lateral à comissura.',
    points: { superior: 'Marionete superior', inferior: 'Marionete inferior' },
  },
  {
    key: 'dao',
    label: 'DAO (depressor do ângulo da boca)',
    short: 'DAO',
    group: 'inferior',
    bilateral: true,
    points: { dao: 'Depressor do ângulo da boca' },
  },
  {
    key: 'mento',
    label: 'Mento',
    group: 'inferior',
    bilateral: false,
    points: { pogonio: 'Pogônio (projeção)', mentual_d: 'Mentual D', mentual_e: 'Mentual E' },
  },
  {
    key: 'prejowl',
    label: 'Pré-jowl',
    group: 'inferior',
    bilateral: true,
    points: { sulco: 'Sulco pré-jowl' },
  },
  {
    key: 'mandibula',
    label: 'Mandíbula',
    group: 'inferior',
    bilateral: true,
    points: { angulo: 'Ângulo mandibular', corpo: 'Corpo mandibular' },
  },
  {
    key: 'masseter',
    label: 'Masseter',
    group: 'inferior',
    bilateral: true,
    risk: 'Evite a parótida, o ducto de Stenson e a veia facial sobre o masseter.',
    points: { superior: 'Masseter superior', inferior_anterior: 'Masseter inferior anterior', inferior_posterior: 'Masseter inferior posterior' },
  },
  {
    key: 'platisma',
    label: 'Platisma (pescoço)',
    short: 'Platisma',
    group: 'pescoco',
    bilateral: true,
    points: { borda_anterior: 'Borda mandibular anterior', borda_posterior: 'Borda mandibular posterior', banda: 'Banda cervical' },
  },
]

// unit: toxina em unidades (U), demais produtos em ml. initial = dose ao ativar um ponto vazio.
export const TREATMENTS = [
  { key: 'botox', label: 'Botox', unit: 'U', step: 1, initial: 2, color: '#8b74a6' },
  { key: 'preenchimento', label: 'Preenchimento', unit: 'ml', step: 0.1, initial: 0.2, color: '#d98c9b' },
  { key: 'bioestimulador', label: 'Bioestimulador', unit: 'ml', step: 0.5, initial: 0.5, color: '#c4a05a' },
  { key: 'skinbooster', label: 'Skinbooster', unit: 'ml', step: 0.1, initial: 0.1, color: '#5f9f9a' },
  { key: 'outro', label: 'Outro', unit: 'ml', step: 0.1, initial: 0.1, color: '#8b8696' },
]

export const regionOf = (key) => REGIONS.find((r) => r.key === key)
export const regionLabel = (key) => regionOf(key)?.label ?? key
/** Nome anatômico do ponto; "" quando o ponto não tem nome (adicionado à mão ou de plano antigo). */
export function pointLabel(region, key) {
  const points = regionOf(region)?.points ?? {}
  return key && Object.hasOwn(points, key) ? points[key] : ''
}
export const treatmentOf = (key) => TREATMENTS.find((t) => t.key === key) ?? TREATMENTS[1]

export const round2 = (n) => Math.round(n * 100) / 100
/** Lê quantidade digitada: "0,3" e "0.3" valem o mesmo. Vazio ou inválido vale 0. */
export const parseAmount = (text) => parseFloat(String(text).replace(',', '.')) || 0
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
export const BILATERAL = new Set(REGIONS.filter((r) => r.bilateral).map((r) => r.key))
export const SIDE_LABEL = { D: 'Lado direito', E: 'Lado esquerdo', C: '' }

/** Define o lado (D/E/C) de cada ponto a partir da linha média do rosto (testa e mento). */
export function assignSides(points) {
  const middle = points.filter((p) => p.region === 'testa' || p.region === 'mento')
  const cx = middle.length ? middle.reduce((sum, p) => sum + p.x, 0) / middle.length : 0.5
  return points.map((p) => ({ ...p, side: !BILATERAL.has(p.region) ? 'C' : p.x < cx ? 'D' : 'E' }))
}
