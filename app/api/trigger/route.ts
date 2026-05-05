/**
 * POST /api/trigger
 * Dispara un workflow de GitHub Actions via workflow_dispatch.
 * Body: { workflow: 'schoolnet' | 'digest' | 'analizar', inputs?: Record<string,string> }
 */

const GITHUB_OWNER = process.env.GITHUB_OWNER!          // 'corrupcionalacarta-ctrl'
const GITHUB_REPO  = process.env.GITHUB_REPO!            // 'avishoolsg'
const GITHUB_TOKEN = process.env.GITHUB_ACTIONS_TOKEN!   // PAT con permisos actions:write

const WORKFLOW_FILES: Record<string, string> = {
  schoolnet: 'schoolnet.yml',
  digest:    'digest.yml',
  analizar:  'analizar.yml',
}

export async function POST(req: Request) {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return Response.json({ error: 'GitHub Actions no configurado' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({}))
  const { workflow, inputs = {} } = body as { workflow: string; inputs?: Record<string, string> }

  const workflowFile = WORKFLOW_FILES[workflow]
  if (!workflowFile) {
    return Response.json({ error: `Workflow desconocido: ${workflow}` }, { status: 400 })
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[trigger] GitHub API error:', res.status, text)
    return Response.json({ error: 'Error al disparar workflow', detail: text }, { status: res.status })
  }

  return Response.json({ ok: true, workflow, dispatched_at: new Date().toISOString() })
}
