import { expect, test } from '@playwright/test'
import { collectPageErrors, createPatient, signIn } from './helpers.js'

const isoIn = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Paciente com uma aplicação real de preenchedor (lote com baixa) e um lote de hialuronidase no estoque. */
async function patientWithApplication(page) {
  const api = await signIn(page)
  const patient = await createPatient(api, 'Paciente Segurança')
  const filler = await api.post('/inventory/products', {
    brand: 'Galderma', name: 'Restylane', kind: 'preenchedor', unit: 'ml', lot: { number: 'F-77', expires_on: isoIn(200), quantity: 5 },
  })
  await api.post('/inventory/products', {
    brand: 'Genérico', name: 'Hialuronidase', kind: 'outro', unit: 'U', lot: { number: 'HY-1', expires_on: isoIn(200), quantity: 1500 },
  })
  const lots = await api.get('/inventory/lots?available=true')
  const fillerLot = lots.find((l) => l.product_id === filler.id)
  const plan = await api.post(`/patients/${patient.id}/plans`, {
    points: [{ region: 'nariz', point_key: 'dorso', treatment: 'preenchimento', x: 0.5, y: 0.5, amount: 0.3, lot_id: fillerLot.id }],
  })
  return { api, patient, plan, fillerLot }
}

test('plano com aviso: a checagem antes de aplicar mostra termo e zona de risco, sem bloquear', async ({ page }) => {
  const errors = collectPageErrors(page)
  const { patient } = await patientWithApplication(page)
  await page.goto(`/pacientes/${patient.id}/planejamento`)
  await page.getByRole('button', { name: 'Marcar como aplicado' }).click()
  const dialog = page.getByRole('dialog', { name: 'Marcar como aplicado' })
  const warnings = dialog.getByRole('list', { name: 'Avisos antes de aplicar' })
  await expect(warnings).toContainText('Termo de consentimento não assinado')
  await expect(warnings).toContainText('zona de maior risco vascular (Nariz)')
  await dialog.getByRole('button', { name: 'Marcar como aplicado' }).click()
  await expect(page.getByText(/^Aplicado em/)).toBeVisible()
  expect(errors).toEqual([])
})

test('oclusão vascular: protocolo com cronômetro, sinal visual vira emergência, registro liga ponto, lote e baixa a hialuronidase', async ({ page }) => {
  const errors = collectPageErrors(page)
  const { api, patient, plan, fillerLot } = await patientWithApplication(page)
  await api.post(`/plans/${plan.id}/apply`)

  await page.goto(`/pacientes/${patient.id}/intercorrencias`)
  await expect(page.getByText('Nenhuma intercorrência registrada.')).toBeVisible()
  await page.getByRole('button', { name: 'Suspeita de oclusão vascular' }).click()
  const dialog = page.getByRole('dialog', { name: 'Protocolo de oclusão vascular' })
  await expect(dialog.getByText(/Protocolo iniciado às/)).toBeVisible()
  await expect(dialog).not.toContainText(/\d+\s*U de hialuronidase/) // passos sem dose

  await dialog.getByLabel('Palidez / branqueamento').check()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByLabel('Alteração visual').check()
  await expect(dialog.getByRole('alert')).toContainText('emergência')

  await dialog.getByLabel('Aplicação relacionada (opcional)').selectOption({ index: 1 })
  await dialog.getByLabel('Descrição').fill('Branqueamento no dorso nasal logo após a injeção.')
  const hyLot = (await api.get('/inventory/lots?available=true')).find((l) => l.number === 'HY-1')
  await dialog.getByLabel('Hialuronidase usada (lote)').selectOption(String(hyLot.id))
  await dialog.getByLabel('Quantidade de hialuronidase usada').fill('300')
  await dialog.getByRole('button', { name: 'Registrar intercorrência' }).click()

  const card = page.locator('.event-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Suspeita de oclusão vascular')
  await expect(card).toContainText('Nariz · Dorso')
  await expect(card).toContainText('lote F-77')
  await expect(card).toContainText('Alteração visual')

  const hy = (await api.get('/inventory/lots?available=true')).find((l) => l.id === hyLot.id)
  expect(hy.balance).toBe(1200)

  await card.getByLabel('Desfecho').selectOption('resolvido')
  await expect(card.getByLabel('Desfecho')).toHaveValue('resolvido')

  // Recall: o lote aplicado mostra quem o recebeu.
  await page.goto('/estoque')
  await page.getByRole('button', { name: `Pacientes do lote ${fillerLot.number}` }).click()
  const recall = page.getByRole('dialog', { name: `Pacientes do lote ${fillerLot.number}` })
  await expect(recall).toContainText('Paciente Segurança')
  await expect(recall).toContainText('Nariz')
  expect(errors).toEqual([])
})
