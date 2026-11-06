// Compara uma versão da anamnese com a anterior. Verificação sem tela: node src/pages/anamnesisVersions.check.mjs

const answerText = (a) => (a ? (a.answer ? `Sim: ${a.detail}` : 'Não') : 'Sem resposta')

/** Linhas de uma versão. `before` só vem preenchido no que mudou (texto vazio = observação em branco). */
export function versionRows(version, previous) {
  const row = (label, value, old) => ({ label, value, before: previous && old !== value ? old : null })
  const older = new Map(previous?.answers.map((a) => [a.question_id, a]))
  const kept = new Set(version.answers.map((a) => a.question_id))
  return [
    ...version.answers.map((a) => row(a.question_text, answerText(a), answerText(older.get(a.question_id)))),
    ...(previous?.answers ?? [])
      .filter((a) => !kept.has(a.question_id))
      .map((a) => row(a.question_text, answerText(null), answerText(a))),
    ...(version.notes || previous?.notes ? [row('Observações gerais', version.notes, previous?.notes ?? '')] : []),
  ]
}

export function changesLabel(rows, previous) {
  if (!previous) return 'Primeira versão guardada'
  const count = rows.filter((r) => r.before !== null).length
  return count === 1 ? '1 alteração' : `${count} alterações`
}
