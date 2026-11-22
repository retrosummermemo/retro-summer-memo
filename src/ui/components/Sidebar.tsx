import './shell.css'
import { useEffect, useState, type ReactNode } from 'react'
import type { Section } from '../routes'
import type { SaveStatus } from '../useDocumentSync'
import { LogoMark, Wordmark } from './brand/Brand'

type SidebarProps = {
  /** The section on screen; none while a screen of its own (like the CV editor) is open. */
  section: Section | null
  onNavigate: (section: Section) => void
  /** Shown next to each section: open applications, CVs. */
  counts?: Partial<Record<Section, number>>
  save: SaveStatus
  onRetrySave: () => void
  account?: { email: string; onSignOut: () => void }
  /** Assistants (ChatGPT, Claude…) connected through the MCP. */
  assistant?: { connected: boolean; onOpen: () => void }
}

const collapsedKey = 'resume.navCollapsed.v1'

const items: { id: Section; label: string; hint: string; counted?: string; icon: ReactNode }[] = [
  { id: 'applications', label: 'Postulaciones', hint: 'Los puestos a los que te postulaste y cómo viene cada proceso', counted: 'en curso', icon: <ApplicationsIcon /> },
  { id: 'cvs', label: 'Mis CVs', hint: 'Tus CVs por rol y los de cada postulación', counted: 'CVs', icon: <CvsIcon /> },
  { id: 'profile', label: 'Mi perfil', hint: 'Tus datos, tu trayectoria y tus logros: de acá salen todos tus CVs', icon: <ProfileIcon /> },
]

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(collapsedKey) === '1'
  } catch {
    return false
  }
}

/** The app's main navigation: the three sections, the assistant, saving and the account. */
export function Sidebar({ section, onNavigate, counts = {}, save, onRetrySave, account, assistant }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(collapsedKey, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  return (
    <nav className={collapsed ? 'nav is-collapsed' : 'nav'} aria-label="Secciones">
      <div className="nav-head">
        <span className="nav-brand" title="ReSuMe · Retro Summer Memo">
          <LogoMark size={26} />
          <Wordmark className="nav-wordmark" />
        </span>
        <button
          type="button"
          className="nav-collapse"
          aria-label={collapsed ? 'Mostrar nombres' : 'Ocultar nombres'}
          title={collapsed ? 'Mostrar nombres' : 'Ocultar nombres'}
          onClick={() => setCollapsed((value) => !value)}
        >
          <CollapseIcon flipped={collapsed} />
        </button>
      </div>

      <ul className="nav-list">
        {items.map((item) => {
          const count = counts[item.id]
          const current = section === item.id
          return (
            <li key={item.id}>
              <button
                type="button"
                className="nav-item"
                aria-current={current ? 'page' : undefined}
                title={collapsed ? item.label : item.hint}
                onClick={() => onNavigate(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {count ? (
                  <span className="nav-count" title={`${count} ${item.counted ?? ''}`.trim()}>
                    {count}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="nav-foot">
        {assistant ? (
          <button
            type="button"
            className={assistant.connected ? 'nav-item nav-assistant is-connected' : 'nav-item nav-assistant'}
            title={assistant.connected ? 'Tu asistente está conectado' : 'Conectá ChatGPT, Claude o Gemini'}
            onClick={assistant.onOpen}
          >
            <span className="nav-icon">
              <AssistantIcon />
              {assistant.connected ? <span className="nav-dot" aria-hidden="true" /> : null}
            </span>
            <span className="nav-label">
              Asistente
              <small>{assistant.connected ? 'Conectado' : 'Conectar'}</small>
            </span>
          </button>
        ) : null}
        <SaveState save={save} onRetry={onRetrySave} />
        {account ? (
          <div className="nav-account">
            <span className="nav-avatar" aria-hidden="true" title={account.email}>
              {(account.email.trim()[0] ?? '?').toUpperCase()}
            </span>
            <span className="nav-label nav-email" title={account.email}>
              {account.email}
            </span>
            <button type="button" className="nav-signout" aria-label={`Cerrar sesión (${account.email})`} title="Cerrar sesión" onClick={account.onSignOut}>
              <SignOutIcon />
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  )
}

function SaveState({ save, onRetry }: { save: SaveStatus; onRetry: () => void }) {
  if (save.state === 'error') {
    return (
      <button type="button" className="nav-save is-error" title={`No se pudo guardar: ${save.message}. Click para reintentar.`} onClick={onRetry}>
        <span className="nav-save-dot" aria-hidden="true" />
        <span className="nav-label">No se guardó · Reintentar</span>
      </button>
    )
  }
  const label = save.state === 'saving' ? 'Guardando…' : 'Todo guardado'
  return (
    <span className={`nav-save is-${save.state}`} role="status" title={label} aria-label={label}>
      <span className="nav-save-dot" aria-hidden="true" />
      <span className="nav-label">{label}</span>
    </span>
  )
}

function CollapseIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flipped ? { transform: 'scaleX(-1)' } : undefined}>
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 2.5v11M10.5 6 8.75 8l1.75 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AssistantIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5v6a1.5 1.5 0 0 1-1.5 1.5H8l-3.5 3v-3h0A1.5 1.5 0 0 1 3 10.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M6.5 7.5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ApplicationsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1.75" y="5" width="14.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5M1.75 9.5h14.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function CvsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5.5 1.75h5.25L14 5v9.75a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 1-1.5-1.5V3.25a1.5 1.5 0 0 1 1.5-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10.5 2v3.25H14M6.75 9h4.5M6.75 12h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="5.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 15.5c.6-2.8 2.8-4.2 5.5-4.2s4.9 1.4 5.5 4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M7 3H3.5v12H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 5.5 14.5 9 11 12.5M14.5 9H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
