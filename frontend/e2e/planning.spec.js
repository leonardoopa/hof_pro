import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { REGIONS } from '../src/planning/regions.js'
import { fallbackTemplate } from '../src/planning/template.js'
import { blockFaceDetection, collectPageErrors, createPatient, samplePortrait, signIn, syntheticPhoto } from './helpers.js'

const planningUrl = (patient) => `/pacientes/${patient.id}/planejamento`
const shot = (name) => join(process.env.E2E_SHOTS_DIR ?? test.info().outputDir, name)
const measure = (...values) => process.env.E2E_MEASURE && console.log('[medida]', ...values)

// Só o erro de rede causado pelo próprio bloqueio da detecção é ignorado.
const appErrors = (errors) => errors.filter((line) => !line.includes('net::ERR_FAILED'))

async function prepare(page) {
  const errors = collectPageErrors(page)
  await blockFaceDetection(page)
  const api = await signIn(page)
  const patient = await createPatient(api)
  return { errors, api, patient }
}

async function openWithPhoto(page, makePhoto = syntheticPhoto) {
  const context = await prepare(page)
  await page.goto(planningUrl(context.patient))
  await page.locator('input[type=file]').setInputFiles(await makePhoto(page))
  await expect(page.locator('.hotspot')).toHaveCount(33)
  return context
}

/** Traços finos na foto inteira: suavizar uma área lisa da foto sintética não muda nada, e isso não seria defeito da simulação. */
async function texturedPhoto(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 1000
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#d9b49a'
    ctx.fillRect(0, 0, 800, 1000)
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(120, 70, 50, 0.35)' : 'rgba(255, 235, 215, 0.35)'
      ctx.fillRect((i * 131) % 800, (i * 197) % 1000, 2 + (i % 7), 2 + ((i * 3) % 5))
    }
    return canvas.toDataURL('image/jpeg', 0.92)
  })
  return { name: 'textura.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
}

/** Plano salvo pela API, com foto: a tela abre direto nele. */
async function openWithPlan(page, points, { apply = false } = {}) {
  const context = await prepare(page)
  const { api, patient } = context
  const photo = await api.upload(`/patients/${patient.id}/photos`, await syntheticPhoto(page))
  const plan = await api.post(`/patients/${patient.id}/plans`, { photo_id: photo.id, title: 'Plano E2E', notes: '', points })
  if (apply) await api.post(`/plans/${plan.id}/apply`)
  await page.goto(planningUrl(patient))
  return { ...context, plan, photo }
}

/** Todas as regiões preenchidas, alternando unidades para os rótulos ficarem no tamanho real de uso. */
const everyRegionFilled = () =>
  fallbackTemplate().map(({ region, point_key, x, y }, i) => ({
    region,
    point_key,
    x,
    y,
    treatment: i % 2 ? 'botox' : 'preenchimento',
    amount: i % 2 ? 2 : 0.5,
  }))

/** Modelo inteiro salvo, com quantidade só nas regiões pedidas. */
const planWithAmountsIn = (...regions) =>
  fallbackTemplate().map(({ region, point_key, x, y }) => ({
    region,
    point_key,
    x,
    y,
    treatment: 'preenchimento',
    amount: regions.includes(region) ? 0.5 : 0,
  }))

const regionRow = (page, label) => page.locator('.region-row').filter({ has: page.getByText(label, { exact: true }) })
const summary = (page, label) => page.locator('.summary > div').filter({ hasText: label }).locator('dd')
const treatmentButton = (page, name) =>
  page.getByRole('group', { name: 'Tratamento a aplicar' }).getByRole('button', { name: new RegExp(`^${name}`) })
const backToOverview = (page) => page.getByRole('button', { name: 'Todas as regiões' })
const saveButton = (page) => page.getByRole('button', { name: 'Salvar plano' })
const unsavedNote = (page) => page.getByText('Alterações não salvas')
const photoImage = (page) => page.getByAltText('Foto frontal do paciente')
const row = (page, index) => page.locator('.prow').nth(index)
const plus = (page, index) => row(page, index).getByRole('button', { name: 'Aumentar' })
const minus = (page, index) => row(page, index).getByRole('button', { name: 'Diminuir' })
const amountInput = (page, index) => row(page, index).locator('.amount input')

/** Espera o zoom terminar: medir durante a transição daria posições intermediárias. */
const settled = (page) =>
  page.evaluate(() => Promise.all(document.querySelector('.stage-inner').getAnimations().map((a) => a.finished.catch(() => {}))))

async function openRegion(page, label) {
  await regionRow(page, label).click()
  await expect(page.locator('.stage-toolbar strong')).toHaveText(label)
  await settled(page)
}

const fractionOf = (locator) => locator.evaluate((el) => ({ x: parseFloat(el.style.left) / 100, y: parseFloat(el.style.top) / 100 }))

const rectsOf = (page, selector) =>
  page.locator(selector).evaluateAll((elements) =>
    elements.map((el) => {
      const { left, right, top, bottom, width, height } = el.getBoundingClientRect()
      return { name: el.getAttribute('aria-label') ?? el.textContent, left, right, top, bottom, x: left + width / 2, y: top + height / 2 }
    }),
  )

const stageRect = (page) =>
  page.locator('.stage').evaluate((el) => {
    const { left, right, top, bottom } = el.getBoundingClientRect()
    return { left, right, top, bottom }
  })

const outside = (rects, stage) =>
  rects
    .filter((r) => r.left < stage.left - 0.5 || r.right > stage.right + 0.5 || r.top < stage.top - 0.5 || r.bottom > stage.bottom + 0.5)
    .map((r) => r.name)

