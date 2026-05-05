'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function RefreshButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleRefresh = () => {
    setLoading(true)
    router.refresh()
    setTimeout(() => setLoading(false), 1500)
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors"
      style={{
        backgroundColor: loading ? '#f1f5f9' : '#ffffff',
        border: '1px solid #e2e8f0',
        color: loading ? '#94a3b8' : '#1e3a8a',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}
    >
      <span className="material-symbols-outlined"
        style={{ fontSize: 15, animation: loading ? 'spin 1s linear infinite' : 'none' }}>
        refresh
      </span>
      {loading ? 'Actualizando…' : 'Actualizar'}
    </button>
  )
}
