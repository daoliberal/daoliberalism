import type { Parsed } from "@/lib/validation";
import type { AgentRegistrationFile, DaoMetadata, TreasuryMetadata } from "./types";

export const LIMITS = { dataUriBytes: 8 * 1024, name: 80, description: 500, website: 200 };

const fail = { ok: false } as const;
const EIP8004_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

const STRIP = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\u200E\u200F\u200B-\u200D\u2060\uFEFF\u2028\u2029\u061C]/g;

export function sanitizeText(s: string, maxCodePoints: number): string {
  return Array.from(s.replace(STRIP, "").normalize("NFC")).slice(0, maxCodePoints).join("");
}

export function safeHref(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const s = uri.trim();
  if (!/^https?:\/\//i.test(s)) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.username || u.password) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

export function displayHost(uri: string): string {
  const h = safeHref(uri);
  return h ? new URL(h).host : sanitizeText(uri, 80);
}

export function decodeDataUriJson(uri: string): Parsed<unknown> {
  try {
    if (uri.length > LIMITS.dataUriBytes) return fail;
    const m = /^data:application\/json(;[^,]*)?,(.*)$/is.exec(uri);
    if (!m) return fail;
    const params = (m[1] ?? "").toLowerCase();
    const body = m[2] ?? "";
    let text: string;
    if (params.split(";").includes("base64")) {
      const bin = atob(body);
      text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } else {
      text = decodeURIComponent(body);
    }
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return fail;
  }
}

function encodeJson(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:application/json;base64,${btoa(bin)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const n = sanitizeText(v, LIMITS.name);
  return n.trim() === "" ? undefined : n;
}

const MAX_SERVICES = 32;
function cleanServices(v: unknown): NonNullable<AgentRegistrationFile["services"]> {
  if (!Array.isArray(v)) return [];
  const out: NonNullable<AgentRegistrationFile["services"]> = [];
  for (const item of v) {
    if (out.length >= MAX_SERVICES) break;
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.endpoint !== "string") continue;
    const name = sanitizeText(item.name, LIMITS.name);
    const endpoint = sanitizeText(item.endpoint, LIMITS.website);
    if (name === "" || endpoint === "") continue;
    const svc: { name: string; endpoint: string; version?: string } = { name, endpoint };
    if (typeof item.version === "string") svc.version = sanitizeText(item.version, LIMITS.name);
    out.push(svc);
  }
  return out;
}

export function parseAgentMetadata(json: unknown): Parsed<AgentRegistrationFile> {
  if (!isRecord(json)) return fail;
  const name = cleanName(json.name);
  if (name === undefined) return fail;
  const value: AgentRegistrationFile = { ...json, name };
  if ("description" in json) {
    if (typeof json.description === "string") value.description = sanitizeText(json.description, LIMITS.description);
    else delete value.description;
  }
  for (const k of ["type", "image"] as const) {
    if (k in json) {
      if (typeof json[k] === "string") value[k] = sanitizeText(json[k], LIMITS.website);
      else delete value[k];
    }
  }
  if ("x402Support" in json) value.x402Support = json.x402Support === true;
  if ("active" in json) value.active = typeof json.active === "boolean" ? json.active : true;
  if ("services" in json) value.services = cleanServices(json.services);
  if ("registrations" in json) value.registrations = Array.isArray(json.registrations) ? json.registrations : [];
  if ("supportedTrust" in json) {
    value.supportedTrust = Array.isArray(json.supportedTrust)
      ? json.supportedTrust.filter((x): x is string => typeof x === "string").map((x) => sanitizeText(x, LIMITS.name))
      : [];
  }
  return { ok: true, value };
}

export function parseDaoMetadata(json: unknown): Parsed<DaoMetadata> {
  if (!isRecord(json)) return fail;
  const name = cleanName(json.name);
  if (name === undefined) return fail;
  const value: DaoMetadata = {
    name,
    description: typeof json.description === "string" ? sanitizeText(json.description, LIMITS.description) : "",
  };
  if (typeof json.website === "string" && json.website.trim() !== "") {
    value.website = sanitizeText(json.website, LIMITS.website);
  }
  return { ok: true, value };
}

export function parseTreasuryMetadata(json: unknown): Parsed<TreasuryMetadata> {
  if (!isRecord(json)) return fail;
  const name = cleanName(json.name);
  if (name === undefined) return fail;
  return {
    ok: true,
    value: {
      name,
      description: typeof json.description === "string" ? sanitizeText(json.description, LIMITS.description) : "",
    },
  };
}

export function buildAgentMetadata(input: {
  name: string;
  description?: string;
  services?: AgentRegistrationFile["services"];
}): AgentRegistrationFile {
  const f: AgentRegistrationFile = {
    type: EIP8004_TYPE,
    name: input.name,
    services: input.services ?? [],
    x402Support: false,
    active: true,
    registrations: [],
    supportedTrust: [],
  };
  if (input.description) f.description = input.description;
  return f;
}

export function encodeDaoMetadata(m: DaoMetadata): string {
  const o: DaoMetadata = { name: m.name, description: m.description };
  if (m.website) o.website = m.website;
  return encodeJson(o);
}
export function decodeDaoMetadata(uri: string): Parsed<DaoMetadata> {
  const r = decodeDataUriJson(uri);
  return r.ok ? parseDaoMetadata(r.value) : fail;
}
export function encodeTreasuryMetadata(m: TreasuryMetadata): string {
  return encodeJson({ name: m.name, description: m.description });
}
export function decodeTreasuryMetadata(uri: string): Parsed<TreasuryMetadata> {
  const r = decodeDataUriJson(uri);
  return r.ok ? parseTreasuryMetadata(r.value) : fail;
}

/**
 * ERC-8004 registration file as a `data:` URI. Always writes type, name, description, services, x402Support, active,
 * registrations and supportedTrust (a missing description becomes ""). Throws RangeError above the 8 KiB cap, so the
 * result always decodes again with `decodeDataUriJson`.
 */
export function encodeAgentMetadata(m: AgentRegistrationFile): string {
  const uri = encodeJson({
    ...m,
    type: m.type ?? EIP8004_TYPE,
    name: m.name,
    description: m.description ?? "",
    services: m.services ?? [],
    x402Support: m.x402Support ?? false,
    active: m.active ?? true,
    registrations: m.registrations ?? [],
    supportedTrust: m.supportedTrust ?? [],
  });
  if (uri.length > LIMITS.dataUriBytes) throw new RangeError("Agent metadata is larger than 8 KiB.");
  return uri;
}
