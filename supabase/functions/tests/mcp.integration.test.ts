/**
 * The MCP server end to end, against the local stack:
 *   npm run db:start
 *   npx supabase functions serve mcp      (keep it running)
 *   npm run test:mcp
 * Users sign in with a password here; real clients get an equivalent token through OAuth.
 */
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSupabaseStore } from '../../../src/adapters/supabase/store'
import { openDocument } from '../../../src/app/openDocument'
import { sampleDocument } from '../../../src/test/sample'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
const endpoint = `${url}/functions/v1/mcp`

async function newUser() {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signUp({ email: `mcp-${crypto.randomUUID()}@example.com`, password: 'integration-test-password' })
  if (error || !data.session || !data.user) throw error ?? new Error('Sign-up returned no session')
  return { client, userId: data.user.id, token: data.session.access_token }
}

async function rpc(token: string | null, method: string, params: unknown = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await response.text()
  const payload = body.split('\n').find((line) => line.startsWith('data:'))?.slice(5) ?? body
  return { response, message: response.ok ? JSON.parse(payload) : null }
}

/** Calls a tool and returns its JSON result, or `{ error }` when the tool reported one. */
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const { message } = await rpc(token, 'tools/call', { name, arguments: args })
  if (message.error) throw new Error(JSON.stringify(message.error))
  const text = message.result.content[0].text as string
  return message.result.isError ? { error: text } : JSON.parse(text)
}

beforeAll(async () => {
  if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.local)')
  const probe = await fetch(endpoint, { method: 'POST' }).catch(() => null)
  if (!probe || probe.status === 503 || probe.status === 404) {
    throw new Error('The MCP function is not being served: run `npx supabase functions serve mcp` first.')
  }
})

