import { describe, expect, it } from 'vitest'
import { parseRoute, routePath, type Route } from './routes'

describe('routes', () => {
  it.each<[string, Route]>([
    ['/postulaciones', { page: 'applications' }],
    ['/postulaciones/app-1', { page: 'applications', applicationId: 'app-1', tab: 'process' }],
    ['/postulaciones/app-1/cv', { page: 'applications', applicationId: 'app-1', tab: 'cv' }],
    ['/postulaciones/app-1/empresa', { page: 'applications', applicationId: 'app-1', tab: 'company' }],
    ['/cvs', { page: 'cvs' }],
    ['/cvs/cv%20react', { page: 'cvs', cvId: 'cv react' }],
    ['/perfil', { page: 'profile', tab: 'personal' }],
    ['/perfil/logros', { page: 'profile', tab: 'achievements' }],
    ['/perfil/secciones', { page: 'profile', tab: 'sections' }],
  ])('%s', (path, route) => {
    expect(parseRoute(path)).toEqual(route)
    expect(routePath(route)).toBe(path)
  })

  it('takes anything unknown as the tracker, and tolerates trailing slashes and bad escapes', () => {
    expect(parseRoute('/')).toEqual({ page: 'applications' })
    expect(parseRoute('/nada/que/ver')).toEqual({ page: 'applications' })
    expect(parseRoute('/cvs/')).toEqual({ page: 'cvs' })
    expect(parseRoute('/postulaciones/app-1/otra')).toEqual({ page: 'applications', applicationId: 'app-1', tab: 'process' })
    expect(parseRoute('/cvs/%E0%A4%A')).toEqual({ page: 'cvs', cvId: '%E0%A4%A' })
  })
})