/** Largura da rolagem da página e os elementos que passam da tela (o conteúdo do palco é recortado por ele, não conta). */
const horizontalOverflow = (page) =>
  page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter((el) => !el.closest('.stage-inner') && el.getBoundingClientRect().right > window.innerWidth + 0.5)
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className} (até ${Math.round(el.getBoundingClientRect().right)} px)`)
      .join(', '),
  }))

/**
 * Diferença média por canal (0 a 255) entre a simulação e a foto, num círculo em frações da foto (raio em fração
 * da largura). -1 sem camada de simulação pronta.
 */
const simDiff = (page, { x, y }, radius = 0.03) =>
  page.evaluate(
    async ({ x, y, radius }) => {
      const photo = document.querySelector('.stage-inner img:not(.sim-layer)')
      const sim = document.querySelector('.sim-layer')
      if (!sim) return -1
      try {
        await Promise.all([photo.decode(), sim.decode()])
      } catch {
        return -1 // a camada foi trocada durante a leitura; a próxima tentativa lê a nova
      }
      const { naturalWidth: w, naturalHeight: h } = photo
      const read = (img) => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        return ctx.getImageData(0, 0, w, h).data
      }
      const [a, b] = [read(photo), read(sim)]
      const [cx, cy, r] = [x * w, y * h, radius * w]
      let sum = 0
      let count = 0
      for (let py = Math.max(0, Math.floor(cy - r)); py < Math.min(h, Math.ceil(cy + r)); py++) {
        for (let px = Math.max(0, Math.floor(cx - r)); px < Math.min(w, Math.ceil(cx + r)); px++) {
          if (Math.hypot(px - cx, py - cy) > r) continue
          const i = (py * w + px) * 4
          sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
          count += 3
        }
      }
      return sum / count
    },
    { x, y, radius },
  )

// A recompressão em JPEG muda em média menos de 0,05 nas fotos destes testes (medido). Acima disto a mudança é da simulação.
const JPEG_NOISE = 0.1

/** Arrasta com o mouse e devolve onde o cursor foi solto. */
async function dragBy(page, target, dx, dy) {
  const box = await target.boundingBox()
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up()
  return { x: start.x + dx, y: start.y + dy }
}

test.describe('envio da foto', () => {
  test('sem detecção, avisa e mostra 19 regiões em 4 grupos e 33 hotspots', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await expect(page.locator('.note').filter({ hasText: 'Detecção indisponível' })).toBeVisible()
    await expect(page.locator('.region-row')).toHaveCount(19)
    await expect(page.locator('.region-group')).toHaveCount(4)
    await expect(page.locator('.hotspot')).toHaveCount(33)
    await expect(photoImage(page)).toBeVisible()
    await expect(unsavedNote(page)).toBeVisible()
    expect(appErrors(errors)).toEqual([])
  })
})

test.describe('zoom de região', () => {
  test('cada região abre pela lista com pontos nomeados, alerta de risco e lados corretos', async ({ page }) => {
    test.setTimeout(150_000)
    const { errors } = await openWithPhoto(page)

    for (const region of REGIONS) {
      await test.step(region.label, async () => {
        await openRegion(page, region.label)
        const names = Object.values(region.points).sort()
        const checkPoints = async () => {
          const shown = await page.locator('.pname').allTextContents()
          expect.soft(shown.sort(), `nomes de ${region.label}`).toEqual(names)
          expect.soft(await page.locator('.pt').count(), `pontos na foto de ${region.label}`).toBe(names.length)
          await settled(page)
          const away = outside(await rectsOf(page, '.pt'), await stageRect(page))
          expect.soft(away, `pontos fora do palco em ${region.label}`).toEqual([])
        }

        const sides = page.getByRole('group', { name: 'Lado do rosto' })
        if (region.bilateral) {
          for (const side of ['Lado direito', 'Lado esquerdo']) {
            await sides.getByRole('button', { name: side }).click()
            await expect(sides.getByRole('button', { name: side })).toHaveAttribute('aria-pressed', 'true')
            await expect(page.locator('.card-title').filter({ hasText: side })).toBeVisible()
            await checkPoints()
          }
        } else {
          await expect.soft(sides).toHaveCount(0)
          await checkPoints()
        }

        if (region.risk) await expect.soft(page.locator('.risk-note')).toHaveText(region.risk)
        else await expect.soft(page.locator('.risk-note')).toHaveCount(0)

        await backToOverview(page).click()
        await expect(page.locator('.hotspot')).toHaveCount(33)
        await expect(page.locator('.region-row')).toHaveCount(19)
      })
    }
    expect(appErrors(errors)).toEqual([])
  })

  test('hotspot abre a região no lado clicado; a boca tem os 8 pontos', async ({ page }) => {
    const { errors } = await openWithPhoto(page)

    await page.getByRole('button', { name: /^Malar \(lado esquerdo\):/ }).click()
    await expect(page.locator('.stage-toolbar strong')).toHaveText('Malar')
    await expect(page.getByRole('group', { name: 'Lado do rosto' }).getByRole('button', { name: 'Lado esquerdo' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.risk-note')).toBeVisible()
    await backToOverview(page).click()

    await page.getByRole('button', { name: /^Zigomático \(lado direito\):/ }).click()
    await expect(page.locator('.stage-toolbar strong')).toHaveText('Zigomático')
    await expect(page.locator('.risk-note')).toHaveCount(0)
    await backToOverview(page).click()

    await page.getByRole('button', { name: /^Boca \(lábios\):/ }).click()
    await expect(page.locator('.stage-toolbar strong')).toHaveText('Boca (lábios)')
    await expect(page.getByRole('group', { name: 'Lado do rosto' })).toHaveCount(0)
    await expect(page.locator('.risk-note')).toBeVisible()
    await expect(page.locator('.pt')).toHaveCount(8)
    const names = await page.locator('.pname').allTextContents()
    expect(names.sort()).toEqual(Object.values(REGIONS.find((r) => r.key === 'boca').points).sort())
    await backToOverview(page).click()
    await expect(page.locator('.hotspot')).toHaveCount(33)
    expect(appErrors(errors)).toEqual([])
  })

  test('todos os 33 hotspots recebem o clique, sem um cobrir o outro', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    const hotspots = page.locator('.hotspot')
    for (let i = 0; i < 33; i++) await hotspots.nth(i).click({ trial: true, timeout: 3000 })
    expect(appErrors(errors)).toEqual([])
  })
})

test.describe('quantidade e simulação ao vivo', () => {
  test('+ usa a dose inicial do tratamento escolhido; o resumo acompanha; toxina em U e o resto em ml', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')

    const steps = [
      { name: 'Preenchimento', key: 'preenchimento', value: '0,2', unit: 'ml', ml: '0,2 ml', units: '0 un' },
      { name: 'Botox', key: 'botox', value: '2', unit: 'U', ml: '0,2 ml', units: '2 un' },
      { name: 'Bioestimulador', key: 'bioestimulador', value: '0,5', unit: 'ml', ml: '0,7 ml', units: '2 un' },
      { name: 'Skinbooster', key: 'skinbooster', value: '0,1', unit: 'ml', ml: '0,8 ml', units: '2 un' },
      { name: 'Outro', key: 'outro', value: '0,1', unit: 'ml', ml: '0,9 ml', units: '2 un' },
    ]
    for (const [index, step] of steps.entries()) {
      await treatmentButton(page, step.name).click()
      await plus(page, index).click()
      await expect(amountInput(page, index)).toHaveValue(step.value)
      await expect(row(page, index).locator('.unit')).toHaveText(step.unit)
      await expect(row(page, index).getByRole('combobox', { name: `Tratamento do ponto ${index + 1}` })).toHaveValue(step.key)
      await expect(summary(page, 'Total de ml')).toHaveText(step.ml)
      await expect(summary(page, 'Total de unidades')).toHaveText(step.units)
      await expect(summary(page, 'Número de áreas')).toHaveText('1')
    }

    await plus(page, 0).click()
    await expect(amountInput(page, 0)).toHaveValue('0,3')
    await expect(summary(page, 'Total de ml')).toHaveText('1 ml')
    await plus(page, 1).click()
    await expect(amountInput(page, 1)).toHaveValue('3')
    await expect(summary(page, 'Total de unidades')).toHaveText('3 un')
    await minus(page, 1).click()
    await expect(amountInput(page, 1)).toHaveValue('2')

    await backToOverview(page).click()
    await expect(regionRow(page, 'Testa').locator('b')).toHaveText('2 U · 1 ml')
    await openRegion(page, 'Nariz')
    await treatmentButton(page, 'Preenchimento').click()
    await plus(page, 0).click()
    await expect(summary(page, 'Número de áreas')).toHaveText('2')
    await expect(summary(page, 'Total de ml')).toHaveText('1,2 ml')
    expect(appErrors(errors)).toEqual([])
  })

  test('a foto muda em volta do ponto, muda mais com mais quantidade e fica igual longe dele', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await expect(page.locator('.sim-layer')).toHaveCount(0)
    await openRegion(page, 'Testa')
    const spot = await fractionOf(page.locator('.pt').first())
    const far = { x: 0.5, y: 0.9 }

    await plus(page, 0).click()
    await expect(page.locator('.sim-layer'), 'a simulação liga sozinha, sem clicar em "Simular resultado"').toBeAttached({ timeout: 3000 })
    await expect(page.getByRole('button', { name: 'Simular resultado' })).toHaveAttribute('aria-pressed', 'true')

    await expect.poll(() => simDiff(page, spot), 'diferença em volta do ponto com 0,2 ml').toBeGreaterThan(JPEG_NOISE)
    const small = await simDiff(page, spot)
    const farSmall = await simDiff(page, far)
    measure('preenchimento 0,2 ml: perto', small, 'longe', farSmall)
    expect(farSmall, 'área distante do ponto').toBeLessThan(JPEG_NOISE)

    await amountInput(page, 0).fill('1')
    await expect(amountInput(page, 0)).toHaveValue('1')
    await expect.poll(() => simDiff(page, spot), 'mais quantidade muda mais a foto').toBeGreaterThan(small * 1.3)
    const large = await simDiff(page, spot)
    const farLarge = await simDiff(page, far)
    measure('preenchimento 1 ml: perto', large, 'longe', farLarge)
    expect(farLarge, 'área distante do ponto com 1 ml').toBeLessThan(JPEG_NOISE)
    expect(appErrors(errors)).toEqual([])
  })

  for (const [treatment, regionLabel] of [
    ['Botox', 'Testa'],
    ['Botox', 'Boca (lábios)'],
    ['Preenchimento', 'Malar'],
    ['Preenchimento', 'Nasolabial'],
    ['Preenchimento', 'Boca (lábios)'],
    ['Bioestimulador', 'Mandíbula'],
    ['Skinbooster', 'Nariz'],
    ['Skinbooster', 'Boca (lábios)'],
    ['Outro', 'Mento'],
  ]) {
    test(`dose inicial de ${treatment} em ${regionLabel} já muda a foto`, async ({ page }) => {
      const { errors } = await openWithPhoto(page, texturedPhoto)
      await treatmentButton(page, treatment).click()
      await openRegion(page, regionLabel)
      const spot = await fractionOf(page.locator('.pt').first())
      await plus(page, 0).click()
      await expect(page.locator('.sim-layer')).toBeAttached({ timeout: 3000 })
      await expect.poll(() => simDiff(page, spot), `${treatment} em ${regionLabel} precisa mudar a foto em volta do ponto`).toBeGreaterThan(JPEG_NOISE)
      const near = await simDiff(page, spot)
      const far = await simDiff(page, { x: 0.08, y: 0.06 }) // canto longe de todos os pontos
      measure(`${treatment} em ${regionLabel}, dose inicial: perto`, near.toFixed(2), 'longe', far.toFixed(2))
      expect(near, 'perto do ponto, comparado ao canto distante').toBeGreaterThan(far * 5)
      expect(appErrors(errors)).toEqual([])
    })
  }

  for (const [typed, total, value] of [
    ['0,3', '0,3 ml', '0,3'],
    ['1,5', '1,5 ml', '1,5'],
    ['0.3', '0,3 ml', '0,3'],
    ['1.5', '1,5 ml', '1,5'],
  ]) {
    test(`quantidade digitada tecla a tecla como ${typed} vale ${total}`, async ({ page }) => {
      const { errors } = await openWithPhoto(page)
      await openRegion(page, 'Testa')
      await amountInput(page, 0).selectText()
      await page.keyboard.type(typed)
      await expect(summary(page, 'Total de ml')).toHaveText(total)
      await amountInput(page, 0).blur()
      await expect(amountInput(page, 0)).toHaveValue(value)
      expect(appErrors(errors)).toEqual([])
    })
  }

  test('casas decimais além de duas são arredondadas no campo, não só no total', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await amountInput(page, 0).selectText()
    await page.keyboard.type('0,123')
    await expect(amountInput(page, 0)).toHaveValue('0,12')
    await expect(summary(page, 'Total de ml')).toHaveText('0,12 ml')
    expect(appErrors(errors)).toEqual([])
  })

  test('setas do teclado no campo sobem e descem a quantidade', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await amountInput(page, 0).focus()
    await page.keyboard.press('ArrowUp')
    await expect(amountInput(page, 0)).toHaveValue('0,2')
    await page.keyboard.press('ArrowUp')
    await expect(amountInput(page, 0)).toHaveValue('0,3')
    await page.keyboard.press('ArrowDown')
    await expect(amountInput(page, 0)).toHaveValue('0,2')
    expect(appErrors(errors)).toEqual([])
  })

  test('toxina suaviza a pele sem borrar traço forte', async ({ page }) => {
    const { errors, api, patient } = await prepare(page)
    // Faixa escura como uma sobrancelha, sobre pele de textura fina, com o ponto de toxina em cima da faixa.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 1000
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#d9b49a'
      ctx.fillRect(0, 0, 800, 1000)
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(120, 70, 50, 0.12)' : 'rgba(255, 235, 215, 0.12)'
        ctx.fillRect((i * 131) % 800, (i * 197) % 1000, 2 + (i % 7), 2 + ((i * 3) % 5))
      }
      ctx.fillStyle = '#2b1d16'
      ctx.fillRect(250, 385, 300, 30)
      return canvas.toDataURL('image/jpeg', 0.95)
    })
    const file = { name: 'faixa.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
    const photo = await api.upload(`/patients/${patient.id}/photos`, file)
    await api.post(`/patients/${patient.id}/plans`, {
      photo_id: photo.id,
      title: 'Plano E2E',
      notes: '',
      points: [{ region: 'glabela', point_key: 'procero', treatment: 'botox', x: 0.5, y: 0.4, amount: 10 }],
    })
    await page.goto(planningUrl(patient))
    await expect.poll(() => simDiff(page, { x: 0.5, y: 0.33 }, 0.02), 'a pele perto do ponto suaviza').toBeGreaterThan(JPEG_NOISE)
    const band = await simDiff(page, { x: 0.5, y: 0.4 }, 0.012)
    measure('toxina: diferença dentro da faixa escura', band.toFixed(2))
    expect(band, 'a faixa escura continua nítida').toBeLessThan(8) // sem a proteção de borda, 17,7
    expect(appErrors(errors)).toEqual([])
  })

  test('quantidade fora dos limites é contida entre 0 e 200', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await amountInput(page, 0).fill('999')
    await expect(amountInput(page, 0)).toHaveValue('200')
    await amountInput(page, 0).fill('-5')
    await expect(amountInput(page, 0)).toHaveValue('0')
    await expect(summary(page, 'Total de ml')).toHaveText('0 ml')
    expect(appErrors(errors)).toEqual([])
  })

  test('tratamento escolhido na linha do ponto não é trocado ao aumentar a quantidade', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await row(page, 0).getByRole('combobox', { name: 'Tratamento do ponto 1' }).selectOption('botox')
    await plus(page, 0).click()
    await expect(row(page, 0).getByRole('combobox', { name: 'Tratamento do ponto 1' })).toHaveValue('botox')
    await expect(amountInput(page, 0)).toHaveValue('2')
    await expect(summary(page, 'Total de unidades')).toHaveText('2 un')
    expect(appErrors(errors)).toEqual([])
  })

  test('slider em 0 recorta toda a simulação; em 100 mostra toda', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    const layer = page.locator('.sim-layer')
    await expect(layer).toBeAttached()
    await expect(layer).toHaveCSS('clip-path', 'inset(0px 0px 0px 0%)')

    const slider = page.getByLabel('Comparar antes e depois')
    await slider.fill('0')
    await expect(layer).toHaveCSS('clip-path', 'inset(0px 0px 0px 100%)')
    await slider.fill('100')
    await expect(layer).toHaveCSS('clip-path', 'inset(0px 0px 0px 0%)')
    expect(appErrors(errors)).toEqual([])
  })

  test('slider no meio mostra o divisor entre antes e depois, inclusive sem os pontos', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await expect(page.locator('.sim-layer')).toBeAttached()
    const divider = page.locator('.sim-divider')
    await expect(divider, 'em 100 só há o depois').toHaveCount(0)

    const slider = page.getByLabel('Comparar antes e depois')
    await slider.fill('30')
    await expect(page.locator('.sim-layer')).toHaveCSS('clip-path', 'inset(0px 0px 0px 70%)')
    await expect(divider).toBeVisible()
    await expect(divider).toHaveAttribute('style', /left: 70%/)
    await page.getByRole('button', { name: 'Ocultar pontos' }).click()
    await expect(divider).toBeVisible()

    await slider.fill('0')
    await expect(divider, 'em 0 só há o antes').toHaveCount(0)
    expect(appErrors(errors)).toEqual([])
  })

  test('preenchedor no sulco clareia o vinco, sem deformar nem apagar o que está em volta', async ({ page }) => {
    const { errors, api, patient } = await prepare(page)
    // Em volta do ponto: vinco fino e pouco escuro, traço branco que acusaria deslocamento e faixa bem escura como a boca.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 1000
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#d9b49a'
      ctx.fillRect(0, 0, 800, 1000)
      ctx.fillStyle = '#af8770'
      ctx.fillRect(250, 497, 300, 6)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(424, 440, 4, 45)
      ctx.fillStyle = '#20120c'
      ctx.fillRect(364, 515, 12, 40)
      return canvas.toDataURL('image/jpeg', 0.95)
    })
    const file = { name: 'sulco.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
    const photo = await api.upload(`/patients/${patient.id}/photos`, file)
    await api.post(`/patients/${patient.id}/plans`, {
      photo_id: photo.id,
      title: 'Plano E2E',
      notes: '',
      points: [{ region: 'nasolabial', point_key: 'sulco', treatment: 'preenchimento', x: 0.5, y: 0.5, amount: 1 }],
    })
    await page.goto(planningUrl(patient))

    await expect.poll(() => simDiff(page, { x: 0.5, y: 0.5 }, 0.003), 'o vinco clareia').toBeGreaterThan(8)
    const white = await simDiff(page, { x: 0.5325, y: 0.4625 }, 0.002)
    const dark = await simDiff(page, { x: 0.4625, y: 0.535 }, 0.004)
    measure('sulco: vinco', (await simDiff(page, { x: 0.5, y: 0.5 }, 0.003)).toFixed(2), 'traço branco', white.toFixed(2), 'faixa escura', dark.toFixed(2))
    expect(white, 'o traço branco não saiu do lugar').toBeLessThan(5)
    expect(dark, 'a faixa bem escura continua igual').toBeLessThan(8)
    expect(appErrors(errors)).toEqual([])
  })

  test('a linha do ponto mostra a quantidade, e nada na tela fala em preço', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await expect(row(page, 0).locator('.amount')).toContainText('Quantidade')
    await expect(page.locator('.planning')).not.toContainText(/R\$|pre[cç]o/i)
    expect(appErrors(errors)).toEqual([])
  })

  test('zerar todas as quantidades tira a simulação', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await treatmentButton(page, 'Botox').click()
    await plus(page, 1).click()
    await expect(page.locator('.sim-layer')).toBeAttached()

    await minus(page, 0).click()
    await minus(page, 0).click()
    await expect(amountInput(page, 0)).toHaveValue('0')
    await expect(minus(page, 0)).toBeDisabled()
    await expect(page.locator('.sim-layer'), 'ainda há um ponto com quantidade').toBeAttached()

    await amountInput(page, 1).fill('0')
    await expect(page.locator('.sim-layer')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Simular resultado' })).toHaveAttribute('aria-pressed', 'false')
    await expect(summary(page, 'Número de áreas')).toHaveText('0')
    expect(appErrors(errors)).toEqual([])
  })
})

test.describe('ocultar pontos', () => {
  test('sem hotspots nem marcas, com foto e simulação; "Mostrar pontos" restaura', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await backToOverview(page).click()
    await expect(page.locator('.hotspot')).toHaveCount(33)
    await expect(page.locator('.dot')).toHaveCount(1)

    await page.getByRole('button', { name: 'Ocultar pontos' }).click()
    await expect(page.locator('.hotspot')).toHaveCount(0)
    await expect(page.locator('.dot')).toHaveCount(0)
    await expect(photoImage(page)).toBeVisible()
    await expect(page.locator('.sim-layer')).toBeVisible()

    await page.getByRole('button', { name: 'Mostrar pontos' }).click()
    await expect(page.locator('.hotspot')).toHaveCount(33)
    await expect(page.locator('.dot')).toHaveCount(1)
    expect(appErrors(errors)).toEqual([])
  })

  test('depois de ocultar e mostrar de novo, zerar as quantidades ainda tira a simulação', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await page.getByRole('button', { name: 'Ocultar pontos' }).click()
    await page.getByRole('button', { name: 'Mostrar pontos' }).click()
    await amountInput(page, 0).fill('0')
    await expect(page.locator('.sim-layer')).toHaveCount(0)
    expect(appErrors(errors)).toEqual([])
  })
})

test('hotspot vazio é um anel leve e o preenchido um círculo cheio, com a mesma área de toque', async ({ page }) => {
  const { errors } = await openWithPlan(page, planWithAmountsIn('boca'))
  const look = (locator) =>
    locator.evaluate((el) => {
      const ring = getComputedStyle(el, '::before')
      return { drawn: parseFloat(ring.width), fill: ring.backgroundColor, animation: getComputedStyle(el).animationName, touch: el.offsetWidth }
    })
  const empty = await look(page.locator('.hotspot:not(.filled)').first())
  const filled = await look(page.locator('.hotspot.filled').first())
  expect(empty.drawn).toBeLessThan(filled.drawn)
  expect(empty.fill).not.toBe(filled.fill)
  expect(empty.animation, 'sem pulsar').toBe('none')
  expect(empty.touch).toBe(26)
  expect(filled.touch).toBe(26)
  expect(appErrors(errors)).toEqual([])
})

test.describe('edição na região ampliada', () => {
  test('arrastar um ponto entre os outros o move junto com o cursor', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    const point = page.locator('.pt').nth(2) // central: fica dentro do enquadramento do zoom
    const before = await fractionOf(point)
    const inner = await page.locator('.stage-inner').boundingBox()

    const drop = await dragBy(page, point, 25, 0)
    await settled(page)

    const after = await fractionOf(point)
    expect(after.x - before.x).toBeCloseTo(25 / inner.width, 2)
    const box = await point.boundingBox()
    expect(Math.hypot(box.x + box.width / 2 - drop.x, box.y + box.height / 2 - drop.y), 'distância do ponto ao cursor (px)').toBeLessThan(6)
    await expect(unsavedNote(page)).toBeVisible()
    expect(appErrors(errors)).toEqual([])
  })

  test('ao arrastar um ponto para fora do enquadramento ele continua sob o cursor', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    const point = page.locator('.pt').nth(2)
    const before = await fractionOf(point)

    const drop = await dragBy(page, point, 0, 60)
    await settled(page)

    const after = await fractionOf(point)
    expect(after.y).toBeGreaterThan(before.y)
    const box = await point.boundingBox()
    const distance = Math.hypot(box.x + box.width / 2 - drop.x, box.y + box.height / 2 - drop.y)
    measure('Testa, arraste vertical de 60 px: ponto a', distance, 'px do cursor')
    expect(distance, 'distância do ponto ao cursor depois de soltar (px)').toBeLessThan(6)
    expect(appErrors(errors)).toEqual([])
  })

  test('arrastar o único ponto de uma região o deixa sob o cursor', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Têmporas')
    const point = page.locator('.pt').first()
    const before = await fractionOf(point)

    const drop = await dragBy(page, point, 60, 30)
    await settled(page)

    const after = await fractionOf(point)
    expect(after.x).toBeGreaterThan(before.x)
    const box = await point.boundingBox()
    const distance = Math.hypot(box.x + box.width / 2 - drop.x, box.y + box.height / 2 - drop.y)
    measure('Têmporas, arraste de 60x30 px: ponto a', distance, 'px do cursor')
    expect(distance, 'distância do ponto ao cursor depois de soltar (px)').toBeLessThan(6)
    expect(appErrors(errors)).toEqual([])
  })

  test('"Adicionar ponto" e clique na foto criam uma linha sem nome', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await expect(page.locator('.prow')).toHaveCount(5)

    await page.getByRole('button', { name: 'Adicionar ponto' }).click()
    await expect(page.locator('.stage')).toHaveClass(/adding/)
    const stage = await page.locator('.stage').boundingBox()
    const inner = await page.locator('.stage-inner').boundingBox()
    const position = { x: stage.width * 0.2, y: stage.height * 0.8 }
    await page.locator('.stage').click({ position })

    await expect(page.locator('.prow')).toHaveCount(6)
    await expect(page.locator('.pt')).toHaveCount(6)
    await expect(page.locator('.pname')).toHaveCount(5)
    await expect(row(page, 5).locator('.pname')).toHaveCount(0)
    await expect(amountInput(page, 5)).toHaveValue('0,2')
    await expect(page.getByRole('button', { name: 'Adicionar ponto' })).toBeVisible()
    const added = await fractionOf(page.locator('.pt').last())
    expect(added.x).toBeCloseTo((stage.x + position.x - inner.x) / inner.width, 2)
    expect(added.y).toBeCloseTo((stage.y + position.y - inner.y) / inner.height, 2)
    await settled(page)
    expect(outside(await rectsOf(page, '.pt'), await stageRect(page))).toEqual([])
    expect(appErrors(errors)).toEqual([])
  })

  test('remover tira a linha e o ponto; sem pontos a região avisa e o hotspot do lado some', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await expect(summary(page, 'Total de ml')).toHaveText('0,2 ml')
    await page.getByRole('button', { name: 'Remover ponto 1' }).click()
    await expect(page.locator('.prow')).toHaveCount(4)
    await expect(page.locator('.pt')).toHaveCount(4)
    await expect(page.locator('.pname').first()).toHaveText('Frontal medial D')
    await expect(summary(page, 'Total de ml')).toHaveText('0 ml')
    await backToOverview(page).click()

    await openRegion(page, 'Têmporas')
    await page.getByRole('button', { name: 'Remover ponto 1' }).click()
    await expect(page.locator('.prow')).toHaveCount(0)
    await expect(page.getByText('Nenhum ponto nesta região')).toBeVisible()
    await backToOverview(page).click()
    await expect(page.locator('.hotspot')).toHaveCount(32)
    expect(appErrors(errors)).toEqual([])
  })
})

test.describe('salvar e recarregar', () => {
  test('quantidades persistem e os pontos do modelo têm point_key; o adicionado à mão não', async ({ page }) => {
    const { errors, api, patient } = await openWithPhoto(page)
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await amountInput(page, 1).fill('0.5')
    await page.getByRole('button', { name: 'Adicionar ponto' }).click()
    const stage = await page.locator('.stage').boundingBox()
    await page.locator('.stage').click({ position: { x: stage.width * 0.2, y: stage.height * 0.8 } })
    await expect(page.locator('.prow')).toHaveCount(6)
    await expect(summary(page, 'Total de ml')).toHaveText('0,9 ml')

    await saveButton(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plano salvo' })).toBeVisible()
    await expect(unsavedNote(page)).toHaveCount(0)

    await page.reload()
    await expect(page.locator('.hotspot')).toHaveCount(33)
    await expect(summary(page, 'Total de ml')).toHaveText('0,9 ml')
    await expect(summary(page, 'Número de áreas')).toHaveText('1')
    await expect(unsavedNote(page)).toHaveCount(0)
    await expect(page.locator('.sim-layer')).toBeAttached()
    await openRegion(page, 'Testa')
    await expect(page.locator('.prow')).toHaveCount(6)
    await expect(amountInput(page, 0)).toHaveValue('0,2')
    await expect(amountInput(page, 1)).toHaveValue('0,5')
    await expect(amountInput(page, 5)).toHaveValue('0,2')
    await expect(page.locator('.pname')).toHaveCount(5)

    const [summaryRow] = await api.get(`/patients/${patient.id}/plans`)
    const plan = await api.get(`/plans/${summaryRow.id}`)
    expect(plan.totals.total_ml).toBeCloseTo(0.9)
    const byHand = plan.points.filter((p) => p.point_key === '')
    expect(byHand).toHaveLength(1)
    expect(byHand[0]).toMatchObject({ region: 'testa', amount: 0.2 })
    expect(plan.points.filter((p) => p.point_key !== '')).toHaveLength(fallbackTemplate().length)
    expect(appErrors(errors)).toEqual([])
  })

  test('pontos removidos de uma região continuam removidos depois de recarregar', async ({ page }) => {
    const { errors } = await openWithPhoto(page)
    await openRegion(page, 'Mento')
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Remover ponto 1' }).click()
    await expect(page.locator('.prow')).toHaveCount(0)
    await saveButton(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plano salvo' })).toBeVisible()
    await backToOverview(page).click()
    await expect(page.locator('.hotspot')).toHaveCount(32)

    await page.reload()
    await expect(page.locator('.region-row')).toHaveCount(19)
    await expect(page.locator('.hotspot')).toHaveCount(32)
    expect(appErrors(errors)).toEqual([])
  })
})

test.describe('plano antigo', () => {
  test('ganha as regiões novas sem quantidade e sem marcar alteração', async ({ page }) => {
    const { errors } = await openWithPlan(page, [
      { region: 'testa', treatment: 'botox', x: 0.44, y: 0.23, amount: 4 },
      { region: 'testa', treatment: 'botox', x: 0.56, y: 0.23, amount: 3 },
    ])
    await expect(page.locator('.hotspot')).toHaveCount(33)
    await expect(page.locator('.region-row')).toHaveCount(19)
    await expect(regionRow(page, 'Testa').locator('b')).toHaveText('7 U')
    for (const region of REGIONS.filter((r) => r.key !== 'testa')) {
      await expect.soft(regionRow(page, region.label).locator('b'), region.label).toHaveText('—')
    }
    await expect(summary(page, 'Total de unidades')).toHaveText('7 un')
    await expect(summary(page, 'Número de áreas')).toHaveText('1')
    await expect(unsavedNote(page)).toHaveCount(0)

    await openRegion(page, 'Testa')
    await expect(page.locator('.prow')).toHaveCount(2)
    await expect(amountInput(page, 0)).toHaveValue('4')
    await expect(page.locator('.pname')).toHaveCount(0)
    await backToOverview(page).click()
    await openRegion(page, 'Boca (lábios)')
    await expect(page.locator('.pname')).toHaveCount(8)
    await expect(unsavedNote(page)).toHaveCount(0)
    expect(appErrors(errors)).toEqual([])
  })
})

for (const { width, height } of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`layout em ${width}x${height}`, () => {
    test.use({ viewport: { width, height } })

    test('hotspots afastados, dentro do palco, clicáveis e sem rolagem horizontal', async ({ page }) => {
      const { errors } = await openWithPhoto(page)
      await page.screenshot({ path: shot(`hotspots-vazio-${width}x${height}.png`), fullPage: true })
      const stage = await stageRect(page)
      const spots = await rectsOf(page, '.hotspot')
      expect(spots).toHaveLength(33)

      let closest = { distance: Infinity }
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const distance = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y)
          if (distance < closest.distance) closest = { distance, a: spots[i].name, b: spots[j].name }
        }
      }
      measure(`${width}x${height}: palco`, stage.right - stage.left, 'x', stage.bottom - stage.top, 'menor distância', closest)
      expect(closest.distance, `${closest.a} e ${closest.b}`).toBeGreaterThanOrEqual(26)
      expect(outside(spots, stage)).toEqual([])

      const overflow = await horizontalOverflow(page)
      expect.soft(overflow.scroll, overflow.offenders).toBeLessThanOrEqual(overflow.viewport)

      const hotspots = page.locator('.hotspot')
      for (let i = 0; i < 33; i++) await hotspots.nth(i).click({ trial: true, timeout: 3000 })
      expect(appErrors(errors)).toEqual([])
    })

    test('com todas as regiões preenchidas, os rótulos fixos não se sobrepõem', async ({ page }) => {
      const { errors } = await openWithPlan(page, everyRegionFilled())
      await expect(page.locator('.hotspot')).toHaveCount(33)
      await expect(page.locator('.hotspot.filled')).toHaveCount(33)
      await expect(page.locator('.sim-layer')).toBeAttached()
      await page.screenshot({ path: shot(`rotulos-preenchido-${width}x${height}.png`), fullPage: true })
      await page.locator('.stage').screenshot({ path: shot(`rotulos-palco-${width}x${height}.png`) })

      const labels = await rectsOf(page, '.hotspot.show-label .hotspot-label')
      measure(`${width}x${height}: rótulos fixos`, labels.length, 'de 33:', labels.map((l) => l.name).join(' | '))
      expect(labels.length, 'pelo menos um rótulo fixo aparece').toBeGreaterThan(0)
      const collisions = []
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const [a, b] = [labels[i], labels[j]]
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) collisions.push(`${a.name} x ${b.name}`)
        }
      }
      expect(collisions).toEqual([])
      expect(appErrors(errors)).toEqual([])
    })

    test('com todas as regiões preenchidas, nenhum rótulo fixo é cortado pela borda do palco', async ({ page }) => {
      const { errors } = await openWithPlan(page, everyRegionFilled())
      await expect(page.locator('.hotspot.filled')).toHaveCount(33)
      const labels = await rectsOf(page, '.hotspot.show-label .hotspot-label')
      expect(outside(labels, await stageRect(page))).toEqual([])
      expect(appErrors(errors)).toEqual([])
    })

    test('com todas as regiões preenchidas, rótulo fixo e hotspot de outra região não se cobrem', async ({ page }) => {
      const { errors } = await openWithPlan(page, everyRegionFilled())
      await expect(page.locator('.hotspot.filled')).toHaveCount(33)
      const spots = await rectsOf(page, '.hotspot')
      const labels = await rectsOf(page, '.hotspot.show-label .hotspot-label')
      const covered = labels.flatMap((label) =>
        spots
          .filter((spot) => label.left < spot.x && spot.x < label.right && label.top < spot.y && spot.y < label.bottom)
          .map((spot) => `${label.name} x ${spot.name.split(':')[0]}`),
      )
      measure(`${width}x${height}: rótulo e hotspot sobrepostos`, covered.length, covered.join(' | '))
      expect(covered).toEqual([])
      expect(appErrors(errors)).toEqual([])
    })

    test('plano típico: toda região preenchida tem rótulo legível, sem cobrir outra preenchida', async ({ page }) => {
      const { errors } = await openWithPlan(page, planWithAmountsIn('boca', 'glabela', 'malar', 'nasolabial', 'mento'))
      await expect(page.locator('.hotspot.filled')).toHaveCount(7)
      if (width > 1000) await expect(page.locator('.hotspot.filled.show-label')).toHaveCount(7)

      const spots = await rectsOf(page, '.hotspot.filled')
      const labels = await rectsOf(page, '.hotspot.show-label .hotspot-label')
      expect(labels.length, 'pelo menos um rótulo fixo aparece').toBeGreaterThan(0)
      const covered = labels.flatMap((label) =>
        spots
          .filter((spot) => label.left < spot.x && spot.x < label.right && label.top < spot.y && spot.y < label.bottom)
          .map((spot) => `${label.name} x ${spot.name.split(':')[0]}`),
      )
      expect(covered).toEqual([])

      // Pintar por cima: posição certa não basta se o hotspot vazio ou o ponto ficarem na frente do texto.
      const zIndex = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).zIndex))
      const label = await zIndex(page.locator('.hotspot.show-label').first())
      expect(label, 'acima de hotspot sem rótulo').toBeGreaterThan(await zIndex(page.locator('.hotspot:not(.show-label)').first()))
      expect(label, 'acima dos pontos').toBeGreaterThan(await zIndex(page.locator('.dot').first()))
      await page.locator('.stage').screenshot({ path: shot(`rotulos-tipico-${width}x${height}.png`) })
      expect(appErrors(errors)).toEqual([])
    })

    test('região ampliada não cria rolagem horizontal e mantém os controles na tela', async ({ page }) => {
      const { errors } = await openWithPhoto(page)
      await openRegion(page, 'Periorbital (pés de galinha)')
      await page.screenshot({ path: shot(`zoom-periorbital-${width}x${height}.png`), fullPage: true })
      const overflow = await horizontalOverflow(page)
      expect.soft(overflow.scroll, overflow.offenders).toBeLessThanOrEqual(overflow.viewport)
      for (const name of ['Todas as regiões', 'Lado direito', 'Lado esquerdo', 'Adicionar ponto']) {
        await expect.soft(page.getByRole('button', { name })).toBeInViewport({ ratio: 1 })
      }
      expect(appErrors(errors)).toEqual([])
    })
  })
}

test.describe('marcar como aplicado', () => {
  test('baixa o lote, trava o plano e "Novo plano a partir deste" destrava', async ({ page }) => {
    const { errors, api, patient } = await prepare(page)
    const product = await api.post('/inventory/products', { brand: 'Marca E2E', name: 'Ácido hialurônico', kind: 'preenchedor', unit: 'ml' })
    const lot = await api.post('/inventory/lots', { product_id: product.id, number: 'L-E2E', expires_on: '2099-12-31', quantity: 10 })
    await page.goto(planningUrl(patient))
    await page.locator('input[type=file]').setInputFiles(await syntheticPhoto(page))
    await expect(page.locator('.hotspot')).toHaveCount(33)

    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await page.getByLabel('Lote (opcional)').selectOption(String(lot.id))
    await saveButton(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plano salvo' })).toBeVisible()

    await page.getByRole('button', { name: 'Marcar como aplicado' }).click()
    const dialog = page.getByRole('dialog', { name: 'Marcar como aplicado' })
    await dialog.getByRole('button', { name: 'Marcar como aplicado' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.alert.ok')).toContainText('Aplicado em')
    await expect(page.getByRole('status').filter({ hasText: 'Aplicado. 1 baixa(s) no estoque' })).toBeVisible()

    const lots = await api.get('/inventory/lots?available=true')
    expect(lots.find((l) => l.id === lot.id).balance).toBeCloseTo(9.8)
    await expect(saveButton(page)).toBeDisabled()

    await page.getByRole('button', { name: 'Novo plano a partir deste' }).click()
    await expect(saveButton(page)).toBeEnabled()
    await expect(unsavedNote(page)).toBeVisible()
    await saveButton(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plano salvo' })).toBeVisible()

    const plans = await api.get(`/patients/${patient.id}/plans`)
    expect(plans).toHaveLength(2)
    expect(plans[0].applied_at).toBeNull()
    const copy = await api.get(`/plans/${plans[0].id}`)
    expect(copy.points.every((p) => p.lot_id === null)).toBeTruthy()
    expect(appErrors(errors)).toEqual([])
  })

  test('plano aplicado não deixa editar os pontos na tela', async ({ page }) => {
    const { errors } = await openWithPlan(page, everyRegionFilled(), { apply: true })
    await expect(page.locator('.alert.ok')).toContainText('Plano travado')
    await expect(saveButton(page)).toBeDisabled()
    await openRegion(page, 'Testa')
    await expect.soft(plus(page, 0), 'botão de aumentar num plano travado').toBeDisabled()
    await expect.soft(amountInput(page, 0), 'campo de quantidade num plano travado').toBeDisabled()
    await expect.soft(page.getByRole('button', { name: 'Remover ponto 1' }), 'remover ponto num plano travado').toBeDisabled()
    await expect.soft(page.getByRole('button', { name: 'Adicionar ponto' }), 'adicionar ponto num plano travado').toBeDisabled()
    await expect.soft(page.getByRole('button', { name: 'Trocar foto' }), 'trocar foto num plano travado').toBeDisabled()
    const point = page.locator('.pt').first()
    const before = await fractionOf(point)
    await dragBy(page, point, 25, 25)
    expect.soft(await fractionOf(point), 'arrastar ponto num plano travado').toEqual(before)
    expect(appErrors(errors)).toEqual([])
  })
})

test.describe('lote novo pelo planejamento', () => {
  const chosenLot = (page) => page.getByLabel('Lote (opcional)').locator('option:checked')
  const newLotDialog = (page) => page.getByRole('dialog', { name: 'Novo lote' })

  test('toxina sem estoque: produto e lote criados aqui, salvos no plano, baixados ao aplicar e rastreados', async ({ page }) => {
    const { errors, patient } = await openWithPhoto(page)
    await treatmentButton(page, 'Botox').click()
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await page.getByRole('button', { name: 'Novo lote' }).click()

    const dialog = newLotDialog(page)
    await expect(dialog.getByLabel('Produto')).toHaveValue('novo')
    await expect(dialog.getByLabel('Tipo').locator('option')).toHaveText(['Toxina'])
    await dialog.getByLabel('Marca', { exact: true }).fill('Marca E2E')
    await dialog.getByLabel('Nome').fill('Toxina botulínica')
    await dialog.getByLabel('Número do lote').fill('BTX-01')
    await dialog.getByLabel('Validade').fill('2099-06-30')
    await dialog.getByLabel('Quantidade (U)').fill('50')
    await dialog.getByRole('button', { name: 'Salvar lote' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(chosenLot(page)).toHaveText('Marca E2E Toxina botulínica · lote BTX-01 · val. 30/06/2099 · 50 U')
    await expect(unsavedNote(page)).toBeVisible()

    await saveButton(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Plano salvo' })).toBeVisible()
    await page.reload()
    await expect(page.locator('.hotspot')).toHaveCount(33)
    await openRegion(page, 'Testa')
    await expect(chosenLot(page)).toContainText('lote BTX-01')

    await page.getByRole('button', { name: 'Marcar como aplicado' }).click()
    const confirm = page.getByRole('dialog', { name: 'Marcar como aplicado' })
    await confirm.getByRole('button', { name: 'Marcar como aplicado' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Aplicado. 1 baixa(s) no estoque' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Novo lote' })).toHaveCount(0)

    await page.goto(`/pacientes/${patient.id}/prontuario`)
    await expect(page.locator('tr').filter({ hasText: 'BTX-01' })).toContainText('val. 30/06/2099')
    await page.goto('/estoque')
    await expect(page.locator('tr').filter({ hasText: 'BTX-01' })).toContainText('48 U') // 50 U menos a dose de 2 U do ponto
    expect(appErrors(errors)).toEqual([])
  })

  test('ml com produto do estoque: recusa validade vencida e número repetido, e cria o lote nesse produto', async ({ page }) => {
    const { errors, api } = await openWithPhoto(page)
    const product = await api.post('/inventory/products', { brand: 'Marca ML', name: 'Ácido hialurônico', kind: 'preenchedor', unit: 'ml' })
    await api.post('/inventory/products', { brand: 'Marca U', name: 'Toxina', kind: 'toxina', unit: 'U' })
    await api.post('/inventory/lots', { product_id: product.id, number: 'AH-01', expires_on: '2099-12-31', quantity: 1 })
    await openRegion(page, 'Testa')
    await plus(page, 0).click()
    await page.getByRole('button', { name: 'Novo lote' }).click()

    const dialog = newLotDialog(page)
    await expect(dialog.getByLabel('Produto').locator('option')).toHaveText(['Marca ML Ácido hialurônico', 'Novo produto'])
    await expect(dialog.getByLabel('Produto')).toHaveValue(String(product.id))
    await expect(dialog.getByLabel('Marca', { exact: true })).toHaveCount(0)
    await dialog.getByLabel('Número do lote').fill('AH-01')
    await dialog.getByLabel('Validade').fill('2020-01-01')
    await dialog.getByLabel('Quantidade (ml)').fill('2,5')
    const saveLot = dialog.getByRole('button', { name: 'Salvar lote' })
    await saveLot.click()
    await expect(dialog.getByRole('alert')).toContainText('Validade 01/01/2020 já passou')
    await dialog.getByLabel('Validade').fill('2099-12-31')
    await saveLot.click()
    await expect(dialog.getByRole('alert')).toContainText('Já existe um lote com esse número')
    await dialog.getByLabel('Número do lote').fill('AH-02')
    await saveLot.click()
    await expect(dialog).toHaveCount(0)
    await expect(chosenLot(page)).toHaveText('Marca ML Ácido hialurônico · lote AH-02 · val. 31/12/2099 · 2.5 ml')
    await expect(unsavedNote(page)).toBeVisible()

    expect(await api.get('/inventory/products')).toHaveLength(2)
    const lots = await api.get('/inventory/lots')
    expect(lots).toHaveLength(2)
    expect(lots.find((l) => l.number === 'AH-02')).toMatchObject({ product_id: product.id, balance: 2.5 })
    expect(appErrors(errors).filter((line) => !line.includes('status of 409'))).toEqual([])
  })
})

test.describe('detecção real', () => {
  test('ajusta os pontos ao rosto e calcula a simetria', async ({ page }) => {
    test.setTimeout(180_000)
    const errors = collectPageErrors(page)
    const api = await signIn(page)
    const patient = await createPatient(api)
    await page.goto(planningUrl(patient))
    const portrait = await samplePortrait(page)
    test.skip(!portrait, 'sem rede para baixar o retrato de exemplo')

    await page.locator('input[type=file]').setInputFiles(portrait)
    await expect(page.locator('.note').filter({ hasText: 'Pontos ajustados ao rosto' })).toBeVisible({ timeout: 120_000 })
    await expect(page.locator('.hotspot')).toHaveCount(33)
    await expect(page.locator('.region-row')).toHaveCount(19)
    expect(outside(await rectsOf(page, '.hotspot'), await stageRect(page))).toEqual([])

    await page.getByRole('button', { name: 'Simetria' }).click()
    await expect(page.locator('.symmetry-score')).toContainText('/100', { timeout: 30_000 })
    await expect(page.locator('.symmetry-table tbody tr').first()).toBeVisible()
    await page.screenshot({ path: shot('deteccao-real.png'), fullPage: true })
    await page.locator('.stage').screenshot({ path: shot('deteccao-real-palco.png') })

    await openRegion(page, 'Boca (lábios)')
    await expect(page.locator('.pt')).toHaveCount(8)
    await page.locator('.stage').screenshot({ path: shot('deteccao-real-boca.png') })
    expect(outside(await rectsOf(page, '.pt'), await stageRect(page))).toEqual([])

    // Antes e depois na foto real: dá para comparar a olho o tamanho do efeito da dose inicial.
    const [upper, lower] = [await fractionOf(page.locator('.pt').nth(6)), await fractionOf(page.locator('.pt').nth(7))]
    await plus(page, 6).click()
    await plus(page, 7).click()
    await expect.poll(() => simDiff(page, upper), 'lábio superior').toBeGreaterThan(JPEG_NOISE)
    await expect.poll(() => simDiff(page, lower), 'lábio inferior').toBeGreaterThan(JPEG_NOISE)
    measure('retrato, 0,2 ml nos lábios: superior', (await simDiff(page, upper)).toFixed(2), 'inferior', (await simDiff(page, lower)).toFixed(2))
    await page.getByRole('button', { name: 'Ocultar pontos' }).click()
    await page.locator('.stage').screenshot({ path: shot('deteccao-real-labios-depois.png') })
    await page.getByLabel('Comparar antes e depois').fill('0')
    await expect(page.locator('.sim-layer')).toHaveCSS('clip-path', 'inset(0px 0px 0px 100%)')
    await page.locator('.stage').screenshot({ path: shot('deteccao-real-labios-antes.png') })
    expect(errors).toEqual([])
  })
})