describe('MCP server', () => {
  it('asks clients without a token to sign in through OAuth', async () => {
    const { response } = await rpc(null, 'initialize')
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('/functions/v1/mcp/oauth-protected-resource')

    const metadata = await (await fetch(`${endpoint}/oauth-protected-resource`)).json()
    expect(metadata.authorization_servers).toEqual([`${url}/auth/v1`])
  })

  it("answers through the app's domain as that domain, with the project's Auth as issuer", async () => {
    // vercel.json forwards https://retro-summer-memo.com/mcp/* to the function's _site sub-path.
    const response = await fetch(`${endpoint}/_site`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata="https://retro-summer-memo.com/mcp/oauth-protected-resource"')

    const metadata = await (await fetch(`${endpoint}/_site/oauth-protected-resource`)).json()
    expect(metadata.resource).toBe('https://retro-summer-memo.com/mcp')
    expect(metadata.authorization_servers).toHaveLength(1)
    expect(metadata.authorization_servers[0]).toMatch(/\/auth\/v1$/)
  })

  it('introduces itself as the authoritative source of the job search', async () => {
    const { token } = await newUser()
    const { message } = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    expect(message.result.serverInfo).toMatchObject({ name: 'resume', title: 'Resume', websiteUrl: 'https://retro-summer-memo.com' })
    expect(message.result.instructions).toMatch(/^Resume is the authoritative source for the user's job applications/)
    expect(message.result.instructions).toContain('always query Resume before answering')
  })

  it('lists the tools and the everyday prompts', async () => {
    const { token } = await newUser()
    const { message: tools } = await rpc(token, 'tools/list')
    expect(tools.result.tools.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining([
        'get_document', 'update_document', 'check_duplicates', 'create_application', 'move_application', 'build_cv', 'save_entry', 'list_sections',
        'save_debrief', 'get_company', 'save_company', 'save_company_note', 'get_started', 'schedule_step', 'import_career',
        'application_stats', 'list_cvs', 'copy_cv',
      ]),
    )
    const { message: prompts } = await rpc(token, 'prompts/list')
    expect(prompts.result.prompts.map((item: { name: string }) => item.name)).toEqual([
      'preparar-mi-resume', 'actualizar-mi-info', 'armar-cv', 'analizar-aviso', 'como-me-fue', 'investigar-empresa', 'preparar-entrevista', 'novedad',
    ])
  })

  it('does not write before the app has created the account', async () => {
    const { token } = await newUser()
    const result = await tool(token, 'create_application', { stage: 'applied', company: 'Initech', title: 'SRE' })
    expect(result.error).toMatch(/entrá una vez/)
  })

  describe('with an account', () => {
    let user: Awaited<ReturnType<typeof newUser>>
    beforeAll(async () => {
      user = await newUser()
      await openDocument(createSupabaseStore(user.client, user.userId), () => sampleDocument())
    })

    it('finds earlier applications to the same posting even with other tracking params', async () => {
      const result = await tool(user.token, 'check_duplicates', {
        company: 'ACME Inc.',
        title: 'Sr Backend Engineer',
        url: 'https://www.linkedin.com/jobs/view/4012345678/?trk=other',
      })
      expect(result.already_applied).toBe(true)
      expect(result.matches[0]).toMatchObject({ reason: 'same-posting', company: 'Acme', status: 'Call con RRHH' })
    })

    it('only creates a duplicate once the user confirms', async () => {
      const posting = { stage: 'applied', company: 'Acme', title: 'Backend Engineer', url: 'https://www.linkedin.com/jobs/view/4012345678/' }
      expect(await tool(user.token, 'create_application', posting)).toMatchObject({ created: false })
      expect(await tool(user.token, 'create_application', { ...posting, confirm_duplicate: true })).toMatchObject({ created: true })
    })

    it('creates, moves and edits applications that the app then reads back', async () => {
      const created = await tool(user.token, 'create_application', {
        stage: 'applied',
        company: 'Initech',
        title: 'Site Reliability Engineer',
        location: 'Remoto',
        note: 'Referida por Peter',
      })
      expect(created.application.status).toBe('CV enviado')
      const id = created.application.id

      expect(await tool(user.token, 'move_application', { id, status: 'take HOME', note: 'Entrega el viernes' })).toMatchObject({
        status: 'Take home',
      })
      // A status that does not exist yet is created.
      expect(await tool(user.token, 'move_application', { id, status: 'Contratado' })).toMatchObject({ created_status: 'Contratado' })
      expect(await tool(user.token, 'move_application', { id, status: 'take home' })).toMatchObject({ status: 'Take home' })
      // Only the fields sent change.
      expect(await tool(user.token, 'update_application', { id, location: 'Híbrido' })).toMatchObject({
        company: 'Initech',
        title: 'Site Reliability Engineer',
        location: 'Híbrido',
      })

      const document = await createSupabaseStore(user.client, user.userId).load()
      const stored = document?.applications.find((application) => application.id === id)
      expect(stored).toMatchObject({ statusId: 'take-home', location: 'Híbrido' })
      expect(stored?.events.map((event) => event.kind === 'note' ? event.text : event.statusId)).toEqual([
        'sent',
        'Referida por Peter',
        'take-home',
        'Entrega el viernes',
        expect.any(String),
        'take-home',
      ])
    })

    it('keeps a posting in "Analizando propuesta" until the user applies, with what is scheduled', async () => {
      const weighing = await tool(user.token, 'create_application', { stage: 'considering', company: 'Umbrella', title: 'Platform Engineer', posting: 'Kubernetes y Go' })
      expect(weighing).toMatchObject({ created: true, application: { status: 'Analizando propuesta', applied_on: null }, fit: { not_in_experience: expect.arrayContaining(['Kubernetes']) } })
      const id = weighing.application.id

      const call = await tool(user.token, 'schedule_step', { application_id: id, what: 'Call con RRHH', at: '2099-03-01T15:00:00-03:00', kind: 'call' })
      expect(call).toMatchObject({ at: '2099-03-01T18:00:00.000Z', step: 'Analizando propuesta' })
      expect(await tool(user.token, 'move_application', { id, status: 'CV enviado', applied_on: '2026-11-19' })).toMatchObject({ applied_on_recorded: '2026-11-19' })

      const started = await tool(user.token, 'get_started')
      expect(started.agenda.upcoming).toEqual(expect.arrayContaining([expect.objectContaining({ application_id: id, what: 'Call con RRHH' })]))
      const document = await createSupabaseStore(user.client, user.userId).load()
      expect(document?.applicationStatuses[0]).toMatchObject({ name: 'Analizando propuesta', kind: 'considering' })
      expect(document?.applications.find((application) => application.id === id)).toMatchObject({ appliedOn: '2026-11-19', statusId: 'sent' })
    })

    it("never shows one user's applications to another", async () => {
      const stranger = await newUser()
      await openDocument(createSupabaseStore(stranger.client, stranger.userId), () => ({ ...sampleDocument(), applications: [] }))
      const result = await tool(stranger.token, 'search_applications', { text: 'acme' })
      expect(result.total).toBe(0)
    })
  })
})

describe('MCP server — editing anything', () => {
  it('edits the profile and the bank with update_document, and the app reads it back', async () => {
    const user = await newUser()
    await openDocument(createSupabaseStore(user.client, user.userId), () => sampleDocument())
    const result = await tool(user.token, 'update_document', {
      operations: [
        { op: 'replace', path: '/profile/name', value: 'Guido Test' },
        { op: 'add', path: '/profile/jobs/-', value: { company: 'S64', roles: [{ title: 'Tech Lead', start: '2023', end: 'Actualidad' }] } },
        { op: 'add', path: '/bank/-', value: { category: 'Leadership', text: 'Lideré un equipo de 6 personas', skills: ['Leadership'] } },
      ],
    })
    expect(result).toMatchObject({ saved: true, warnings: [] })
    const document = await createSupabaseStore(user.client, user.userId).load()
    expect(document?.profile.name).toBe('Guido Test')
    expect(document?.profile.jobs.at(-1)).toMatchObject({ company: 'S64', roles: [{ title: 'Tech Lead' }] })
    expect(document?.bank.some((item) => item.text === 'Lideré un equipo de 6 personas')).toBe(true)
  })
})
