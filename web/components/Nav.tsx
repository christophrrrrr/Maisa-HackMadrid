"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function IconHome() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11l8-7 8 7v9H4zM9 20v-6h6v6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconProcess() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v14H4zM4 9h16M9 9v10" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconReview() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5h14v14H5zM8 9h8M8 12h8M8 15h5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconProviders() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V7l8-3v16M12 9h8v11M7 9h2M7 13h2M7 17h2M15 13h2M15 17h2M3 20h18" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconInsights() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V5M4 19h16M8 16v-5M13 16V7M18 16v-3" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h8M16 17h4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14 5v4M7 10v4M12 15v4" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

type Tab = { href: string; label: string; Icon: () => React.JSX.Element; badge?: number };

const WORK: Tab[] = [
  { href: "/", label: "Inicio", Icon: IconHome },
  { href: "/process", label: "Procesar", Icon: IconProcess },
  { href: "/review", label: "Revisión", Icon: IconReview },
];

const RECORDS: Tab[] = [
  { href: "/history", label: "Historial", Icon: IconHistory },
  { href: "/providers", label: "Proveedores", Icon: IconProviders },
];

const REPORTING: Tab[] = [
  { href: "/insights", label: "Análisis", Icon: IconInsights },
];

export default function Nav({ reviewCount = 0 }: { reviewCount?: number }) {
  const path = usePathname();

  function tab(t: Tab) {
    const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
    const badge = t.href === "/review" ? reviewCount : t.badge;
    return (
      <Link key={t.href} href={t.href} className={active ? "active" : ""}>
        <t.Icon />
        <span className="nav-label">{t.label}</span>
        {badge != null && badge > 0 && <span className="nav-badge">{badge}</span>}
      </Link>
    );
  }

  return (
    <>
      <Link href="/" className="brand" aria-label="Factu, inicio">Factu</Link>
      <nav className="nav" aria-label="Navegación principal">
        <div className="nav-section">
          <div className="nav-section-title">Trabajo</div>
          {WORK.map(tab)}
        </div>
        <div className="nav-section">
          <div className="nav-section-title">Registros</div>
          {RECORDS.map(tab)}
        </div>
        <div className="nav-section">
          <div className="nav-section-title">Informes</div>
          {REPORTING.map(tab)}
        </div>
        <div className="nav-spacer" />
        {tab({ href: "/settings", label: "Configuración", Icon: IconSettings })}
      </nav>
    </>
  );
}
