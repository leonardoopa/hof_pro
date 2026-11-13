import { useEffect, useMemo, useRef, useState } from 'react'
import { fitLabels, spreadHotspots } from './layout'
import { REGIONS, SIDE_LABEL, describeTotals, pointLabel, regionLabel, totalsOf, treatmentOf, formatAmount } from './regions'

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

const inZone = (p, zone) => p.region === zone.region && p.side === zone.side

/**
 * Janela (zoom + deslocamento, em frações da foto) que enquadra uma zona (região + lado). Entram os pontos colocados e a
 * posição sugerida da região: a região vazia também amplia, e o enquadramento não pula quando o primeiro ponto entra.
 * A folga deixa espaço para os controles que ficam sobre a imagem.
 */
function viewFor(points, zone, template) {
  if (!zone) return { s: 1, tx: 0, ty: 0 }
  const pts = [...points, ...template].filter((p) => inZone(p, zone))
  if (!pts.length) return { s: 1, tx: 0, ty: 0 }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const w = Math.max(x1 - x0 + 0.2, 0.42)
  const h = Math.max(y1 - y0 + 0.2, 0.42)
  const s = clamp(Math.min(1 / w, 1 / h), 1, 3.2)
  return {
    s,
    tx: clamp(0.5 - ((x0 + x1) / 2) * s, 1 - s, 0),
    ty: clamp(0.5 - ((y0 + y1) / 2) * s, 1 - s, 0),
  }
}

const centroid = (pts) => ({
  x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
  y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
})

