import { expect, test } from '@playwright/test'
import { collectPageErrors, createPatient, signIn } from './helpers.js'

async function draw(page, canvas) {
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + 30, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
  await page.mouse.move(box.x + box.width - 30, box.y + 30, { steps: 6 })
  await page.mouse.up()
}

test('anamnese: paciente assina a versão salva; alterar pede assinatura nova', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  const patient = await createPatient(api, 'Paciente Assina')
  const [question] = await api.get('/anamnesis/questions')
  await page.goto(`/pacientes/${patient.id}/anamnese`)

  const block = page.getByRole('region', { name: 'Assinatura da anamnese' })
  await expect(block).toContainText('Salve a anamnese antes de colher a assinatura')

  await page.getByRole('group', { name: question.text }).getByRole('button', { name: 'Não' }).click()
  await expect(block, 'alteração não salva também bloqueia').toContainText('Salve a anamnese')
  await page.getByRole('button', { name: 'Salvar anamnese' }).click()
  await expect(block).toContainText('Declaro que as informações desta anamnese são verdadeiras')

  const signButton = block.getByRole('button', { name: 'Assinar anamnese' })
  await block.getByRole('checkbox').check()
  await expect(signButton, 'sem desenho o botão fica desligado').toBeDisabled()
  await draw(page, block.locator('canvas'))
  await signButton.click()

  await expect(block).toContainText('Assinada pelo paciente')
  await expect(block).toContainText('Paciente Assina')
  await expect(block.getByRole('img', { name: 'Assinatura de Paciente Assina' })).toBeVisible()
  await expect(page.locator('details.version').first()).toContainText('Assinada')

  // Nova versão: a assinatura anterior fica na versão 1, e a atual pede assinatura de novo.
  await page.getByRole('group', { name: question.text }).getByRole('button', { name: 'Sim' }).click()
  await page.getByLabel(`${question.text} — ${question.detail_prompt}`).fill('Alergia a lidocaína')
  await page.getByRole('button', { name: 'Salvar anamnese' }).click()
  await expect(block.getByRole('button', { name: 'Assinar anamnese' })).toBeVisible()
  await expect(page.locator('details.version').first()).toContainText('Sem assinatura')
  await expect(page.locator('details.version').nth(1)).toContainText('Assinada')
  expect(errors).toEqual([])
})
