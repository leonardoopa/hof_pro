// Tipos de produto e campos de lote novo, usados no Estoque e no Planejamento.
export const KINDS = [
  { key: 'toxina', label: 'Toxina', unit: 'U' },
  { key: 'preenchedor', label: 'Preenchedor', unit: 'ml' },
  { key: 'bioestimulador', label: 'Bioestimulador', unit: 'ml' },
  { key: 'skinbooster', label: 'Skinbooster', unit: 'ml' },
  { key: 'outro', label: 'Outro', unit: 'ml' },
]

// Campos de um lote novo, iguais na entrada de lote e no cadastro do produto.
export default function LotFields({ lot, set, unit }) {
  return (
    <>
      <div className="form-row">
        <label className="field">
          <span>Número do lote</span>
          <input className="input" value={lot.number} onChange={set('number')} required />
        </label>
        <label className="field">
          <span>Validade</span>
          <input className="input" type="date" value={lot.expires_on} onChange={set('expires_on')} required />
        </label>
      </div>
      <label className="field">
        <span>Quantidade ({unit})</span>
        <input className="input" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" title="Até duas casas decimais, ex.: 12,5" value={lot.quantity} onChange={set('quantity')} required />
      </label>
    </>
  )
}
