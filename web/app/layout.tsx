import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Alberto · Decision Console",
  description: "Observability & review console for the invoice-decision pipeline",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="topbar">
          <div className="brand">
            Alberto <span>· Decision Console</span>
          </div>
          <nav className="nav">
            <Link href="/">Dashboard</Link>
            <Link href="/decisions">Decisions</Link>
          </nav>
        </div>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
