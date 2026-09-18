"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function IconDecisions() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="9.5" y="4" width="5" height="16" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="16" y="4" width="5" height="16" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconInsights() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4 19h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="7.2" y="11" width="3.2" height="8" rx="0.8" fill="currentColor" />
      <rect x="11.9" y="7" width="3.2" height="12" rx="0.8" fill="currentColor" />
      <rect x="16.6" y="13" width="3.2" height="6" rx="0.8" fill="currentColor" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3.6v1.8M12 18.6v1.8M3.6 12h1.8M18.6 12h1.8M6.1 6.1l1.3 1.3M16.6 16.6l1.3 1.3M17.9 6.1l-1.3 1.3M7.4 16.6l-1.3 1.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

const TABS = [
  { href: "/", label: "Decisiones", Icon: IconDecisions },
  { href: "/insights", label: "An\u00e1lisis", Icon: IconInsights },
  { href: "/settings", label: "Configuraci\u00f3n", Icon: IconSettings },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {TABS.map((t) => {
        const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "active" : ""}>
            <t.Icon />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
