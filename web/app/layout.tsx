import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Nav from "@/components/Nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Consola de decisiones",
  description: "Consola de revisi\u00f3n del pipeline de facturas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body>
        <div className="topbar">
          <Nav />
        </div>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
