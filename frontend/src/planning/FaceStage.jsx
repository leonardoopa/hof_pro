import { useRef } from 'react'
import { REGIONS, SIDE_LABEL, describeTotals, regionLabel, totalsOf, treatmentOf, formatAmount } from './regions'

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
  adding,
  simUrl,
  split,
  onPickRegion,
  onHoverRegion,
  onSelectPoint,
  onMovePoint,
  onAddPoint,
}) {
  const innerRef = useRef(null)
  const dragging = useRef(null)
  const { s, tx, ty } = viewFor(points, zone)

  const toNormalized = (e) => {
    const rect = innerRef.current.getBoundingClientRect() // já inclui o zoom aplicado via transform
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  const zonePoints = zone ? points.filter((p) => inZone(p, zone)) : []

  return (
    <div
      className={`stage ${adding ? 'adding' : ''}`}
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
            style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          />
        )}

        {!zone &&
          points
            .filter((p) => p.amount > 0)
            .map((p) => (
              <i
                key={p.uid}
                className="dot"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--c': treatmentOf(p.treatment).color }}
              />
            ))}

        {!zone &&
          REGIONS.flatMap(({ key, label }) =>
            ['D', 'E', 'C']
              .map((side) => ({ key, label, side, pts: points.filter((p) => p.region === key && p.side === side) }))
              .filter((g) => g.pts.length),
          ).map(({ key, label, side, pts }) => {
            const c = centroid(pts)
            const total = totalsOf(pts)
            const name = side === 'C' ? label : `${label} (${SIDE_LABEL[side].toLowerCase()})`
            return (
              <button
                key={`${key}-${side}`}
                type="button"
                className={`hotspot ${hoverRegion === key ? 'hover' : ''} ${total.areas ? 'filled' : ''}`}
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                onClick={() => onPickRegion(key, side)}
                onMouseEnter={() => onHoverRegion(key)}
                onMouseLeave={() => onHoverRegion(null)}
                aria-label={`${name}: ${describeTotals(total)}. Abrir região`}
              >
                <span className="hotspot-label">
                  {name}
                  {total.areas > 0 && <b>{describeTotals(total)}</b>}
                </span>
              </button>
            )
          })}

        {zone &&
          points
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
            aria-label={`${regionLabel(p.region)} ponto ${index + 1}: ${formatAmount(p.amount)} ${treatmentOf(p.treatment).unit}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              dragging.current = p.uid
              onSelectPoint(p.uid)
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
