import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { evidence, requirements, statusLabels, type MatchStatus, type Requirement } from './demo'
import './comparison.css'

export function CompareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="6" height="16" rx="1.5" />
      <rect x="16" y="4" width="6" height="16" rx="1.5" />
      <path d="M8 9h8m-3-3 3 3-3 3M16 15H8m3-3-3 3 3 3" />
    </svg>
  )
}

function Highlight({ text, emphasis }: { text: string; emphasis: string }) {
  const start = text.indexOf(emphasis)
  if (start < 0) return text
  return <>{text.slice(0, start)}<mark>{emphasis}</mark>{text.slice(start + emphasis.length)}</>
}

function Status({ status }: { status: MatchStatus }) {
  return <span className={`comparison-status is-${status}`}><span aria-hidden="true">{status === 'matched' ? '✓' : status === 'partial' ? '◐' : '−'}</span>{statusLabels[status]}</span>
}

function fragmentsFor(item: Requirement, approvedText?: string) {
  const fragments = evidence.filter((entry) => item.evidenceIds.includes(entry.id)).map((entry) => ({
    ...entry,
    text: approvedText && item.suggestion?.replaces === entry.id ? approvedText : entry.text,
    revised: Boolean(approvedText && item.suggestion?.replaces === entry.id),
  }))
  if (approvedText && item.suggestion && !item.suggestion.replaces) {
    fragments.push({ id: `added-${item.id}`, section: item.suggestion.section, text: approvedText, emphasis: '', revised: true })
  }
  return fragments
}

