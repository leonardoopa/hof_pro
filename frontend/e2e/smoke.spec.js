import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { blockFaceDetection, collectPageErrors, createPatient, signIn, syntheticPhoto } from './helpers.js'

// launchOptions força outro navegador: só pode ser definido no topo do arquivo. Nos outros fluxos a câmera falsa não atrapalha.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['camera'],
})

const appErrors = (errors) => errors.filter((line) => !line.includes('net::ERR_FAILED'))
const toast = (page, text) => page.getByRole('status').filter({ hasText: text })
const todayBR = () => new Date().toLocaleDateString('pt-BR')

async function appliedPlan(api, patient, page) {
  const product = await api.post('/inventory/products', { brand: 'Marca E2E', name: 'Ácido hialurônico', kind: 'preenchedor', unit: 'ml' })
  const lot = await api.post('/inventory/lots', { product_id: product.id, number: 'L-SMOKE', expires_on: '2099-12-31', quantity: 10 })
  const photo = await api.upload(`/patients/${patient.id}/photos`, await syntheticPhoto(page))
  const plan = await api.post(`/patients/${patient.id}/plans`, {
    photo_id: photo.id,
    title: 'Plano E2E',
    notes: '',
    points: [{ region: 'malar', point_key: 'lateral', treatment: 'preenchimento', x: 0.33, y: 0.52, amount: 0.5, lot_id: lot.id }],
  })
  await api.post(`/plans/${plan.id}/apply`)
  return { lot, plan }
}

test('anamnese: "Sim" exige descrição e depois salva', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  const [question] = await api.get('/anamnesis/questions')
  await page.goto(`/pacientes/${patient.id}/anamnese`)

  await page.getByRole('group', { name: question.text }).getByRole('button', { name: 'Sim' }).click()
  await page.getByRole('button', { name: 'Salvar anamnese' }).click()
  await expect(page.getByText('Descreva a resposta de todas as perguntas')).toBeVisible()

  await page.getByLabel(`${question.text} — ${question.detail_prompt}`).fill('Alergia a lidocaína')
  await page.getByRole('button', { name: 'Salvar anamnese' }).click()
  await expect(toast(page, 'Anamnese salva')).toBeVisible()
  const saved = await api.get(`/patients/${patient.id}/anamnesis`)
  expect(saved.answers).toContainEqual({ question_id: question.id, answer: true, detail: 'Alergia a lidocaína' })
  expect(errors).toEqual([])
})

test('termo de uso de imagem: assinado desenhando no canvas e depois revogado', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  const terms = await api.get('/consent/terms')
  const term = terms.find((t) => t.kind === 'uso_imagem')
  await page.goto(`/pacientes/${patient.id}/prontuario`)

  const termRow = page.locator('.term-row').filter({ hasText: term.title })
  await termRow.getByRole('button', { name: 'Coletar assinatura' }).click()
  const dialog = page.getByRole('dialog', { name: term.title })
  await dialog.getByLabel('Nome de quem assina').fill('Paciente E2E')
  await dialog.getByRole('checkbox').check()
  await expect(dialog.getByRole('button', { name: 'Assinar' }), 'sem desenho o botão fica desligado').toBeDisabled()

  await dialog.locator('canvas').scrollIntoViewIfNeeded()
  const box = await dialog.locator('canvas').boundingBox()
  await page.mouse.move(box.x + 30, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
  await page.mouse.move(box.x + box.width - 30, box.y + 30, { steps: 6 })
  await page.mouse.up()

  await dialog.getByRole('button', { name: 'Assinar' }).click()
  await expect(toast(page, 'Assinatura registrada')).toBeVisible()
  await expect(termRow.locator('.chip')).toContainText('Assinado em')
  await expect.soft(termRow.locator('.chip'), 'a data é a do dia local da assinatura').toHaveText(`Assinado em ${todayBR()}`)

  await termRow.getByRole('button', { name: 'Revogar' }).click()
  const confirm = page.getByRole('dialog', { name: 'Revogar autorização' })
  await confirm.getByRole('button', { name: 'Revogar' }).click()
  await expect(toast(page, 'Autorização revogada')).toBeVisible()
  await expect(termRow.locator('.chip')).toHaveText('Revogado')
  expect(errors).toEqual([])
})

