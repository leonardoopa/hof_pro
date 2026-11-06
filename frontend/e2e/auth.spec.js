import { expect, test } from '@playwright/test'
import { collectPageErrors, signIn } from './helpers.js'

test('cadastro pela tela leva à lista de pacientes', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/cadastro')
  await page.getByLabel(/nome/i).first().fill('Profissional da Tela')
  await page.getByLabel(/e-?mail/i).fill(`tela-${Date.now()}@example.com`)
  await page.getByLabel(/senha/i).first().fill('senha-de-teste-123')
  await page.getByRole('button', { name: /criar conta|cadastrar/i }).click()
  await expect(page).toHaveURL(/\/pacientes$/)
  expect(errors).toEqual([])
})

test('sessão preparada pela API entra direto', async ({ page }) => {
  await signIn(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/pacientes$/)
})
