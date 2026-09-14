import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { createAsanaClient, type TaskInput } from './asana.ts'

const input: TaskInput = {
  name: 'Torenscherm Zorgcongres - 20 november 2026 - Noa',
  htmlNotes: '<body><strong>Aanvrager:</strong> Noa</body>',
  plainNotes: 'Aanvrager: Noa',
  projectGid: '111',
  sectionGid: '222',
  assigneeGid: '333',
  customFields: { '900': { date: '2026-11-20' }, '901': 'Noa' },
  subtasks: [],
}

/** Vervangt fetch door een nepserver; geeft de gedane calls terug. */
function stubFetch(route: (path: string, method: string, body: Record<string, unknown>) => { status: number; body: unknown }) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
  const origineel = globalThis.fetch
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://app.asana.com/api/1.0', '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)).data ?? {}) : {}
    calls.push({ path, method, body })
    const r = route(path, method, body)
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } }))
  }) as typeof fetch
  return { calls, herstel: () => { globalThis.fetch = origineel } }
}

const gelukt = { status: 201, body: { data: { gid: '999', permalink_url: 'https://app.asana.com/0/111/999' } } }
const geweigerd = (bericht: string) => ({ status: 400, body: { errors: [{ message: bericht }] } })

Deno.test('taak, kolom en velden worden los gezet', async () => {
  const { calls, herstel } = stubFetch((path, method) => {
    if (path === '/tasks' && method === 'POST') return gelukt
    return { status: 200, body: { data: {} } }
  })
  try {
    const res = await createAsanaClient('pat').createTask(input)
    assertEquals(res.gid, '999')
    assertEquals(res.warnings, [])
    assertEquals(calls.map((c) => `${c.method} ${c.path}`), ['POST /tasks', 'POST /sections/222/addTask', 'PUT /tasks/999'])
    // De beschrijving en de assignee zitten in het aanmaken; de velden in de update.
    assertEquals(calls[0].body.assignee, '333')
    assertEquals(calls[2].body.custom_fields, input.customFields)
  } finally {
    herstel()
  }
})

Deno.test('een geweigerd veld kost niet de hele taak en wordt benoemd', async () => {
  const { herstel } = stubFetch((path, method, body) => {
    if (path === '/tasks' && method === 'POST') return gelukt
    if (method === 'PUT') {
      const velden = (body.custom_fields ?? {}) as Record<string, unknown>
      // Alleen veld 900 wordt geweigerd; de hele set faalt daardoor ook.
      if ('900' in velden) return geweigerd('Invalid field: 900')
      return { status: 200, body: { data: {} } }
    }
    return { status: 200, body: { data: {} } }
  })
  try {
    const res = await createAsanaClient('pat').createTask(input)
    assertEquals(res.gid, '999')
    assertEquals(res.warnings.length, 1)
    assertMatch(res.warnings[0], /velden niet gezet: .*900/)
    // Veld 901 is wél gezet: het geweigerde veld sleept de rest niet mee.
    assertEquals(res.warnings[0].includes('901'), false)
  } finally {
    herstel()
  }
})

Deno.test('geweigerde opmaak → platte beschrijving, taak blijft compleet', async () => {
  const { calls, herstel } = stubFetch((path, method, body) => {
    if (path === '/tasks' && method === 'POST') {
      if (body.html_notes) return geweigerd('html_notes: not valid XML')
      return gelukt
    }
    return { status: 200, body: { data: {} } }
  })
  try {
    const res = await createAsanaClient('pat').createTask(input)
    assertEquals(res.gid, '999')
    assertMatch(res.warnings[0], /platte beschrijving/)
    assertEquals(calls[1].body.notes, input.plainNotes)
    // Kolom en velden worden daarna gewoon gezet.
    assertEquals(calls.map((c) => c.path).includes('/sections/222/addTask'), true)
  } finally {
    herstel()
  }
})

Deno.test('een kapotte kolom blokkeert de velden niet', async () => {
  const { herstel } = stubFetch((path, method) => {
    if (path === '/tasks' && method === 'POST') return gelukt
    if (path === '/sections/222/addTask') return { status: 404, body: { errors: [{ message: 'Not Found' }] } }
    return { status: 200, body: { data: {} } }
  })
  try {
    const res = await createAsanaClient('pat').createTask(input)
    assertEquals(res.warnings.length, 1)
    assertMatch(res.warnings[0], /kolom zetten mislukt \(404/)
  } finally {
    herstel()
  }
})

Deno.test('401 blijft een harde fout', async () => {
  const { herstel } = stubFetch(() => ({ status: 401, body: { errors: [{ message: 'Not Authorized' }] } }))
  try {
    let bericht = ''
    try {
      await createAsanaClient('pat').createTask(input)
    } catch (e) {
      bericht = e instanceof Error ? e.message : String(e)
    }
    assertMatch(bericht, /401: Not Authorized/)
  } finally {
    herstel()
  }
})
