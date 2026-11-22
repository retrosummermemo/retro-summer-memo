/** The everyday requests: what the user types to their assistant to drive Resume. */
export const prompts = {
  start: 'Preparemos mi Resume: fijate qué me falta y preguntame',
  updateInfo: 'Actualizá mi info en Resume',
  analyze: 'Mirá este aviso: <link>',
  apply: (company: string) => `Me quiero postular a ${company || '<empresa>'}: armemos el CV`,
  buildCv: 'Armemos el CV para <link del aviso>',
  news: (company: string, next?: string) =>
    `Me confirmaron de ${company || '<empresa>'}, ${next ? `pasé a ${next}` : 'pasé a la siguiente etapa'}, es el <fecha>`,
  debrief: (company: string, stage: string) =>
    `Te cuento cómo me fue en ${stage || 'la entrevista'} con ${company || '<empresa>'}: me preguntaron…`,
  research: (company: string) => `Investigá ${company || '<empresa>'} y guardá lo importante en Resume`,
  prepare: (company: string) => `Preparame para la próxima etapa con ${company || '<empresa>'}`,
}

/** For the instructions of a project in Claude or ChatGPT: every chat starts by looking at Resume. */
export const projectInstructions =
  'Usá Resume (el conector) para todo lo de mi búsqueda laboral y mi carrera. Resume es la fuente de verdad de mis postulaciones, mi carrera, mis CVs y mis procesos: si te pregunto por mis postulaciones, cuántas tengo, en qué etapa está cada una, mi tasa de rechazo o mi historial, consultá Resume antes de responder, nunca de memoria. Al empezar cada chat sobre trabajo, llamá a get_started y seguí lo que sugiere. Si te paso el link de un aviso, guardalo como "Analizando propuesta" y decime cómo encaja conmigo. Si te cuento novedades de un proceso, actualizalo sin que te lo pida.'
