/**
 * Where the user is in the app, as a URL: each section and each application or CV has its own
 * address, so links can be shared and the browser's back button works.
 *
 *   /postulaciones                  the tracker
 *   /postulaciones/<id>             one application (its process)
 *   /postulaciones/<id>/cv          its CV, in the editor
 *   /postulaciones/<id>/empresa     what is known about its company
 *   /cvs                            the user's CVs
 *   /cvs/<id>                       one CV in the editor
 *   /perfil, /perfil/logros, /perfil/secciones   profile: data and career, achievements, sections
 */
import { useCallback, useEffect, useState } from 'react'

export type ApplicationTab = 'process' | 'cv' | 'company'
export type ProfileTab = 'personal' | 'achievements' | 'sections'

export type Route =
  | { page: 'applications'; applicationId?: string; tab?: ApplicationTab }
  | { page: 'cvs'; cvId?: string }
  | { page: 'profile'; tab: ProfileTab }

export type Section = Route['page']

const applicationTabs: Record<string, ApplicationTab> = { cv: 'cv', empresa: 'company' }
const applicationTabPaths: Record<ApplicationTab, string> = { process: '', cv: '/cv', company: '/empresa' }
const profileTabs: Record<string, ProfileTab> = { logros: 'achievements', secciones: 'sections' }
const profileTabPaths: Record<ProfileTab, string> = { personal: '', achievements: '/logros', sections: '/secciones' }

/** The route of a path; anything unknown is the tracker, the app's home. */
export function parseRoute(pathname: string): Route {
  const [first, second, third] = pathname
    .split('/')
    .filter(Boolean)
    .map((part) => safeDecode(part))
  if (first === 'cvs') return second ? { page: 'cvs', cvId: second } : { page: 'cvs' }
  if (first === 'perfil') return { page: 'profile', tab: profileTabs[second ?? ''] ?? 'personal' }
  if (first === 'postulaciones' && second) return { page: 'applications', applicationId: second, tab: applicationTabs[third ?? ''] ?? 'process' }
  return { page: 'applications' }
}

export function routePath(route: Route): string {
  if (route.page === 'cvs') return route.cvId ? `/cvs/${encodeURIComponent(route.cvId)}` : '/cvs'
  if (route.page === 'profile') return `/perfil${profileTabPaths[route.tab]}`
  if (!route.applicationId) return '/postulaciones'
  return `/postulaciones/${encodeURIComponent(route.applicationId)}${applicationTabPaths[route.tab ?? 'process']}`
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * The current route and a way to go elsewhere. Going to a new place adds a history entry;
 * `replace` swaps the current one (for corrections, like a link to something deleted).
 */
export function useRoute(): [Route, (route: Route, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))

  useEffect(() => {
    function onPop() {
      setRoute(parseRoute(window.location.pathname))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Route, options: { replace?: boolean } = {}) => {
    const path = routePath(next)
    if (path !== window.location.pathname) {
      // The hash is kept: Supabase may still be reading a sign-in from it.
      const url = path + window.location.hash
      if (options.replace) window.history.replaceState(null, '', url)
      else window.history.pushState(null, '', url)
    }
    setRoute(next)
  }, [])

  return [route, navigate]
}
