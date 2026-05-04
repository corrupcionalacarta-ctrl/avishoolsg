import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AVI School",
  description: "Panel escolar — Clemente y Raimundo Aravena",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className={`${geist.className} bg-gray-50 min-h-full`}>
        <nav className="bg-[#003366] text-white px-6 py-3 flex items-center gap-6 shadow">
          <span className="font-bold text-lg tracking-tight">🏫 AVI School</span>
          <Link href="/dashboard" className="text-sm hover:text-blue-200 transition-colors">Dashboard</Link>
          <Link href="/chat" className="text-sm hover:text-blue-200 transition-colors">Chat</Link>
        </nav>
        <main className="max-w-4xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