test('prontuário: rastreabilidade mostra a região e o nome do ponto', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  await appliedPlan(api, patient, page)
  await page.goto(`/pacientes/${patient.id}/prontuario`)
  const row = page.locator('tr').filter({ hasText: 'L-SMOKE' })
  await expect(row.locator('td').nth(1)).toHaveText('Malar Malar lateral')
  await expect(row.locator('td').last()).toHaveText('0,5 ml')
  expect(errors).toEqual([])
})

test('evolução: com duas fotos abre a comparação antes e depois', async ({ page }) => {
  const errors = collectPageErrors(page)
  await blockFaceDetection(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  await page.goto(`/pacientes/${patient.id}/evolucao`)
  await expect(page.getByText('Este paciente ainda não tem fotos.')).toBeVisible()

  await page.locator('input[type=file]').setInputFiles(await syntheticPhoto(page))
  await expect(page.getByText('Este paciente tem apenas uma foto.')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(await syntheticPhoto(page, { width: 600, height: 800 }))

  await expect(page.locator('.evo-pickers select')).toHaveCount(2)
  await expect(page.locator('canvas').first()).toBeVisible()
  expect(appErrors(errors)).toEqual([])
})

test('resumo e orientações: gerado a partir de um plano', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  await appliedPlan(api, patient, page)
  await page.goto(`/pacientes/${patient.id}/resumo`)

  await expect(page.getByRole('heading', { name: 'Resumo e orientações pós-procedimento' })).toBeVisible()
  await expect(page.getByText('Nenhuma aplicação com quantidade definida neste plano.')).toHaveCount(0)
  await expect(page.getByText('Nenhuma orientação aplicável aos tratamentos deste plano.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Imprimir / salvar PDF' })).toBeEnabled()
  expect(errors).toEqual([])
})

test('estoque: cria produto e lote pela tela', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  await page.goto('/estoque')

  await page.getByRole('button', { name: 'Produto', exact: true }).click()
  const product = page.getByRole('dialog', { name: 'Novo produto' })
  await product.getByLabel('Marca').fill('Marca E2E')
  await product.getByLabel('Nome').fill('Toxina teste')
  await product.getByRole('button', { name: 'Salvar' }).click()
  await expect(product).toHaveCount(0)

  await page.getByRole('button', { name: 'Entrada de lote' }).click()
  const lot = page.getByRole('dialog', { name: 'Entrada de lote' })
  await lot.getByLabel('Número do lote').fill('L-TELA')
  await lot.getByLabel('Validade').fill('2099-12-31')
  await lot.getByLabel(/^Quantidade/).fill('12,5')
  await lot.getByRole('button', { name: 'Registrar entrada' }).click()
  await expect(lot).toHaveCount(0)

  await expect(page.locator('.inv-table').getByText('L-TELA')).toBeVisible()
  await expect(page.getByRole('button', { name: /Excluir/ })).toHaveCount(0) // produto se desativa; lote errado se ajusta com motivo
  const [created] = await api.get('/inventory/lots?available=true')
  expect(created).toMatchObject({ number: 'L-TELA', balance: 12.5 })
  expect(errors).toEqual([])
})

test('relatórios: abre e exporta o CSV de uso', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  const { lot } = await appliedPlan(api, patient, page)
  await page.goto('/relatorios')
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible()

  const exportButton = page.getByRole('button', { name: 'Exportar CSV' }).first()
  await expect(exportButton, 'a aplicação de hoje precisa entrar no período padrão').toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  expect(download.suggestedFilename()).toMatch(/^uso-.*\.csv$/)
  expect(readFileSync(await download.path(), 'utf8')).toContain(lot.number)
  expect(errors).toEqual([])
})

