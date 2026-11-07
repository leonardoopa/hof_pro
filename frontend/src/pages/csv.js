// Célula de CSV: aspas escapadas e, para texto que o Excel/Sheets leria como fórmula
// (começa com = + - @ ou tab/CR), um apóstrofo na frente para neutralizar a injeção.
export function csvCell(value) {
  let text = String(value ?? '')
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
