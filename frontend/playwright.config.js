import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Portas próprias da suíte; troque por E2E_BACKEND_PORT / E2E_FRONTEND_PORT se outro serviço já usa estas.
const BACKEND_PORT = process.env.E2E_BACKEND_PORT ?? '8001'
const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT ?? '5174'
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`
const FRONTEND = `http://localhost:${FRONTEND_PORT}`

// Banco e fotos descartáveis, fora do repositório. Os processos filhos herdam o mesmo diretório.
process.env.E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'hofpro-e2e-'))

// O README cria a venv na raiz; ela também pode estar em backend/.venv.
const backendDir = resolve(import.meta.dirname, '../backend')
const python =
  process.env.E2E_PYTHON ??
  ['../.venv/bin/python', '.venv/bin/python'].find((path) => existsSync(resolve(backendDir, path))) ??
  'python3'

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.E2E_OUTPUT_DIR ?? 'test-results',
  timeout: 60_000,
  workers: 1, // SQLite: um escritor por vez
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: FRONTEND,
    locale: 'pt-BR',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // reuseExistingServer: false faz a suíte falhar se a porta estiver ocupada, em vez de usar um servidor de desenvolvimento.
  webServer: [
    {
      command: `${python} manage.py migrate --noinput && ${python} -m uvicorn config.asgi:application --port ${BACKEND_PORT}`,
      cwd: backendDir,
      env: { DJANGO_SETTINGS_MODULE: 'config.settings_e2e', E2E_DATA_DIR: process.env.E2E_DATA_DIR },
      url: `${BACKEND}/docs`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      env: { API_PROXY_TARGET: BACKEND },
      url: FRONTEND,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
