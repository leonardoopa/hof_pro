// Guia de pose padronizada sobre a câmera: oval do rosto, linha dos olhos e eixo central.
// Mesma posição em toda sessão = fotos "antes/depois" comparáveis.
export default function PoseGuide() {
  return (
    <svg className="pose-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <ellipse cx="50" cy="48" rx="21" ry="30" />
      <line x1="29" y1="42" x2="71" y2="42" />
      <line x1="50" y1="14" x2="50" y2="86" />
      <line x1="40" y1="62" x2="60" y2="62" />
    </svg>
  )
}