test('tema: alterna entre claro e escuro e mantém depois de recarregar', async ({ page }) => {
  const errors = collectPageErrors(page)
  await signIn(page)
  await page.goto('/pacientes')
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await expect(page.getByRole('button', { name: 'Usar tema escuro' })).toBeVisible() // o CSS entra junto com o app
  await expect.poll(background, 'o fundo entra em fade: espera ficar opaco').toMatch(/^rgb\(/)
  const light = await background()

  await page.getByRole('button', { name: 'Usar tema escuro' }).click()
  await expect(page.getByRole('button', { name: 'Usar tema claro' })).toBeVisible()
  await expect.poll(background).not.toBe(light)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Usar tema claro' })).toBeVisible()

  await page.getByRole('button', { name: 'Usar tema claro' }).click()
  await expect.poll(background).toBe(light)
  expect(errors).toEqual([])
})

test('paciente: ocultar dados não apaga, e "Mostrar dados" traz tudo de volta', async ({ page }) => {
  const errors = collectPageErrors(page)
  await blockFaceDetection(page)
  const api = await signIn(page)
  const patient = await createPatient(api, 'Nome Para Ocultar')
  await page.goto(`/pacientes/${patient.id}/planejamento`)
  await page.locator('input[type=file]').setInputFiles(await syntheticPhoto(page))
  await expect(page.locator('.hotspot')).toHaveCount(33)

  await page.getByRole('button', { name: 'Ocultar dados' }).click()
  await page.getByRole('dialog', { name: 'Ocultar dados do paciente' }).getByRole('button', { name: 'Ocultar dados' }).click()
  await expect(page.getByRole('heading', { name: 'Planejamento oculto' })).toBeVisible()
  await expect(page.getByText('Nome Para Ocultar')).toHaveCount(0)
  await expect(page.locator('.stage')).toHaveCount(0)
  expect((await api.get(`/patients/${patient.id}`)).anonymized_at).not.toBeNull()

  await page.getByRole('link', { name: 'Evolução' }).click()
  await expect(page.getByRole('heading', { name: 'Fotos ocultas' })).toBeVisible()
  await page.getByRole('link', { name: 'Planejamento' }).click()
  await page.getByRole('button', { name: 'Mostrar dados' }).click()
  await expect(page.getByRole('heading', { name: 'Nome Para Ocultar' })).toBeVisible()
  await expect(page.locator('.stage')).toBeVisible()
  expect((await api.get(`/patients/${patient.id}`)).anonymized_at).toBeNull()
  expect(errors.filter((line) => !line.includes('net::ERR_FAILED'))).toEqual([])
})

test('paciente: "Mostrar dados" com a tela de planejamento aberta mantém o rascunho', async ({ page }) => {
  const errors = collectPageErrors(page)
  await blockFaceDetection(page)
  const api = await signIn(page)
  const patient = await createPatient(api, 'Nome Com Rascunho')
  await page.goto(`/pacientes/${patient.id}/planejamento`)
  await page.locator('input[type=file]').setInputFiles(await syntheticPhoto(page))
  await expect(page.locator('.hotspot')).toHaveCount(33)
  const notes = page.getByPlaceholder(/assimetria leve/)
  await notes.fill('rascunho sem salvar')
  const reloads = []
  page.on('request', (request) => {
    if (request.url().endsWith(`/patients/${patient.id}/photos`)) reloads.push(request.url())
  })

  await page.getByRole('button', { name: 'Ocultar dados' }).click()
  await page.getByRole('dialog', { name: 'Ocultar dados do paciente' }).getByRole('button', { name: 'Ocultar dados' }).click()
  await expect(page.getByRole('heading', { name: 'Planejamento oculto' })).toBeVisible()
  await page.getByRole('button', { name: 'Mostrar dados' }).click()
  await expect(page.locator('.hotspot')).toHaveCount(33)
  // Dois quadros bastam para os efeitos da tela rodarem: recarregar o plano apagaria o rascunho logo depois.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(reloads).toEqual([])
  await expect(notes).toHaveValue('rascunho sem salvar')
  // A imagem continua carregando depois de ocultar e mostrar: o endereço temporário não foi revogado.
  const loaded = await page.locator('.stage img').first().evaluate((img) => img.complete && img.naturalWidth > 0)
  expect(loaded).toBe(true)
  await page.getByRole('button', { name: 'Salvar plano' }).click()
  await expect(page.getByText('Plano salvo')).toBeVisible()
  const [saved] = await api.get(`/patients/${patient.id}/plans`)
  expect((await api.get(`/plans/${saved.id}`)).notes).toBe('rascunho sem salvar')
  expect(errors.filter((line) => !line.includes('net::ERR_FAILED'))).toEqual([])
})

test('paciente: arquivar tira da lista sem apagar, e reativar traz de volta', async ({ page }) => {
  const errors = collectPageErrors(page)
  const api = await signIn(page)
  const patient = await createPatient(api, 'Nome Para Arquivar')
  await page.goto(`/pacientes/${patient.id}/anamnese`)
  await page.getByRole('button', { name: 'Arquivar' }).click()
  await page.getByRole('dialog', { name: 'Arquivar paciente' }).getByRole('button', { name: 'Arquivar' }).click()
  await expect(page).toHaveURL(/\/pacientes$/)
  await expect(page.getByText('Nome Para Arquivar')).toHaveCount(0)
  expect(await api.get('/patients')).toEqual([])

  await page.getByRole('button', { name: 'Ver arquivados' }).click()
  await page.getByText('Nome Para Arquivar').click()
  await expect(page.getByText('Arquivado', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reativar' }).click()
  await expect(page.getByRole('button', { name: 'Arquivar' })).toBeVisible()
  expect((await api.get('/patients')).map((p) => p.id)).toEqual([patient.id])

  await page.goto('/pacientes')
  await page.getByRole('button', { name: 'Ver arquivados' }).click()
  await expect(page.getByText('Nenhum paciente arquivado.')).toBeVisible()
  await page.getByRole('button', { name: 'Ver pacientes ativos' }).click()
  await expect(page.getByText('Nome Para Arquivar')).toBeVisible()
  expect(errors).toEqual([])
})

test('paciente de outro profissional: mostra "não encontrado" sem quebrar a tela', async ({ page }) => {
  const errors = collectPageErrors(page)
  const owner = await signIn(page)
  const patient = await createPatient(owner, 'Paciente Alheio')
  await signIn(page) // o token mais recente vale: o navegador entra como outro profissional
  await page.goto(`/pacientes/${patient.id}/planejamento`)

  await expect(page.getByText('Paciente não encontrado.')).toBeVisible()
  await expect(page.getByText('Paciente Alheio')).toHaveCount(0)
  // o 404 é a própria resposta correta deste cenário; o navegador sempre o registra no console
  expect(errors.filter((line) => !line.includes('status of 404'))).toEqual([])
})

test('planejamento: foto pela câmera vira a foto do plano', async ({ page }) => {
  const errors = collectPageErrors(page)
  await blockFaceDetection(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  await page.goto(`/pacientes/${patient.id}/planejamento`)

  await page.getByRole('button', { name: 'Tirar foto' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tirar foto do paciente' })
  await expect(dialog.getByRole('button', { name: 'Capturar' })).toBeEnabled({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Capturar' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.hotspot')).toHaveCount(33)
  expect((await api.get(`/patients/${patient.id}/photos`)).length).toBe(1)
  expect(appErrors(errors)).toEqual([])
})
