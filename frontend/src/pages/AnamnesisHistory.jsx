import { ChevronRight, History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { changesLabel, versionRows } from './anamnesisVersions'

/** Somente leitura. `current` é o número da versão atual: quando muda, a lista é buscada de novo. */
export default function AnamnesisHistory({ patientId, current }) {
  const [versions, setVersions] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api.anamnesis
      .versions(patientId)
      .then((list) => {
        if (!alive) return
        setVersions(list)
        setError(null)
      })
      .catch((err) => alive && setError(err))
    return () => {
      alive = false
    }
  }, [patientId, current])

  return (
    <section className="card anamnesis version-history">
      <div className="card-title">
        <History size={18} /> Histórico de versões
      </div>
      <ErrorList error={error} />
      {!versions && !error && <p className="version-meta">Carregando…</p>}
      {versions?.map((version, index) => {
        const previous = versions[index + 1]
        const rows = versionRows(version, previous)
        return (
          <details className="version" key={version.number}>
            <summary>
              <ChevronRight size={16} aria-hidden />
              <strong>Versão {version.number}</strong>
              {index === 0 && <span className="chip ok">Atual</span>}
              <span className="version-meta">
                {new Date(version.saved_at).toLocaleString('pt-BR')} · {version.saved_by}
              </span>
              <span className="version-meta version-changes">{changesLabel(rows, previous)}</span>
            </summary>
            {rows.length ? (
              <ul className="version-rows">
                {rows.map((row, i) => (
                  <li key={i} className={row.before === null ? '' : 'changed'}>
                    <span>{row.label}</span>
                    <div>
                      <div className="version-value">{row.value || 'Em branco'}</div>
                      {row.before !== null && <div className="version-before">Antes: {row.before || 'em branco'}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="version-meta version-empty">Nenhuma resposta nesta versão.</p>
            )}
          </details>
        )
      })}
    </section>
  )
}
