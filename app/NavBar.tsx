'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  {
    href: '/dashboard',
    icon: 'wb_sunny',
    label: 'Hoy',
    active: (p: string) => p === '/dashboard' || p === '/',
  },
  {
    href: '/alumnos',
    icon: 'supervised_user_circle',
    label: 'Mis hijos',
    active: (p: string) => p === '/alumnos' || p.startsWith('/dashboard/'),
  },
  {
    href: '/estudiar',
    icon: 'menu_book',
    label: 'Estudiar',
    active: (p: string) => p.startsWith('/estudiar'),
  },
  {
    href: '/correos',
    icon: 'mail',
    label: 'Correos',
    active: (p: string) => p.startsWith('/correos'),
  },
  {
    href: '/chat',
    icon: 'chat_bubble',
    label: 'Preguntar',
    active: (p: string) => p.startsWith('/chat'),
  },
]

export default function NavBar() {
  const path = usePathname()

  return (
    <nav
      className="fixed bottom-0 w-full z-50 flex justify-around items-end pb-safe h-[68px]"
      style={{
        backgroundColor: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        boxShadow: '0 -2px 12px rgba(0,0,0,0.07)',
      }}
    >
      {NAV.map(({ href, icon, label, active }) => {
        const isActive = active(path)
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full pt-2 transition-all"
          >
            {/* Active dot indicator */}
            <span
              className="w-1 h-1 rounded-full mb-0.5 transition-opacity"
              style={{
                backgroundColor: '#1e3a8a',
                opacity: isActive ? 1 : 0,
              }}
            />
            {/* Icon with filled/outlined toggle */}
            <span
              className="material-symbols-outlined transition-all"
              style={{
                fontSize: 22,
                color: isActive ? '#1e3a8a' : '#94a3b8',
                fontVariationSettings: isActive ? "'FILL' 1, 'wght' 600" : "'FILL' 0, 'wght' 400",
              }}
            >
              {icon}
            </span>
            {/* Label */}
            <span
              className="text-[9.5px] font-bold uppercase tracking-wide transition-colors"
              style={{ color: isActive ? '#1e3a8a' : '#94a3b8' }}
            >
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
