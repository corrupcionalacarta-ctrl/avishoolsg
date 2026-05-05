'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/dashboard', icon: 'space_dashboard', label: 'Briefing' },
  { href: '/tablero',   icon: 'view_kanban',     label: 'Tablero'  },
  { href: '/chat',      icon: 'chat',            label: 'Chat'     },
]

export default function NavBar() {
  const path = usePathname()

  return (
    <nav className="fixed bottom-0 w-full z-50 flex justify-around items-center h-16"
      style={{ backgroundColor: '#ffffff', borderTop: '1px solid #e2e8f0', boxShadow: '0 -1px 3px rgba(0,0,0,0.06)' }}>
      {NAV.map(({ href, icon, label }) => {
        const active = path === href || (href !== '/dashboard' && path.startsWith(href))
        return (
          <Link key={href} href={href}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors"
            style={{ color: active ? '#1e3a8a' : '#94a3b8' }}>
            <span className="material-symbols-outlined"
              style={{
                fontSize: 22,
                fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
              }}>
              {icon}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: active ? '#1e3a8a' : '#94a3b8' }}>
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
