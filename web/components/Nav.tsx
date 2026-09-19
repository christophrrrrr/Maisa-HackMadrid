"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function IconFacturas() {
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
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <mask id="gear-hole">
        <rect width="24" height="24" fill="#fff" />
        <circle cx="12" cy="12" r="2.5" fill="#000" />
      </mask>
      <g fill="currentColor" mask="url(#gear-hole)">
        {teeth.map((deg) => (
          <rect
            key={deg}
            x="10.2"
            y="1.4"
            width="3.6"
            height="5.4"
            rx="0.7"
            transform={`rotate(${deg} 12 12)`}
          />
        ))}
        <circle cx="12" cy="12" r="6.15" />
      </g>
    </svg>
  );
}

const TABS = [
  { href: "/", label: "Facturas", Icon: IconFacturas },
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
