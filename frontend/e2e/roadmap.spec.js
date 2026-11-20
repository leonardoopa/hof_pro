import { expect, test } from '@playwright/test'
import { collectPageErrors, signIn } from './helpers.js'

const isoIn = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Paciente com telefone, toxina com intervalo de 1 dia e um plano já aplicado (retorno vence amanhã). */
async function patientWithToxin(page) {
  const api = await signIn(page)
  const patient = await api.post('/patients', { full_name: 'Maria Retorno', phone: '(11) 91234-5678' })
  const product = await api.post('/inventory/products', {
    brand: 'Allergan', name: 'Botox', kind: 'toxina', unit: 'U', lot: { number: 'T-1', expires_on: isoIn(200), quantity: 100 },
  })
  await api.patch(`/inventory/products/${product.id}`, { return_interval_days: 1 })
  const lot = (await api.get('/inventory/lots?available=true')).find((l) => l.product_id === product.id)
  const plan = await api.post(`/patients/${patient.id}/plans`, {
    points: [{ region: 'glabela', treatment: 'botox', x: 0.5, y: 0.3, amount: 20, lot_id: lot.id }],
  })
  await api.post(`/plans/${plan.id}/apply`)
  return { api, patient, plan }
}

test('retornos: paciente com aplicação aparece com link de WhatsApp e mensagem copiável', async ({ page, context }) => {
  const errors = collectPageErrors(page)
  await patientWithToxin(page)
  await page.goto('/retornos')
  await expect(page.getByRole('heading', { name: 'Retornos' })).toBeVisible()
  const link = page.getByRole('link', { name: /Abrir WhatsApp com Maria Retorno/ })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /^https:\/\/wa\.me\/5511912345678\?text=/)
  await expect(page.getByRole('button', { name: /Copiar mensagem para Maria Retorno/ })).toBeVisible()
  await expect(page.getByRole('note')).toContainText(/recomendação clínica/i)
  expect(errors).toEqual([])
})

test('pendências: plano aplicado sem anamnese e sem termo vira alerta com link para o paciente', async ({ page }) => {
  const errors = collectPageErrors(page)
  const { patient } = await patientWithToxin(page)
  await page.goto('/pendencias')
  await expect(page.getByRole('heading', { name: 'Pendências' })).toBeVisible()
  await expect(page.getByText('Maria Retorno').first()).toBeVisible()
  await expect(page.getByLabel('Pendências por prioridade')).toBeVisible()
  await page.locator('.compliance-item').filter({ hasText: 'Maria Retorno' }).first().getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/pacientes/${patient.id}/`))
  expect(errors).toEqual([])
})

test('histórico: aba do paciente mostra plano e aplicação em ordem, e abre sem erro', async ({ page }) => {
  const errors = collectPageErrors(page)
  const { patient } = await patientWithToxin(page)
  await page.goto(`/pacientes/${patient.id}/historico`)
  await expect(page.getByRole('link', { name: 'Histórico' })).toBeVisible()
  await expect(page.getByText(/Aplicação de toxina/)).toBeVisible()
  await expect(page.getByText('Nada registrado ainda')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('histórico: paciente novo mostra estado vazio', async ({ page }) => {
  const api = await signIn(page)
  const patient = await api.post('/patients', { full_name: 'Paciente Vazio' })
  await page.goto(`/pacientes/${patient.id}/historico`)
  await expect(page.getByText('Nada registrado ainda')).toBeVisible()
})

test('financeiro: orçamento do plano, aprovação, pagamento parcial e recusa acima do saldo', async ({ page }) => {
  const errors = collectPageErrors(page)
  const { api, plan } = await patientWithToxin(page)
  await api.post('/finance/price-items', { name: 'Botox por unidade', treatment: 'botox', unit_price_cents: 2500 })
  const budget = await api.post(`/finance/budgets/from-plan/${plan.id}`)
  expect(budget.total_cents).toBe(50000) // 20 U × R$ 25,00

  await page.goto('/financeiro')
  await page.getByRole('button', { name: `Abrir orçamento nº ${budget.id}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click()
  await page.getByRole('button', { name: 'Aprovar orçamento' }).click()

  await dialog.getByLabel('Valor (R$)').fill('200,00')
  await dialog.getByRole('button', { name: 'Registrar pagamento' }).click()
  await expect(dialog.getByText('R$ 200,00').first()).toBeVisible()
  expect((await api.get(`/finance/budgets/${budget.id}`)).balance_cents).toBe(30000)

  // pagamento acima do saldo é recusado e o saldo não muda
  await dialog.getByLabel('Valor (R$)').fill('999,00')
  await dialog.getByRole('button', { name: 'Registrar pagamento' }).click()
  expect((await api.get(`/finance/budgets/${budget.id}`)).paid_cents).toBe(20000)
  expect(errors.filter((e) => !/422|Unprocessable/.test(e))).toEqual([])
})
