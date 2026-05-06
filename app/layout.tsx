import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "./NavBar";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AVI School",
  description: "Panel escolar — Clemente y Raimundo Aravena",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@400,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.className} min-h-full antialiased`}
        style={{ backgroundColor: '#f0f4f8', color: '#1e293b' }}>

        {/* Header fijo */}
        <header className="fixed top-0 w-full z-50 flex justify-between items-center px-4 h-14"
          style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <Link href="/dashboard" className="flex items-center gap-3 cursor-pointer">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: '#1e3a8a' }}>
              <svg viewBox="0 0 64 64" width="20" height="20">
                <rect x="17" y="24" width="30" height="26" rx="8" fill="white"/>
                <rect x="22" y="30" width="8" height="6" rx="2" fill="#1e3a8a"/>
                <rect x="34" y="30" width="8" height="6" rx="2" fill="#1e3a8a"/>
                <rect x="26" y="42" width="12" height="3" rx="1.5" fill="#1e3a8a"/>
              </svg>
            </div>
            <div>
              <h1 className="text-[15px] font-bold leading-tight tracking-tight" style={{ color: '#1e3a8a' }}>AVI School</h1>
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#d97706' }}>Saint George</p>
            </div>
          </Link>
          <span className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg"
            style={{ backgroundColor: '#fef3c7', color: '#d97706', border: '1px solid #fcd34d' }}>
            {new Date().toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </header>

        {/* Contenido */}
        <main className="pt-14 pb-20 px-4 max-w-lg mx-auto">
          {children}
        </main>

        {/* Bottom nav */}
        <NavBar />
      </body>
    </html>
  );
}
