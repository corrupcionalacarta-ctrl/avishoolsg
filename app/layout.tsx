import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

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
      <body className={`${inter.className} bg-slate-900 text-slate-100 min-h-full antialiased`}>
        {/* Header fijo */}
        <header className="fixed top-0 w-full z-50 flex justify-between items-center px-4 h-14 bg-slate-900 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-white text-sm font-bold">
              A
            </div>
            <h1 className="text-base font-bold text-slate-50 tracking-tight">AVI School</h1>
          </div>
          <Link href="/chat" className="text-slate-400 hover:bg-slate-800 transition-colors p-2 rounded-lg">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chat</span>
          </Link>
        </header>

        {/* Contenido */}
        <main className="pt-14 pb-20 px-4 max-w-lg mx-auto">
          {children}
        </main>

        {/* Bottom nav fijo */}
        <nav className="fixed bottom-0 w-full z-50 flex justify-around items-center h-16 bg-slate-900 border-t border-slate-700">
          <Link href="/dashboard" className="flex flex-col items-center justify-center text-blue-400 gap-0.5">
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>dashboard</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider">Briefing</span>
          </Link>
          <Link href="/chat" className="flex flex-col items-center justify-center text-slate-500 hover:text-blue-300 gap-0.5 transition-colors">
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>chat</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider">Chat</span>
          </Link>
        </nav>
      </body>
    </html>
  );
}
