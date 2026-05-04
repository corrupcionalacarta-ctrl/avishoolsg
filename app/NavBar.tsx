'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/dashboard', icon: 'space_dashboard', label: 'Briefing' },
  { href: '/agenda',    icon: 'calendar_month',  label: 'Agenda'   },
  { href: '/alumnos',   icon: 'school',          label: 'Alumnos'  },
  { href: '/chat',      icon: 'chat',            label: 'Chat'     },
]

export default function NavBar() {
  const path = usePathname()

  return (
    <nav className="fixed bottom-0 w-full z-50 flex justify-around items-center h-16"
      style={{ backgroundColor: '#11131b', borderTop: '1px solid #434655' }}>
      {NAV.map(({ href, icon, label }) => {
        const active = path === href || (href !== '/dashboard' && path.startsWith(href))
        return (
          <Link key={href} href={href}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors"
            style={{ color: active ? '#b7c4ff' : '#434655' }}>
            <span className="material-symbols-outlined"
              style={{
                fontSize: 22,
                fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
              }}>
              {icon}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: active ? '#b7c4ff' : '#434655' }}>
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
