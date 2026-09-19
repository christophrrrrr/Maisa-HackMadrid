import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Newsreader, Source_Sans_3 } from "next/font/google";
import Nav from "@/components/Nav";

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Otrebla · Consola de facturas",
  applicationName: "Otrebla",
  description: "Otrebla: revisi\u00f3n y seguimiento de decisiones sobre facturas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <div className="topbar">
          <Link href="/" className="brand" aria-label="Otrebla, inicio">Otrebla</Link>
          <Nav />
        </div>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
