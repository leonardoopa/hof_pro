const TOKEN_KEY = 'hofpro.token'

let token = null
try {
  token = localStorage.getItem(TOKEN_KEY)
} catch {
  /* storage indisponível: sessão só em memória */
}

let onUnauthorized = () => {}

export function setToken(value) {
  token = value
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export const getToken = () => token
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn)

export class ApiError extends Error {
  constructor(status, messages) {
    super(messages[0] ?? 'Erro inesperado.')
    this.status = status
    this.messages = messages
  }
}

function readDetail(detail) {
  if (typeof detail === 'string') return [detail]
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === 'string' ? d : `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`))
  }
  return []
}

async function request(path, { method = 'GET', json, form, auth = true } = {}) {
  const headers = {}
  if (auth && token) headers.Authorization = `Bearer ${token}`
  let body
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  } else if (form) {
    body = form
  }

  let res
  try {
    res = await fetch(`/api${path}`, { method, headers, body })
  } catch {
    throw new ApiError(0, ['Sem conexão com o servidor.'])
  }

  if (res.status === 401 && auth) onUnauthorized()
  if (!res.ok) {
    let detail = []
    try {
      detail = readDetail((await res.json()).detail)
    } catch {
      /* corpo vazio */
    }
    throw new ApiError(res.status, detail.length ? detail : [`Erro ${res.status}.`])
  }
  if (res.status === 204) return null
  return res
}

const data = async (path, opts) => (await request(path, opts)).json()

export const api = {
  login: (body) => data('/auth/login', { method: 'POST', json: body, auth: false }),
  register: (body) => data('/auth/register', { method: 'POST', json: body, auth: false }),
  me: () => data('/auth/me'),

  patients: {
    list: (q = '') => data(`/patients?q=${encodeURIComponent(q)}`),
    get: (id) => data(`/patients/${id}`),
    create: (body) => data('/patients', { method: 'POST', json: body }),
    update: (id, body) => data(`/patients/${id}`, { method: 'PATCH', json: body }),
    remove: (id) => request(`/patients/${id}`, { method: 'DELETE' }),
  },

  photos: {
    list: (patientId) => data(`/patients/${patientId}/photos`),
    upload: (patientId, file, kind = 'frontal') => {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      return data(`/patients/${patientId}/photos`, { method: 'POST', form })
    },
    // <img> não envia o header Authorization, então baixamos como blob.
    async objectUrl(photoId) {
      const res = await request(`/photos/${photoId}/file`)
      return URL.createObjectURL(await res.blob())
    },
  },

  anamnesis: {
    questions: () => data('/anamnesis/questions'),
    get: (patientId) => data(`/patients/${patientId}/anamnesis`),
    save: (patientId, body) => data(`/patients/${patientId}/anamnesis`, { method: 'PUT', json: body }),
  },

  plans: {
    list: (patientId) => data(`/patients/${patientId}/plans`),
    get: (id) => data(`/plans/${id}`),
    create: (patientId, body) => data(`/patients/${patientId}/plans`, { method: 'POST', json: body }),
    update: (id, body) => data(`/plans/${id}`, { method: 'PUT', json: body }),
  },
}
