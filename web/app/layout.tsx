import "./globals.css";
import type { Metadata } from "next";
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
  title: "Consola de facturas",
  description: "Consola de revisi\u00f3n del pipeline de facturas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <div className="topbar">
          <Nav />
        </div>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
