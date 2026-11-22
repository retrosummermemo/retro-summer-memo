import type { ReactNode } from 'react'
import type { ProfileTab } from '../../routes'

const tabs: { id: ProfileTab; label: string }[] = [
  { id: 'personal', label: 'Datos y trayectoria' },
  { id: 'achievements', label: 'Logros' },
  { id: 'sections', label: 'Secciones' },
]

/** "Mi perfil": everything the CVs are made from, entered once. */
export function ProfilePage({ tab, onTab, counts, children }: { tab: ProfileTab; onTab: (tab: ProfileTab) => void; counts?: Partial<Record<ProfileTab, number>>; children: ReactNode }) {
  return (
    <div className="profile-page">
      <header className="profile-top">
        <h1>Mi perfil</h1>
        <p>Lo que sos y lo que hiciste, cargado una sola vez. Tus CVs eligen de acá: cambiá un dato y se actualiza en todos.</p>
        <div className="page-tabs" role="tablist" aria-label="Partes del perfil">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" className="page-tab" aria-selected={item.id === tab} onClick={() => onTab(item.id)}>
              {item.label}
              {counts?.[item.id] ? <span className="page-tab-badge">{counts[item.id]}</span> : null}
            </button>
          ))}
        </div>
      </header>
      {children}
    </div>
  )
}
