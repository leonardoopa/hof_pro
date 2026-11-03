import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/tokens.css'
import './styles/base.css'
import './styles/planning.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { initTheme } from './theme'
import './styles/point-detail.css'
import './styles/inventory.css'
import './styles/consent.css'

initTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
