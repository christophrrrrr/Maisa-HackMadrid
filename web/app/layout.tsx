import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import Nav from "@/components/Nav";
import { getState } from "@/lib/python";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Factu",
  description: "Consola de revisión del pipeline de facturas",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { summary } = getState();
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <Nav reviewCount={summary.ESCALAR} />
          </aside>
          <main className="wrap">{children}</main>
        </div>
      </body>
    </html>
  );
}