/** Centro de cada região (e lado) na imagem atual, a partir das posições sugeridas. */
function regionAnchors(template) {
  const groups = new Map()
  for (const p of template) {
    const key = `${p.region}|${p.side}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.values()].map((pts) => {
    const region = REGIONS.find((r) => r.key === pts[0].region)
    const short = region?.short ?? region?.label ?? pts[0].region
    return { region: pts[0].region, side: pts[0].side, name: pts[0].side === 'C' ? short : `${short} ${pts[0].side}`, ...centroid(pts) }
  })
}

export default function FaceStage({
  imageUrl,
  alt = 'Foto frontal do paciente',
  aspect,
  points,
  zone,
  selectedId,
  hoverRegion,
  suggested = [],
  adding,
  readOnly = false,
  simUrl,
  split,
  showMarks = true,
  template = [],
  onPickRegion,
  onHoverRegion,
  onSelectPoint,
  onMovePoint,
  onAddPoint,
  onIdleTap,
}) {
  const innerRef = useRef(null)
  const dragging = useRef(null)
  // O enquadramento só muda ao trocar de região ou de número de pontos: recalcular a cada arraste tiraria o ponto de baixo do cursor.
  const zoneCount = zone ? points.filter((p) => inZone(p, zone)).length : 0
  const { s, tx, ty } = useMemo(() => viewFor(points, zone, template), [zone?.region, zone?.side, zoneCount, template])

  // Tamanho do palco em px: o layout dos hotspots mede distâncias na tela, não na foto.
  const stageRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [])

  const toNormalized = (e) => {
    const rect = innerRef.current.getBoundingClientRect() // já inclui o zoom aplicado via transform
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  // Visão geral: tocar no rosto abre a região mais próxima do toque, mesmo sem nenhum ponto colocado.
  const anchors = useMemo(() => regionAnchors(template), [template])
  const picking = !zone && showMarks && anchors.length > 0 && Boolean(onPickRegion)
  const [aim, setAim] = useState(null) // região sob o cursor
  const nearest = (e) => {
    const { x, y } = toNormalized(e)
    const reach = Math.max(44, size.width * 0.13)
    let best = null
    for (const a of anchors) {
      const d = Math.hypot((a.x - x) * size.width, (a.y - y) * size.height)
      if (d <= reach && d < (best?.d ?? Infinity)) best = { ...a, d }
    }
    return best
  }

  // Pontos desenhados sobre a foto. Ocultos, sobra só a foto (ou a simulação); o zoom continua seguindo os pontos.
  const marks = showMarks ? points : []
  const zonePoints = zone ? marks.filter((p) => inZone(p, zone)) : []
  // Região aberta: as posições sugeridas que ainda não viraram ponto aparecem como alvos; tocar num deles coloca o ponto nomeado ali.
  const ghosts =
    zone && showMarks && !readOnly
      ? template.filter((t) => inZone(t, zone) && !zonePoints.some((p) => p.point_key === t.point_key))
      : []

  // Visão geral: um hotspot por região e lado, afastados para não se sobreporem; rótulo fixo só onde cabe.
  const groups = zone
    ? []
    : REGIONS.flatMap((region) =>
        ['D', 'E', 'C']
          .map((side) => ({ region, side, pts: marks.filter((p) => p.region === region.key && p.side === side) }))
          .filter((g) => g.pts.length),
      ).map((g) => {
        const short = g.region.short ?? g.region.label
        // na foto: D/E, lado do paciente
        return { ...g, ...centroid(g.pts), total: totalsOf(g.pts), shortName: g.side === 'C' ? short : `${short} ${g.side}` }
      })
  const spots = spreadHotspots(groups, size)
  const labelPlace = fitLabels(
    groups.map((g, i) => ({
      ...spots[i],
      side: g.side,
      lines: g.total.areas ? [g.shortName, describeTotals(g.total)] : [g.shortName],
      want: g.total.areas > 0,
    })),
    size,
  )

  return (
    <div
      ref={stageRef}
      className={`stage ${adding ? 'adding' : ''} ${readOnly ? 'read-only' : ''} ${picking && aim ? 'aiming' : ''}`}
      style={{ '--aspect': aspect }}
      onPointerMove={(e) => {
        if (!picking || e.pointerType !== 'mouse') return
        const next = nearest(e)
        setAim((cur) => (cur?.region === next?.region && cur?.side === next?.side ? cur : next))
      }}
      onPointerLeave={() => setAim(null)}
      onClick={(e) => {
        if (picking) {
          if (e.target.closest('.hotspot')) return
          const target = nearest(e)
          setAim(null)
          if (target) onPickRegion(target.region, target.side)
          return
        }
        if (!adding || !zone || e.target.closest('.pt')) return
        const { x, y } = toNormalized(e)
        onAddPoint(x, y)
      }}
    >
      <div
        ref={innerRef}
        className="stage-inner"
        style={{ '--s': s, transform: `translate(${tx * 100}%, ${ty * 100}%) scale(${s})` }}
      >
        <img src={imageUrl} alt={alt} draggable={false} />
        {simUrl && (
          <img
            className="sim-layer"
            src={simUrl}
            alt="Simulação do resultado"
            draggable={false}
            style={{ clipPath: `inset(0 0 0 ${100 - split}%)` }}
          />
        )}
        {simUrl && split > 0 && split < 100 && <i className="sim-divider" style={{ left: `${100 - split}%` }} />}

        {!zone &&
          marks
            .filter((p) => p.amount > 0)
            .map((p) => (
              <i
                key={p.uid}
                className="dot"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--c': treatmentOf(p.treatment).color }}
              />
            ))}

        {picking && aim && (
          <span className="region-aim" style={{ left: `${aim.x * 100}%`, top: `${aim.y * 100}%` }} aria-hidden="true">
            <i />
            <b>{aim.name}</b>
          </span>
        )}

        {groups.map(({ region: { key, label }, side, total, shortName }, i) => {
          const name = side === 'C' ? label : `${label} (${SIDE_LABEL[side].toLowerCase()})`
          return (
            <button
              key={`${key}-${side}`}
              type="button"
              className={`hotspot side-${side} ${hoverRegion === key ? 'hover' : ''} ${total.areas ? 'filled' : ''} ${labelPlace[i] ? `show-label label-${labelPlace[i]}` : ''} ${suggested.includes(key) ? 'suggest' : ''}`}
              style={{ left: `${spots[i].x * 100}%`, top: `${spots[i].y * 100}%` }}
              onClick={() => onPickRegion(key, side)}
              onMouseEnter={() => onHoverRegion(key)}
              onMouseLeave={() => onHoverRegion(null)}
              aria-label={`${name}: ${describeTotals(total)}. Abrir região`}
            >
              <span className="hotspot-label">
                {shortName}
                {total.areas > 0 && <b>{describeTotals(total)}</b>}
              </span>
            </button>
          )
        })}

        {zone &&
          marks
            .filter((p) => !inZone(p, zone) && p.amount > 0)
            .map((p) => (
              <i
                key={p.uid}
                className="dot faded"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--c': treatmentOf(p.treatment).color }}
              />
            ))}

        {ghosts.map((g) => {
          const name = pointLabel(g.region, g.point_key)
          return (
            <button
              key={`ghost-${g.point_key}`}
              type="button"
              className="spot"
              style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%` }}
              aria-label={`${regionLabel(g.region)}, ${name || g.point_key}: marcar ponto sugerido`}
              onClick={(e) => {
                e.stopPropagation() // não cai no toque livre do palco
                // Sem tratamento escolhido nada é marcado: a dose inicial depende do produto.
                if (adding) onAddPoint(g.x, g.y, g.point_key)
                else onIdleTap?.()
              }}
            >
              {name && <span className="spot-name">{name}</span>}
            </button>
          )
        })}

        {zonePoints.map((p, index) => (
          <button
            key={p.uid}
            type="button"
            className={`pt ${p.amount > 0 ? 'on' : ''} ${selectedId === p.uid ? 'selected' : ''}`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--c': treatmentOf(p.treatment).color }}
            title={pointLabel(p.region, p.point_key) || undefined}
            aria-label={`${regionLabel(p.region)}, ${pointLabel(p.region, p.point_key) || `ponto ${index + 1}`}: ${formatAmount(p.amount)} ${treatmentOf(p.treatment).unit}`}
            onPointerDown={(e) => {
              onSelectPoint(p.uid)
              if (readOnly) return
              e.currentTarget.setPointerCapture(e.pointerId)
              dragging.current = p.uid
            }}
            onPointerMove={(e) => {
              if (dragging.current !== p.uid) return
              const { x, y } = toNormalized(e)
              onMovePoint(p.uid, x, y)
            }}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
          >
            <span className="pt-n">{index + 1}</span>
            {p.amount > 0 && <span className="pt-amount">{formatAmount(p.amount)}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
