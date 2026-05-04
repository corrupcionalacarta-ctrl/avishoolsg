import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "./NavBar";

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
        style={{ backgroundColor: '#11131b', color: '#e2e1ed' }}>

        {/* Header fijo */}
        <header className="fixed top-0 w-full z-50 flex justify-between items-center px-4 h-14"
          style={{ backgroundColor: '#11131b', borderBottom: '1px solid #434655' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: '#1d4ed8' }}>
              <svg viewBox="0 0 64 64" width="20" height="20">
                <rect x="17" y="24" width="30" height="26" rx="8" fill="white"/>
                <rect x="22" y="30" width="8" height="6" rx="2" fill="#1d4ed8"/>
                <rect x="34" y="30" width="8" height="6" rx="2" fill="#1d4ed8"/>
                <rect x="26" y="42" width="12" height="3" rx="1.5" fill="#1d4ed8"/>
              </svg>
            </div>
            <h1 className="text-base font-bold tracking-tight" style={{ color: '#e2e1ed' }}>AVI School</h1>
          </div>
          <span className="text-[12px] font-semibold uppercase tracking-widest px-2 py-1 rounded"
            style={{ backgroundColor: '#1e1f27', color: '#6bd8cb' }}>
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
