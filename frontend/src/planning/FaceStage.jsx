import { useEffect, useMemo, useRef, useState } from 'react'
import { fitLabels, spreadHotspots } from './layout'
import { REGIONS, SIDE_LABEL, describeTotals, pointLabel, regionLabel, totalsOf, treatmentOf, formatAmount } from './regions'

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

const inZone = (p, zone) => p.region === zone.region && p.side === zone.side

/** Janela (zoom + deslocamento, em frações da foto) que enquadra os pontos de uma zona (região + lado). */
function viewFor(points, zone) {
  if (!zone) return { s: 1, tx: 0, ty: 0 }
  const pts = points.filter((p) => inZone(p, zone))
  if (!pts.length) return { s: 1, tx: 0, ty: 0 }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const w = Math.max(x1 - x0 + 0.14, 0.4)
  const h = Math.max(y1 - y0 + 0.14, 0.4)
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

export default function FaceStage({
  imageUrl,
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
  onPickRegion,
  onHoverRegion,
  onSelectPoint,
  onMovePoint,
  onAddPoint,
}) {
  const innerRef = useRef(null)
  const dragging = useRef(null)
  // O enquadramento só muda ao trocar de região ou de número de pontos: recalcular a cada arraste tiraria o ponto de baixo do cursor.
  const zoneCount = zone ? points.filter((p) => inZone(p, zone)).length : 0
  const { s, tx, ty } = useMemo(() => viewFor(points, zone), [zone?.region, zone?.side, zoneCount])

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

  // Pontos desenhados sobre a foto. Ocultos, sobra só a foto (ou a simulação); o zoom continua seguindo os pontos.
  const marks = showMarks ? points : []
  const zonePoints = zone ? marks.filter((p) => inZone(p, zone)) : []

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
      className={`stage ${adding ? 'adding' : ''} ${readOnly ? 'read-only' : ''}`}
      style={{ '--aspect': aspect }}
      onClick={(e) => {
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
        <img src={imageUrl} alt="Foto frontal do paciente" draggable={false} />
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
