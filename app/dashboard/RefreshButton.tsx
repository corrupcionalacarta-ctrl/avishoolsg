'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type WorkflowState = 'idle' | 'dispatching' | 'running' | 'done' | 'error'

type Job = {
  id: string
  label: string
  workflow: 'schoolnet' | 'digest' | 'analizar'
  inputs?: Record<string, string>
  icon: string
  color: string
}

const JOBS: Job[] = [
  { id: 'schoolnet', label: 'SchoolNet',  workflow: 'schoolnet', icon: 'school',       color: '#1e3a8a' },
  { id: 'digest',    label: 'Digest',     workflow: 'digest',    icon: 'summarize',     color: '#d97706' },
  { id: 'analizar',  label: 'Análisis IA', workflow: 'analizar', icon: 'psychology',   color: '#7c3aed' },
]

export default function RefreshButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [states, setStates] = useState<Record<string, WorkflowState>>({})
  const [refreshing, setRefreshing] = useState(false)

  async function trigger(job: Job) {
    setStates(s => ({ ...s, [job.id]: 'dispatching' }))
    try {
      const res = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: job.workflow, inputs: job.inputs ?? {} }),
      })
      if (!res.ok) throw new Error(await res.text())
      setStates(s => ({ ...s, [job.id]: 'running' }))
      // Después de 30s asumimos que terminó y refrescamos la página
      setTimeout(() => {
        setStates(s => ({ ...s, [job.id]: 'done' }))
        router.refresh()
      }, 30_000)
    } catch {
      setStates(s => ({ ...s, [job.id]: 'error' }))
    }
  }

  function handleRefreshPage() {
    setRefreshing(true)
    router.refresh()
    setTimeout(() => setRefreshing(false), 1500)
  }

  function stateIcon(s: WorkflowState) {
    if (s === 'dispatching' || s === 'running') return 'hourglass_top'
    if (s === 'done') return 'check_circle'
    if (s === 'error') return 'error'
    return 'play_arrow'
  }

  function stateColor(s: WorkflowState, base: string) {
    if (s === 'done') return '#0d9488'
    if (s === 'error') return '#ef4444'
    if (s === 'dispatching' || s === 'running') return '#d97706'
    return base
  }

  function stateLabel(s: WorkflowState, label: string) {
    if (s === 'dispatching') return 'Enviando…'
    if (s === 'running') return 'Corriendo…'
    if (s === 'done') return '¡Listo!'
    if (s === 'error') return 'Error'
    return label
  }

  return (
    <div className="relative">
      {/* Botón principal */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors"
        style={{
          backgroundColor: open ? '#eff6ff' : '#ffffff',
          border: `1px solid ${open ? '#bfdbfe' : '#e2e8f0'}`,
          color: '#1e3a8a',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
          {open ? 'close' : 'bolt'}
        </span>
        {open ? 'Cerrar' : 'Actualizar'}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-9 z-50 rounded-xl overflow-hidden min-w-[200px]"
          style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>

          {/* Header */}
          <div className="px-3 py-2 border-b" style={{ borderColor: '#f1f5f9' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#94a3b8' }}>
              Ejecutar en tu PC
            </p>
          </div>

          {/* Jobs */}
          {JOBS.map(job => {
            const s = states[job.id] ?? 'idle'
            const busy = s === 'dispatching' || s === 'running'
            return (
              <button
                key={job.id}
                onClick={() => !busy && trigger(job)}
                disabled={busy}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                <span className="material-symbols-outlined flex-shrink-0"
                  style={{ fontSize: 18, color: stateColor(s, job.color), fontVariationSettings: "'FILL' 1",
                    animation: busy ? 'pulse 1s ease-in-out infinite' : 'none' }}>
                  {s !== 'idle' ? stateIcon(s) : job.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold" style={{ color: '#1e293b' }}>{job.label}</p>
                  <p className="text-[10px]" style={{ color: stateColor(s, '#94a3b8') }}>
                    {stateLabel(s, s === 'idle' ? 'Ejecutar ahora' : '')}
                  </p>
                </div>
              </button>
            )
          })}

          {/* Refresh datos */}
          <div className="border-t px-3 py-2" style={{ borderColor: '#f1f5f9' }}>
            <button
              onClick={handleRefreshPage}
              className="w-full flex items-center gap-2 text-[11px] font-semibold transition-colors"
              style={{ color: '#64748b' }}
            >
              <span className="material-symbols-outlined"
                style={{ fontSize: 14, animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
                refresh
              </span>
              Recargar datos de la app
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
