"use client";

import { useMemo, useState } from "react";
import type { Decision } from "@/lib/types";
import { reasonLabel } from "@/lib/reasons";
import {
  getIncidentStatus,
  setIncidentStatus,
  type IncidentStatus,
} from "@/lib/incident-status";

function field(d: Decision, key: string): string {
  const value = (d.extracted ?? {})[key];
  return value == null || value === "" ? "No disponible" : String(value);
}

function money(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("es-ES", { style: "currency", currency: "EUR" })
    : value;
}

function checkDetails(d: Decision): string[] {
  return (d.checks ?? [])
    .filter((check) => check.status === "fail")
    .map((check) => {
      const actual = check.actual?.value;
      const expected = check.expected?.value;
      const comparison = actual != null || expected != null
        ? ` (factura: ${actual ?? "no disponible"}; esperado: ${expected ?? "no disponible"})`
        : "";
      return `- ${check.label}: ${check.message}${comparison}`;
    });
}

function buildDraft(d: Decision) {
  const supplier = field(d, "supplier_name");
  const invoice = field(d, "invoice_number");
  const purchaseOrder = field(d, "purchase_order");
  const details = checkDetails(d);
  const subject = `Incidencia en factura ${invoice === "No disponible" ? d.file_id : invoice}`;
  const body = [
    `Hola${supplier === "No disponible" ? "" : `, equipo de ${supplier}`}:`,
    "",
    "Durante la revisión de su factura hemos detectado una incidencia que impide continuar con su tramitación.",
    "",
    `Incidencia: ${reasonLabel(d.reason)}`,
    `Factura: ${invoice}`,
    `Archivo: ${d.file_id}`,
    `Pedido: ${purchaseOrder}`,
    `NIF del proveedor: ${field(d, "supplier_tax_id")}`,
    `Importe total: ${money(field(d, "total"))}`,
    ...(details.length ? ["", "Detalle de la comprobación:", ...details] : []),
    ...(d.detail ? ["", `Información adicional: ${d.detail}`] : []),
    "",
    "Por favor, revisen estos datos y envíen la factura corregida o la documentación necesaria para resolver la incidencia.",
    "",
    "Gracias.",
  ].join("\n");
  return { subject, body };
}

export default function IncidentResolver({ d, onClose }: { d: Decision; onClose: () => void }) {
  const generated = useMemo(() => buildDraft(d), [d]);
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState(generated.subject);
  const [body, setBody] = useState(generated.body);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<IncidentStatus>(() => getIncidentStatus(d));

  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  const encoded = {
    to: encodeURIComponent(recipient.trim()),
    subject: encodeURIComponent(subject),
    body: encodeURIComponent(body),
  };

  const copyMessage = async () => {
    await navigator.clipboard.writeText(`Asunto: ${subject}\n\n${body}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="incident-panel">
      <div className="incident-head">
        <div>
          <div className="section-title">Resolver incidencia</div>
          <p>Mensaje generado con los datos y comprobaciones de la factura.</p>
        </div>
        <button type="button" className="btn ghost sm" onClick={onClose}>Ocultar</button>
      </div>

      <label className="incident-field">
        <span>Email del proveedor</span>
        <input
          className="field"
          type="email"
          placeholder="proveedor@empresa.com"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
        />
      </label>
      <label className="incident-field">
        <span>Asunto</span>
        <input className="field" value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>
      <label className="incident-field">
        <span>Mensaje</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={15} />
      </label>

      <div className="incident-channels">
        <button type="button" className="btn" onClick={copyMessage}>
          {copied ? "Copiado" : "Copiar mensaje"}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => { window.location.href = `mailto:${encoded.to}?subject=${encoded.subject}&body=${encoded.body}`; }}
        >
          App de correo
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encoded.to}&su=${encoded.subject}&body=${encoded.body}`)}
        >
          Gmail
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => open(`https://outlook.office.com/mail/deeplink/compose?to=${encoded.to}&subject=${encoded.subject}&body=${encoded.body}`)}
        >
          Outlook
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => open(`https://wa.me/?text=${encodeURIComponent(`${subject}\n\n${body}`)}`)}
        >
          WhatsApp
        </button>
      </div>
      <label className="incident-status-field">
        <span>Estado de la incidencia</span>
        <select
          className="field"
          value={status}
          onChange={(event) => {
            const next = event.target.value as IncidentStatus;
            setStatus(next);
            setIncidentStatus(d, next);
          }}
        >
          <option value="pending">Pendiente</option>
          <option value="sent">Enviado al proveedor</option>
          <option value="resolved">Resuelto</option>
        </select>
      </label>
    </div>
  );
}
