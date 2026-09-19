import type { FileKind, FileTypeConfig, FileTypeMeta, Policy, WatchConfig } from "./types";

export const DEFAULT_WATCH: WatchConfig = { enabled: false, folder_name: null };

// Keep these in sync with src/policy.py (DEFAULT_FILE_TYPES / FILE_TYPE_META).
// They are only a fallback: the live values come from the backend via /api/policy.
export const DEFAULT_FILE_TYPES: Record<FileKind, FileTypeConfig> = {
  pdf: { enabled: true, vision: true },
  image: { enabled: false, vision: true, max_mb: 12 },
  xml: { enabled: false, facturae: true },
  email: { enabled: false, vision: true },
  docx: { enabled: false, vision: true },
  spreadsheet: { enabled: false, vision: false },
  text: { enabled: false, vision: true },
};

export const DEFAULT_FILE_TYPE_META: Record<FileKind, FileTypeMeta> = {
  pdf: { label: "PDF", exts: [".pdf"], help: "facturas digitales y escaneos" },
  image: { label: "Imagen", exts: [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"], help: "fotos y escaneos sueltos" },
  xml: { label: "XML", exts: [".xml", ".xsig"], help: "FacturaE / UBL" },
  email: { label: "Email", exts: [".eml", ".msg"], help: "correos con o sin adjuntos" },
  docx: { label: "Word", exts: [".docx", ".doc"], help: "documentos de Word" },
  spreadsheet: { label: "Hoja de c\u00e1lculo", exts: [".xlsx", ".xls", ".csv"], help: "Excel / CSV" },
  text: { label: "Texto", exts: [".txt", ".md", ".htm", ".html", ".json"], help: "texto plano / HTML" },
};

export function withFileDefaults(p: Policy): Policy {
  // merge over EVERY kind the backend knows about (plus our local defaults) so a
  // format added in policy.py automatically shows up instead of being dropped.
  const metaKeys = Object.keys(p.file_type_meta ?? DEFAULT_FILE_TYPE_META) as FileKind[];
  const defaultKeys = Object.keys(DEFAULT_FILE_TYPES) as FileKind[];
  const kinds = Array.from(new Set<FileKind>([...defaultKeys, ...metaKeys]));
  const file_types = {} as Record<FileKind, FileTypeConfig>;
  for (const k of kinds) {
    file_types[k] = { ...(DEFAULT_FILE_TYPES[k] ?? { enabled: false }), ...(p.file_types?.[k] ?? {}) };
  }
  return {
    ...p,
    file_types,
    file_type_meta: p.file_type_meta ?? DEFAULT_FILE_TYPE_META,
    watch: { ...DEFAULT_WATCH, ...(p.watch ?? {}) },
  };
}

export function suffixesOf(p: Policy): string[] {
  const out: string[] = [];
  const types = p.file_types ?? DEFAULT_FILE_TYPES;
  const meta = p.file_type_meta ?? DEFAULT_FILE_TYPE_META;
  (Object.keys(types) as FileKind[]).forEach((k) => {
    if (types[k]?.enabled) out.push(...(meta[k]?.exts ?? []));
  });
  return out.length ? out : [".pdf"];
}

export function acceptAttr(p: Policy): string {
  return suffixesOf(p).join(",");
}

export function matchesExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

export function imageMaxMb(p: Policy): number {
  return Number(p.file_types?.image?.max_mb ?? 12) || 12;
}

export function previewKind(name: string): "pdf" | "image" | "xml" | "other" {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if ([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"].some((e) => n.endsWith(e))) return "image";
  if (n.endsWith(".xml") || n.endsWith(".xsig")) return "xml";
  return "other";
}

const DB = "maisa";
const STORE = "kv";
const WATCH_KEY = "watch-dir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWatchHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, WATCH_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadWatchHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(WATCH_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearWatchHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(WATCH_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
  };
  if (!w.showDirectoryPicker) return null;
  try {
    return await w.showDirectoryPicker({ mode: "read" });
  } catch {
    return null;
  }
}

export async function ensureRead(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  const q = h.queryPermission ? await h.queryPermission({ mode: "read" }) : "granted";
  if (q === "granted") return true;
  if (!h.requestPermission) return false;
  return (await h.requestPermission({ mode: "read" })) === "granted";
}

export async function filesFromDir(
  handle: FileSystemDirectoryHandle,
  exts: string[],
  maxImageMb: number,
): Promise<File[]> {
  const out: File[] = [];
  const image = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
  const cap = maxImageMb * 1024 * 1024;
  for await (const [, entry] of handle.entries()) {
    if (entry.kind !== "file") continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    if (!matchesExt(file.name, exts)) continue;
    const lower = file.name.toLowerCase();
    if ([...image].some((e) => lower.endsWith(e)) && file.size > cap) continue;
    out.push(file);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
