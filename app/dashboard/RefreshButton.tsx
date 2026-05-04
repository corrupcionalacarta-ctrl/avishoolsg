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
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold uppercase tracking-wider transition-colors"
      style={{
        backgroundColor: loading ? '#1a1b23' : '#1e1f27',
        border: '1px solid #434655',
        color: loading ? '#8e90a0' : '#b7c4ff',
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 16,
          animation: loading ? 'spin 1s linear infinite' : 'none',
        }}
      >
        refresh
      </span>
      {loading ? 'Actualizando…' : 'Actualizar'}
    </button>
  )
}
