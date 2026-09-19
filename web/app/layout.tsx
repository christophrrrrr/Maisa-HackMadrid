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
  title: "Otrebla · Consola de facturas",
  applicationName: "Otrebla",
  description: "Otrebla: revisión y seguimiento de decisiones sobre facturas.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { decisions } = getState();
  const reviewDecisions = decisions.filter((decision) => decision.result === "ESCALAR");
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <Nav reviewDecisions={reviewDecisions} />
          </aside>
          <main className="wrap">{children}</main>
        </div>
      </body>
    </html>
  );
}
