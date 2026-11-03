import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import AppLayout from './components/AppLayout'
import AnamnesisStep from './pages/AnamnesisStep'
import AuthPage from './pages/AuthPage'
import ConsentStep from './pages/ConsentStep'
import InventoryPage from './pages/InventoryPage'
import ComingSoon from './pages/ComingSoon'
import EvolutionPage from './evolution/EvolutionPage'
import GuidancePage from './guidance/GuidancePage'
import PatientsPage from './pages/PatientsPage'
import PatientWorkspace from './pages/PatientWorkspace'
import PlanningStep from './pages/PlanningStep'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">Carregando…</div>
  return user ? children : <Navigate to="/entrar" replace />
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">Carregando…</div>
  return user ? <Navigate to="/pacientes" replace /> : children
}

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
      <Route path="/cadastro" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />

      <Route element={<Protected><AppLayout /></Protected>}>
        <Route path="/pacientes" element={<PatientsPage />} />
        <Route path="/pacientes/:patientId" element={<PatientWorkspace />}>
          <Route index element={<Navigate to="anamnese" replace />} />
          <Route path="anamnese" element={<AnamnesisStep />} />
          <Route path="planejamento" element={<PlanningStep />} />
          <Route path="evolucao" element={<EvolutionPage />} />
          <Route path="prontuario" element={<ConsentStep />} />
          <Route path="resumo" element={<GuidancePage />} />
        </Route>
        <Route path="/estoque" element={<InventoryPage />} />
        <Route
          path="/financeiro"
          element={<ComingSoon title="Financeiro" text="Orçamentos e recebimentos ligados ao plano de cada paciente." />}
        />
      </Route>

      <Route path="*" element={<Navigate to="/pacientes" replace />} />
    </Routes>
  )
}
