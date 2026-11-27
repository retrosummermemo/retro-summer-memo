// Deliberately independent of the user's document. Replace with an AI analysis later.
export type MatchStatus = 'matched' | 'partial' | 'missing'

export type Requirement = {
  id: string
  title: string
  text: string
  emphasis: string
  status: MatchStatus
  essential: boolean
  evidenceIds: string[]
  explanation: string
  nextSteps: string[]
  outcome?: string
  suggestion?: {
    section: string
    text: string
    replaces?: string
  }
}

export const statusLabels: Record<MatchStatus, string> = {
  matched: 'Match',
  partial: 'Parcial',
  missing: 'Sin evidencia',
}

export const evidence = [
  { id: 'react', section: 'Experiencia · Nube · 2022 — Actualidad', text: 'Desarrollé una plataforma B2B con React y TypeScript, utilizada por más de 12.000 usuarios mensuales.', emphasis: 'React y TypeScript' },
  { id: 'design', section: 'Experiencia · Nube · 2022 — Actualidad', text: 'Construí junto a diseño un sistema de 35 componentes reutilizables en Storybook, reduciendo un 30% el tiempo de entrega.', emphasis: '35 componentes reutilizables en Storybook' },
  { id: 'team', section: 'Experiencia · Nube · 2022 — Actualidad', text: 'Colaboré con producto, diseño y backend para llevar funcionalidades desde el discovery hasta producción.', emphasis: 'producto, diseño y backend' },
  { id: 'testing', section: 'Experiencia · Punto · 2020 — 2022', text: 'Implementé tests unitarios con Vitest y React Testing Library para los flujos principales de la aplicación.', emphasis: 'tests unitarios con Vitest y React Testing Library' },
  { id: 'typescript', section: 'Experiencia · Punto · 2020 — 2022', text: 'Migré una aplicación de JavaScript a TypeScript y desarrollé interfaces en React para el equipo de operaciones.', emphasis: 'TypeScript y desarrollé interfaces en React' },
]

export const requirements: Requirement[] = [
  {
    id: 'frontend', title: 'React + TypeScript', status: 'matched', essential: true,
    text: 'Más de 3 años de experiencia desarrollando aplicaciones con React y TypeScript.', emphasis: 'React y TypeScript',
    evidenceIds: ['react', 'typescript'],
    explanation: 'Dos experiencias muestran uso de React y TypeScript desde 2020. El CV respalda tanto las tecnologías como los años de experiencia solicitados.',
    nextSteps: [],
  },
  {
    id: 'systems', title: 'Sistemas de diseño', status: 'matched', essential: true,
    text: 'Experiencia creando sistemas de diseño y componentes reutilizables con Storybook.', emphasis: 'componentes reutilizables con Storybook',
    evidenceIds: ['design'],
    explanation: 'El CV incluye un sistema de 35 componentes en Storybook y un resultado medible: 30% menos tiempo de entrega. Es evidencia directa del requisito.',
    nextSteps: [],
  },
  {
    id: 'tests', title: 'Testing de punta a punta', status: 'partial', essential: true,
    text: 'Dominio de tests unitarios y end-to-end con herramientas como Vitest y Playwright.', emphasis: 'tests unitarios y end-to-end',
    evidenceIds: ['testing'],
    explanation: 'Hay evidencia de tests unitarios con Vitest, pero el CV no menciona pruebas end-to-end ni experiencia con Playwright.',
    nextSteps: ['Si ya hiciste pruebas E2E, agregá un caso concreto: qué flujo cubriste, con qué herramienta y qué resultado tuvo.', 'Si todavía no, sumá Playwright a un proyecto y cubrí un flujo completo de registro, login y compra. Integralo a CI.'],
    outcome: 'Un proyecto con una suite E2E ejecutándose en CI y una descripción de los flujos que protege.',
    suggestion: {
      section: 'Experiencia · Punto · 2020 — 2022',
      replaces: 'testing',
      text: 'Implementé tests unitarios con Vitest y React Testing Library, y pruebas end-to-end con Playwright para los flujos de registro y compra, integradas al pipeline de CI.',
    },
  },
  {
    id: 'collaboration', title: 'Trabajo en equipo', status: 'matched', essential: true,
    text: 'Capacidad para colaborar con producto, diseño y backend en equipos multidisciplinarios.', emphasis: 'producto, diseño y backend',
    evidenceIds: ['team'],
    explanation: 'La experiencia describe colaboración con las tres áreas y participación en todo el ciclo, desde discovery hasta producción.',
    nextSteps: [],
  },
  {
    id: 'accessibility', title: 'Accesibilidad web', status: 'missing', essential: true,
    text: 'Conocimiento de accesibilidad web y experiencia aplicando las pautas WCAG 2.2.', emphasis: 'accesibilidad web',
    evidenceIds: [],
    explanation: 'No hay un fragmento del CV que demuestre trabajo en accesibilidad. Eso no significa que no lo sepas: falta evidencia visible.',
    nextSteps: ['Revisá si ya trabajaste con navegación por teclado, lectores de pantalla o HTML semántico. Si fue así, describí un ejemplo real.', 'Para ganar experiencia, auditá un proyecto con axe, probalo con teclado y lector de pantalla, y corregí los problemas de contraste, foco y etiquetas.'],
    outcome: 'Un caso de estudio con los problemas detectados, las mejoras implementadas y los criterios WCAG verificados.',
    suggestion: {
      section: 'Proyectos · Accesibilidad web',
      text: 'Audité la accesibilidad de una aplicación con axe y pruebas de teclado y lector de pantalla. Corregí problemas de contraste, gestión del foco y etiquetas siguiendo las pautas WCAG 2.2.',
    },
  },
  {
    id: 'english', title: 'Inglés conversacional', status: 'missing', essential: false,
    text: 'Valoramos un nivel de inglés B2 o superior para colaborar con nuestro equipo internacional.', emphasis: 'inglés B2 o superior',
    evidenceIds: [],
    explanation: 'El CV no incluye una sección de idiomas ni ejemplos de colaboración en inglés. Es un requisito deseable, no excluyente.',
    nextSteps: ['Si ya tenés ese nivel, agregalo en Idiomas y mencioná una experiencia real usando inglés en el trabajo.', 'Si necesitás desarrollarlo, practicá conversaciones técnicas y presentaciones de proyectos. Evaluá tu nivel con una prueba alineada al MCER.'],
    outcome: 'Una sección de idiomas con tu nivel verificado y, cuando corresponda, un ejemplo de uso profesional.',
    suggestion: {
      section: 'Idiomas',
      text: 'Inglés · B2. Conversación técnica, documentación y colaboración con equipos internacionales.',
    },
  },
]