/** One continuous silhouette: no separate card corners at the document boundary. */
function MatchConnections() {
  const gradientId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [path, setPath] = useState('')

  useLayoutEffect(() => {
    const row = svgRef.current?.parentElement
    const source = row?.querySelector('.comparison-requirement')
    const group = row?.querySelector('.comparison-evidence-group')
    if (!row || !source || !group) return
    function measure() {
      const bounds = row!.getBoundingClientRect()
      const from = source!.getBoundingClientRect()
      const to = group!.getBoundingClientRect()
      if (to.left <= from.right) {
        setPath('')
        return
      }
      const left = from.left - bounds.left
      const right = to.right - bounds.left
      const x1 = from.right - bounds.left
      const x2 = to.left - bounds.left
      const top1 = from.top - bounds.top
      const bottom1 = from.bottom - bounds.top
      const top2 = to.top - bounds.top
      const bottom2 = to.bottom - bounds.top
      const middle = (x1 + x2) / 2
      const neckTop = Math.max(top1, top2)
      const neckBottom = neckTop + 10
      const sourceRadius = Math.min(20, from.height / 4)
      const targetRadius = Math.min(24, to.height / 4)
      const softness = .55
      // Generous cubic shoulders give the contour a soft, continuous silhouette.
      // The thin bridge remains on the upper edge, never centered in the text.
      setPath([
        `M${left + sourceRadius},${top1} H${x1 - 12}`,
        `C${x1 + 2},${top1} ${middle - 9},${neckTop} ${middle - 3},${neckTop}`,
        `H${middle + 3} C${middle + 9},${neckTop} ${x2 - 2},${top2} ${x2 + 12},${top2}`,
        `H${right - targetRadius} C${right - targetRadius * (1 - softness)},${top2} ${right},${top2 + targetRadius * (1 - softness)} ${right},${top2 + targetRadius}`,
        `V${bottom2 - targetRadius} C${right},${bottom2 - targetRadius * (1 - softness)} ${right - targetRadius * (1 - softness)},${bottom2} ${right - targetRadius},${bottom2}`,
        `H${x2 + 12} C${x2 - 2},${bottom2} ${middle + 9},${neckBottom} ${middle + 3},${neckBottom}`,
        `H${middle - 3} C${middle - 9},${neckBottom} ${x1 + 2},${bottom1} ${x1 - 12},${bottom1}`,
        `H${left + sourceRadius} C${left + sourceRadius * (1 - softness)},${bottom1} ${left},${bottom1 - sourceRadius * (1 - softness)} ${left},${bottom1 - sourceRadius}`,
        `V${top1 + sourceRadius} C${left},${top1 + sourceRadius * (1 - softness)} ${left + sourceRadius * (1 - softness)},${top1} ${left + sourceRadius},${top1} Z`,
      ].join(' '))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(source)
    observer.observe(group)
    return () => observer.disconnect()
  }, [])

  return <svg ref={svgRef} className="comparison-ribbons" aria-hidden="true">
    <defs><linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="65%">
      <stop offset="0%" stopColor="var(--match)" stopOpacity=".13" />
      <stop offset="34%" stopColor="var(--match)" stopOpacity=".07" />
      <stop offset="70%" stopColor="var(--match)" stopOpacity=".2" />
      <stop offset="100%" stopColor="var(--match)" stopOpacity=".1" />
    </linearGradient></defs>
    {path ? <path d={path} fill={`url(#${gradientId})`} /> : null}
  </svg>
}

export function CvComparison({ onBack }: { onBack?: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(requirements.find((item) => item.status !== 'matched')?.id ?? requirements[0].id)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<string[]>([])
  const [approved, setApproved] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [focusMode, setFocusMode] = useState(false)
  const [showAccepted, setShowAccepted] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const rowsRef = useRef(new Map<string, HTMLElement>())
  const listRef = useRef<HTMLDivElement>(null)
  const commentsRef = useRef<HTMLDivElement>(null)
  const selected = requirements.find((item) => item.id === selectedId)
  const pending = requirements.filter((item) => !accepted.includes(item.id))
  const improvements = pending.filter((item) => item.status !== 'matched')
  const visible = requirements.filter((item) => showAccepted || !accepted.includes(item.id) || item.id === selectedId)
  const selectedIndex = requirements.findIndex((item) => item.id === selectedId)
  const observedId = visible.some((item) => item.id === hoveredId) ? hoveredId : selectedId
  const previewing = observedId !== selectedId

  function selectItem(id: string | null) {
    setHoveredId(null)
    setSelectedId(id)
  }

  function onReviewKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.key === 'Escape') {
      setHoveredId(null)
      setFocusMode(false)
      return
    }
    if (!target.closest('.comparison-review-list, .comparison-navigation')) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const next = nextPending(selectedId, accepted, event.key === 'ArrowDown' ? 1 : -1)
    if (!next) return
    event.preventDefault()
    selectItem(next)
    requestAnimationFrame(() => rowsRef.current.get(next)?.querySelector<HTMLButtonElement>('.comparison-requirement')?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    // Scroll only the document pane; the active comment stays in view beside it.
    const row = selectedId ? rowsRef.current.get(selectedId) : undefined
    const list = listRef.current
    if (row && list && window.matchMedia('(min-width: 1101px)').matches) {
      list.scrollTo({ top: row.offsetTop - 12, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
    commentsRef.current?.scrollTo({ top: 0 })
  }, [selectedId])

  function nextPending(id: string | null, done = accepted, direction = 1) {
    const start = requirements.findIndex((item) => item.id === id)
    for (let step = 1; step <= requirements.length; step++) {
      const index = (start + direction * step + requirements.length * 2) % requirements.length
      if (!done.includes(requirements[index].id)) return requirements[index].id
    }
    return null
  }

  function acceptMatch() {
    if (!selected || selected.status !== 'matched') return
    const done = [...new Set([...accepted, selected.id])]
    setAccepted(done)
    setAnnouncement(`${selected.title}: match aceptado y minimizado.`)
    selectItem(nextPending(selected.id, done))
  }

  function approveSuggestion() {
    if (!selected?.suggestion) return
    const text = (drafts[selected.id] ?? selected.suggestion.text).trim()
    if (!text) return
    setApproved((current) => ({ ...current, [selected.id]: text }))
    setAccepted((current) => [...new Set([...current, selected.id])])
    setAnnouncement(`Cambio aprobado: ${selected.title}. Incorporado al CV de ejemplo.`)
  }

  function reopen(item: Requirement) {
    setAccepted((current) => current.filter((id) => id !== item.id))
    setApproved((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    setAnnouncement(approved[item.id] ? `Cambio deshecho: ${item.title}. Se restauró el CV anterior.` : `${item.title} vuelve a pendientes.`)
  }

  const canNavigate = pending.some((item) => item.id !== selectedId)
  const hasComment = Boolean(selected?.suggestion)

  return (
    <main className={`comparison-page${previewing ? ' is-previewing' : ''}`} onKeyDown={onReviewKey}>
      <header className="comparison-heading">
        <div className="comparison-heading-title">
          {onBack ? <button type="button" className="comparison-back" aria-label="Volver al CV" onClick={onBack}>←</button> : <CompareIcon />}
          <h1>Revisar antes de enviar</h1><span className="comparison-demo">Demo</span>
        </div>
        <p>Senior Frontend Engineer <span>· Nómada</span></p>
        <span className="comparison-demo-note">CV, aviso y comentarios de IA de ejemplo</span>
      </header>

      <div className="comparison-toolbar">
        <div className="comparison-navigation" aria-label="Revisión secuencial">
          <button type="button" aria-label="Requisito anterior" disabled={!canNavigate} onClick={() => selectItem(nextPending(selectedId, accepted, -1))}>←</button>
          <span>{selected ? <>Requisito <strong>{selectedIndex + 1}</strong> de {requirements.length}</> : 'Revisión completa'}</span>
          <button type="button" aria-label="Requisito siguiente" disabled={!canNavigate} onClick={() => selectItem(nextPending(selectedId))}>→</button>
        </div>
        <div className="comparison-progress"><progress value={accepted.length} max={requirements.length} aria-label="Requisitos revisados" /><span><strong>{accepted.length}/{requirements.length}</strong> revisados</span></div>
        <button type="button" className="comparison-next-improvement" disabled={!improvements.length} onClick={() => {
          const index = improvements.findIndex((item) => item.id === selectedId)
          selectItem(improvements[(index + 1) % improvements.length].id)
        }}>{improvements.length ? `${improvements.length} por mejorar · siguiente →` : 'Sin mejoras pendientes'}</button>
        <div className="comparison-view-options">
          <span className="comparison-keyboard-hint"><kbd>↑</kbd><kbd>↓</kbd> para recorrer</span>
          <label><input type="checkbox" checked={focusMode} onChange={(event) => setFocusMode(event.target.checked)} />Modo foco</label>
          <button type="button" className={showAccepted ? 'is-on' : ''} aria-pressed={showAccepted} onClick={() => setShowAccepted((value) => !value)}>{showAccepted ? 'Ocultar' : 'Ver'} aceptados <span>{accepted.length}</span></button>
        </div>
      </div>

      <div className={`comparison-workbench${hasComment ? ' has-comment' : ''}`}>
        <section className="comparison-documents" aria-label="Requisitos y evidencia del CV">
          <div className="comparison-paper-area">
          <div className="comparison-column-headings">
            <h2 className="comparison-posting-heading"><span>AVISO · REFERENCIA</span>Senior Frontend Engineer<small>Nómada · Remoto</small></h2><span aria-hidden="true" />
            <h2 className="comparison-cv-heading"><span>CV A ENVIAR</span>Alex Morgan<small>Frontend Engineer · Versión de ejemplo</small></h2>
          </div>
          <div className={`comparison-review-list${observedId ? ' has-observation' : ''}`} ref={listRef} role="group" aria-label="Fragmentos de comparación" aria-keyshortcuts="ArrowUp ArrowDown">
            {visible.map((item) => {
              const active = item.id === selectedId
              const observed = item.id === observedId
              const done = accepted.includes(item.id)
              const expanded = active || (!focusMode && !done && item.status !== 'matched')
              const fragments = fragmentsFor(item, approved[item.id])
              const number = String(requirements.indexOf(item) + 1).padStart(2, '0')
              return (
                <article key={item.id} ref={(element) => { if (element) rowsRef.current.set(item.id, element); else rowsRef.current.delete(item.id) }} className={`comparison-review-row is-${item.status}${active ? ' is-active' : ''}${observed ? ' is-observed' : ''}${done ? ' is-done' : ''}${expanded ? ' is-expanded' : ' is-collapsed'}`}
                  onPointerMove={(event) => { if (event.pointerType === 'mouse' && !event.buttons) setHoveredId(active ? null : item.id) }}
                  onPointerLeave={() => setHoveredId((current) => current === item.id ? null : current)}
                  onFocus={() => { if (!active) setHoveredId(item.id) }}
                  onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHoveredId(null) }}
                >
                  {expanded && fragments.length > 0 ? <MatchConnections /> : null}
                  <button type="button" className="comparison-requirement" aria-label={`Revisar ${item.title}`} aria-pressed={active} aria-current={active ? 'step' : undefined} onClick={() => selectItem(item.id)}>
                    <span className="comparison-row-select">
                      <span className="comparison-number">{done ? '✓' : number}</span><strong>{item.title}</strong><span className="comparison-row-state">{observed ? active ? 'En revisión' : 'Vista previa' : ''}</span>
                    </span>
                    {expanded ? <span id={`comparison-content-${item.id}`} className="comparison-requirement-body"><span className="comparison-requirement-text"><Highlight text={item.text} emphasis={item.emphasis} /></span><span className="comparison-requirement-meta"><span>{item.essential ? 'Requerido' : 'Deseable'}</span>{done ? <span className="comparison-approved-label">{approved[item.id] ? 'Cambio aprobado' : 'Aceptado'}</span> : <Status status={item.status} />}</span></span> : null}
                  </button>
                  <div className="comparison-connection" aria-hidden="true">
                    {!expanded ? <span>{fragments.length ? '↔' : '−'}</span> : null}
                  </div>
                  <div className="comparison-evidence-group">
                    {expanded ? fragments.length ? fragments.map((fragment) => <button type="button" className={`comparison-evidence${fragment.revised ? ' is-revised' : ''}`} key={fragment.id} onClick={() => selectItem(item.id)} aria-pressed={active} aria-label={`Revisar evidencia de ${item.title}`}><span className="comparison-evidence-source">{fragment.section}<span className="comparison-linked-number" aria-hidden="true">↔ {number}</span></span><span className="comparison-evidence-text">{fragment.revised ? fragment.text : <Highlight text={fragment.text} emphasis={fragment.emphasis} />}</span>{fragment.revised ? <span className="comparison-approved-label">✓ Incorporado con tu aprobación</span> : null}</button>) : <button type="button" className="comparison-empty-evidence" onClick={() => selectItem(item.id)} aria-pressed={active} aria-label={`Revisar evidencia de ${item.title}`}><span aria-hidden="true">＋</span><span>Sin evidencia todavía</span>{active ? <small>Hay una propuesta para este requisito →</small> : null}</button> : <button type="button" className="comparison-evidence-summary" onClick={() => selectItem(item.id)} aria-pressed={active} aria-label={`Ver evidencia de ${item.title}`}><span>{done ? approved[item.id] ? '✓ Cambio incorporado' : '✓ Match aceptado' : fragments[0]?.text ?? 'Sin evidencia en el CV'}</span>{!done ? <Status status={item.status} /> : <span>Reabrir ↗</span>}</button>}
                  </div>
                </article>
              )
            })}
            {accepted.length > 0 && !showAccepted ? <button type="button" className="comparison-collapsed-accepted" onClick={() => setShowAccepted(true)}><span>✓ {accepted.length} requisito{accepted.length > 1 ? 's' : ''} revisado{accepted.length > 1 ? 's' : ''}</span><span>Ver aceptados ↓</span></button> : null}
            {pending.length === 0 ? <div className="comparison-complete"><span aria-hidden="true">✓</span><h2>Revisión completa</h2><p>Revisaste los {requirements.length} requisitos. Podés volver a abrir cualquier ítem o deshacer los cambios aprobados.</p><button type="button" className="comparison-secondary" onClick={() => { setShowAccepted(true); selectItem(requirements[0].id) }}>Revisar decisiones</button></div> : null}
          </div>
          </div>
          {selected ? <div className="comparison-review-actions">
            <span className="comparison-current-item"><span>{String(selectedIndex + 1).padStart(2, '0')}</span><span><small>REVISANDO</small>{selected.title}</span></span>
            <div>
              {hasComment ? <a className="comparison-mobile-note" href="#comparison-comments">Ver nota ↓</a> : null}
              {accepted.includes(selected.id) ? <>
                {!approved[selected.id] ? <button type="button" className="comparison-skip" onClick={() => reopen(selected)}>Volver a pendientes</button> : null}
                <button type="button" className="comparison-primary" onClick={() => selectItem(nextPending(selected.id))}>{pending.length ? 'Continuar revisión →' : 'Finalizar revisión ✓'}</button>
              </> : <>
                <button type="button" className="comparison-skip" disabled={!canNavigate} onClick={() => selectItem(nextPending(selected.id))}>Dejar pendiente y seguir →</button>
                {selected.status === 'matched' ? <button type="button" className="comparison-primary" onClick={acceptMatch}>Aceptar match y continuar <span aria-hidden="true">→</span></button> : null}
              </>}
            </div>
          </div> : null}
        </section>

        <aside className={`comparison-comments${hasComment ? '' : ' is-empty'}`} id="comparison-comments" aria-labelledby="comments-heading">
          <div className="comparison-comments-heading"><h2 id="comments-heading"><span aria-hidden="true">✦</span> {hasComment ? 'Nota de IA' : 'Notas'}</h2>{hasComment ? <span>Sobre el requisito {String(selectedIndex + 1).padStart(2, '0')} · Demo</span> : null}</div>
          {hasComment && selected ? (
            <div className="comparison-comments-body" ref={commentsRef} key={selected.id}>
              <h3>{selected.title}</h3>
              {approved[selected.id] ? <div className="comparison-applied"><strong>✓ Cambio incorporado</strong><button type="button" onClick={() => reopen(selected)}>Deshacer cambio</button></div> : selected.suggestion ? <>
                <p className="comparison-comment-text">{selected.explanation}</p>
                <div className="comparison-suggestion">
                  <p>Si ya lo hiciste, podés sumarlo así:</p>
                  <span className="comparison-suggestion-location">{selected.suggestion.replaces ? 'Reemplazar en' : 'Agregar en'} · {selected.suggestion.section}</span>
                  <label htmlFor={`suggestion-${selected.id}`}>Texto propuesto · editable</label>
                  <textarea id={`suggestion-${selected.id}`} value={drafts[selected.id] ?? selected.suggestion.text} onChange={(event) => setDrafts((current) => ({ ...current, [selected.id]: event.target.value }))} rows={7} />
                  <button type="button" className="comparison-primary" disabled={!(drafts[selected.id] ?? selected.suggestion.text).trim()} onClick={approveSuggestion}>Aprobar e incorporar <span aria-hidden="true">✓</span></button>
                </div>
                <details className="comparison-learning" key={`learning-${selected.id}`}><summary>¿Todavía no tenés esta experiencia?</summary><ol>{selected.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol><p><strong>Qué podrías sumar después</strong>{selected.outcome}</p></details>
              </> : null}
            </div>
          ) : null}
        </aside>
      </div>
      <div className="comparison-announcement" role="status">{announcement}</div>
    </main>
  )
}
