// Preparação dos testes pela API, para cada teste começar direto na tela que ele exercita.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect } from '@playwright/test'

let counter = 0
const unique = () => `${Date.now()}-${++counter}`

/** Cria um profissional novo e deixa o navegador autenticado. Devolve um cliente da API com o mesmo token. */
export async function signIn(page) {
  const email = `e2e-${unique()}@example.com`
  const password = 'senha-de-teste-123'
  const res = await page.request.post('/api/auth/register', { data: { full_name: 'Profissional E2E', email, password } })
  expect(res.ok(), await res.text()).toBeTruthy()
  const { access_token: token } = await res.json()
  await page.addInitScript((value) => localStorage.setItem('hofpro.token', value), token)

  const headers = { Authorization: `Bearer ${token}` }
  const call = async (method, path, options = {}) => {
    const response = await page.request[method](`/api${path}`, { headers, ...options })
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy()
    return response.status() === 204 ? null : response.json()
  }
  return {
    email,
    password,
    get: (path) => call('get', path),
    post: (path, data) => call('post', path, { data }),
    put: (path, data) => call('put', path, { data }),
    upload: (path, file, kind = 'frontal') => call('post', path, { multipart: { file, kind } }),
  }
}

/** Paciente com a anamnese ainda em branco. */
export const createPatient = (api, full_name = 'Paciente E2E') => api.post('/patients', { full_name })

/** Sem o runtime e o modelo do MediaPipe, a tela cai no modelo padrão de pontos: caminho determinístico e sem rede. */
export const blockFaceDetection = (page) =>
  page.route(/cdn\.jsdelivr\.net\/npm\/@mediapipe|storage\.googleapis\.com\/mediapipe-models/, (route) => route.abort())

/** Coleta erros de console e exceções da página. Use com expect(errors).toEqual([]) no fim do teste. */
export function collectPageErrors(page) {
  const errors = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    // O runtime do MediaPipe escreve os próprios logs de nível INFO no console.error.
    if (msg.type() === 'error' && !msg.text().startsWith('INFO: ')) errors.push(`console: ${msg.text()}`)
  })
  return errors
}

/** Imagem sem rosto, gerada no navegador: gradiente e manchas, para a simulação ter textura onde agir. */
export async function syntheticPhoto(page, { width = 800, height = 1000 } = {}) {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const gradient = ctx.createLinearGradient(0, 0, w, h)
      gradient.addColorStop(0, '#e8c9b0')
      gradient.addColorStop(1, '#b98a6f')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(${(i * 37) % 255}, ${(i * 17) % 255}, ${(i * 91) % 255}, 0.18)`
        ctx.beginPath()
        ctx.arc((i * 131) % w, (i * 197) % h, 6 + (i % 14), 0, Math.PI * 2)
        ctx.fill()
      }
      return canvas.toDataURL('image/jpeg', 0.92)
    },
    [width, height],
  )
  return { name: 'sintetica.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
}

const PORTRAIT_URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg'
const PORTRAIT_PATH = join(import.meta.dirname, '.cache', 'portrait.jpg')
const HEAD_CROP = { x: 190, y: 0, width: 420, height: 525 } // o original é de meio corpo; a foto clínica enquadra cabeça e pescoço

/**
 * Retrato de exemplo do próprio MediaPipe, recortado na cabeça, para o teste com detecção real. Baixado sob demanda
 * para uma pasta ignorada pelo git: nenhuma foto de pessoa entra no repositório. Devolve null sem rede (o teste deve pular).
 */
export async function samplePortrait(page) {
  if (!existsSync(PORTRAIT_PATH)) {
    try {
      const res = await fetch(PORTRAIT_URL)
      if (!res.ok) return null
      mkdirSync(dirname(PORTRAIT_PATH), { recursive: true })
      writeFileSync(PORTRAIT_PATH, Buffer.from(await res.arrayBuffer()))
    } catch {
      return null
    }
  }
  const source = `data:image/jpeg;base64,${readFileSync(PORTRAIT_PATH).toString('base64')}`
  const dataUrl = await page.evaluate(
    async ([src, { x, y, width, height }]) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, x, y, width, height, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', 0.95)
    },
    [source, HEAD_CROP],
  )
  return { name: 'retrato.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
}
