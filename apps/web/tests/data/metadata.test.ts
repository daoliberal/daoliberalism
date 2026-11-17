import { describe, expect, expectTypeOf, it } from "vitest";
import {
  LIMITS, buildAgentMetadata, decodeDaoMetadata, decodeDataUriJson, decodeTreasuryMetadata, displayHost,
  encodeAgentMetadata, encodeDaoMetadata, encodeTreasuryMetadata, parseAgentMetadata, parseDaoMetadata, parseTreasuryMetadata,
  safeHref, sanitizeText,
} from "@/data/metadata";
import { ActionError, isConfigurable } from "@/data/types";
import type { ActionErrorCode, ActionRequest, ConfigurableTreasury, ExternalTreasury, Treasury } from "@/data/types";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const jsonUri = (o: unknown) => `data:application/json;base64,${b64(JSON.stringify(o))}`;

describe("agent metadata", () => {
  it("accepts a name and preserves unknown fields", () => {
    expect(parseAgentMetadata({ name: "Atlas‑7" })).toEqual({ ok: true, value: { name: "Atlas‑7" } });
    const r = parseAgentMetadata({ name: "A", custom: { x: 1 } });
    expect(r.ok && r.value.custom).toEqual({ x: 1 });
  });
  it("rejects missing, empty and non-string names", () => {
    expect(parseAgentMetadata({})).toEqual({ ok: false });
    expect(parseAgentMetadata({ name: "" })).toEqual({ ok: false });
    expect(parseAgentMetadata({ name: 5 })).toEqual({ ok: false });
    expect(parseAgentMetadata(null)).toEqual({ ok: false });
    expect(parseAgentMetadata([])).toEqual({ ok: false });
  });
  it("builds an ERC-8004 registration file that parses", () => {
    const f = buildAgentMetadata({ name: "Ox‑Relay" });
    expect(f.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(f.x402Support).toBe(false);
    expect(f.active).toBe(true);
    expect(f.services).toEqual([]);
    expect(parseAgentMetadata(f).ok).toBe(true);
  });
});

describe("dao metadata", () => {
  it("round-trips", () => {
    const m = { name: "Coral Desk", description: "A desk.", website: "https://x.example" };
    const uri = encodeDaoMetadata(m);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    expect(decodeDaoMetadata(uri)).toEqual({ ok: true, value: m });
  });
  it("omits an empty website key", () => {
    const uri = encodeDaoMetadata({ name: "A", description: "", website: "" });
    const raw = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8"));
    expect("website" in raw).toBe(false);
  });
  it("keeps UTF-8 intact", () => {
    const m = { name: "Çay Kulübü 🍵", description: "İyi günler" };
    expect(decodeDaoMetadata(encodeDaoMetadata(m))).toEqual({ ok: true, value: m });
  });
  it("cannot decode non data: URIs", () => {
    expect(decodeDaoMetadata("https://example.com/m.json")).toEqual({ ok: false });
    expect(parseDaoMetadata({ name: "" })).toEqual({ ok: false });
  });
});

describe("treasury metadata", () => {
  const m = { name: "Tidewater", description: "Low overhead, two-week hold, equal shares for every member." };
  it("round-trips", () => {
    expect(decodeTreasuryMetadata(encodeTreasuryMetadata(m))).toEqual({ ok: true, value: m });
  });
  it("validates", () => {
    expect(parseTreasuryMetadata({})).toEqual({ ok: false });
    expect(parseTreasuryMetadata({ name: "" })).toEqual({ ok: false });
    expect(parseTreasuryMetadata({ name: 5 })).toEqual({ ok: false });
    expect(parseTreasuryMetadata({ name: "T" })).toEqual({ ok: true, value: { name: "T", description: "" } });
  });
  it("drops extra keys", () => {
    expect(parseTreasuryMetadata({ name: "T", description: "d", extra: 1 })).toEqual({
      ok: true, value: { name: "T", description: "d" },
    });
  });
});

describe("types", () => {
  it("covers every ActionRequest kind and the 16 error codes", () => {
    const reqs = [
      { kind: "registerAgent", agentKey: "0x1", metadataURI: "u" },
      { kind: "updateAgent", agentId: 1n, agentKey: "0x1" },
      { kind: "joinDao", daoId: 1n, agentId: 1n },
      { kind: "createDao", metadataURI: "u", founderAgentId: 1n, treasury: "0x1" },
      { kind: "deployTreasury", config: { feeBps: 1, expenseBps: 1, holdPeriod: 1, maxAgents: 1, splitRule: "0x1" }, metadataURI: "u" },
      { kind: "claim", receiptKeys: [] },
      { kind: "spend", treasury: "0x1", to: "0x2", amount: 1n },
    ] as const satisfies readonly ActionRequest[];
    expect(new Set(reqs.map((r) => r.kind)).size).toBe(7);
    expectTypeOf<ActionRequest["kind"]>().toEqualTypeOf<
      "registerAgent" | "updateAgent" | "joinDao" | "createDao" | "deployTreasury" | "claim" | "spend"
    >();
    expectTypeOf<ActionErrorCode>().toEqualTypeOf<
      | "NotFounder" | "AdmissionDenied" | "AlreadyMember" | "NotMember" | "NotAgentOwner" | "AgentNotFound"
      | "MemberCapReached" | "BpsTooHigh" | "InvalidSplitRule" | "InsufficientAccrued" | "NothingToClaim"
      | "TreasuryNotRegistered" | "ZeroAmount" | "ZeroAddress" | "Rejected" | "Unknown"
    >();
    const e = new ActionError("NotFounder", "no");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("NotFounder");
  });
  it("isConfigurable narrows by kind", () => {
    const base = { address: "0x1", deployedAt: 0n, seatsUsed: 0, daoCount: 0, volume: 0n, metadata: { name: "n", description: "" } } as const;
    const ext = { ...base, kind: "external" } as ExternalTreasury;
    const cfg = {
      ...base, kind: "configurable", founder: "0x2", metadataURI: "u",
      config: { feeBps: 1, expenseBps: 1, holdPeriod: 1, maxAgents: 1, splitRule: "0x3" },
    } as ConfigurableTreasury;
    const list: Treasury[] = [ext, cfg];
    expect(list.filter(isConfigurable)).toEqual([cfg]);
    const t: Treasury = cfg;
    if (isConfigurable(t)) expectTypeOf(t).toEqualTypeOf<ConfigurableTreasury>();
    expect(isConfigurable(ext)).toBe(false);
  });
});

describe("untrusted metadata (C2)", () => {
  it.each([
    "javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "ipfs://bafy123",
    "//evil.example", "https://u:p@x.example", "",
  ])("safeHref rejects %s", (u) => expect(safeHref(u)).toBeUndefined());
  it("safeHref allows http(s)", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("https://x.example/a")).toBe("https://x.example/a");
    expect(safeHref("HTTP://X.example")).toBeDefined();
  });
  it("displayHost", () => {
    expect(displayHost("https://x.example/a")).toBe("x.example");
    expect(displayHost("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(displayHost("x".repeat(200))).toBe("x".repeat(80));
  });
  it("rejects non-JSON media types and oversize payloads", () => {
    expect(decodeDaoMetadata(`data:text/html;base64,${b64("<b>x</b>")}`)).toEqual({ ok: false });
    expect(decodeDaoMetadata(`data:image/svg+xml;base64,${b64("<svg/>")}`)).toEqual({ ok: false });
    const big = jsonUri({ name: "A", description: "x".repeat(20 * 1024) });
    expect(decodeDaoMetadata(big)).toEqual({ ok: false });
    expect(decodeDataUriJson(big)).toEqual({ ok: false });
  });
  it("never throws on bad base64 / json", () => {
    expect(decodeDaoMetadata("data:application/json;base64,@@@")).toEqual({ ok: false });
    expect(decodeDaoMetadata(`data:application/json;base64,${b64("{nope")}`)).toEqual({ ok: false });
    expect(decodeTreasuryMetadata("data:application/json,%E0%A4%A")).toEqual({ ok: false });
  });
  it("decodes percent-encoded JSON", () => {
    expect(decodeDataUriJson(`data:application/json,${encodeURIComponent('{"a":1}')}`)).toEqual({ ok: true, value: { a: 1 } });
  });
  it("strips bidi and control characters, NFC", () => {
    expect(sanitizeText("a‮b\u0007c⁦d‏e", 80)).toBe("abcde");
    expect(sanitizeText("é", 80)).toBe("é");
    const r = parseDaoMetadata({ name: "Evil‮gnp.exe", description: "" });
    expect(r.ok && r.value.name).toBe("Evilgnp.exe");
  });
  it("truncates by code points", () => {
    expect(Array.from(sanitizeText("😀".repeat(100), 80))).toHaveLength(80);
    const d = parseDaoMetadata({ name: "n".repeat(200), description: "d".repeat(900) });
    expect(d.ok && Array.from(d.value.name).length).toBe(LIMITS.name);
    expect(d.ok && Array.from(d.value.description).length).toBe(LIMITS.description);
    const t = parseTreasuryMetadata({ name: "n".repeat(200), description: "d".repeat(900) });
    expect(t.ok && Array.from(t.value.name).length).toBe(80);
    expect(t.ok && Array.from(t.value.description).length).toBe(500);
    const a = parseAgentMetadata({ name: "n".repeat(200), description: "d".repeat(900) });
    expect(a.ok && Array.from(a.value.name).length).toBe(80);
    expect(a.ok && Array.from(a.value.description ?? "").length).toBe(500);
  });
  it("rejects names that are only control characters", () => {
    expect(parseDaoMetadata({ name: "‮\u0007" })).toEqual({ ok: false });
    expect(parseAgentMetadata({ name: "‮" })).toEqual({ ok: false });
    expect(parseTreasuryMetadata({ name: "\u0000" })).toEqual({ ok: false });
  });
});

describe("fix round 1: known-field validation and hardening", () => {
  const ok = (j: unknown) => {
    const r = parseAgentMetadata(j);
    if (!r.ok) throw new Error("expected ok");
    return r.value;
  };
  it("drops a non-array services", () => {
    expect(ok({ name: "A", services: "notarray" }).services).toEqual([]);
  });
  it("drops invalid service items, sanitises and caps the rest", () => {
    const v = ok({
      name: "A",
      services: [
        { name: 5, endpoint: {} },
        { name: "A2A", endpoint: "https://x.example", version: 3 },
        { name: "MCP‮", endpoint: "https://y.example", version: "1.0" },
        "str",
        null,
      ],
    });
    expect(v.services).toEqual([
      { name: "A2A", endpoint: "https://x.example" },
      { name: "MCP", endpoint: "https://y.example", version: "1.0" },
    ]);
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `s${i}`, endpoint: "https://x.example" }));
    expect(ok({ name: "A", services: many }).services).toHaveLength(32);
    const long = ok({ name: "A", services: [{ name: "n".repeat(500), endpoint: "e".repeat(900) }] }).services![0]!;
    expect(Array.from(long.name).length).toBeLessThanOrEqual(LIMITS.name);
    expect(Array.from(long.endpoint).length).toBeLessThanOrEqual(LIMITS.website);
  });
  it("coerces booleans to real booleans or defaults", () => {
    const v = ok({ name: "A", x402Support: "yes", active: 1 });
    expect(v.x402Support).toBe(false);
    expect(v.active).toBe(true);
    const w = ok({ name: "A", x402Support: true, active: false });
    expect(w.x402Support).toBe(true);
    expect(w.active).toBe(false);
  });
  it("keeps image/type only when strings; drops non-arrays", () => {
    const v = ok({ name: "A", image: 5, type: {}, registrations: "x", supportedTrust: {} });
    expect(v.image).toBeUndefined();
    expect(v.type).toBeUndefined();
    expect(v.registrations).toEqual([]);
    expect(v.supportedTrust).toEqual([]);
    const w = ok({ name: "A", image: "ipfs://bafy", registrations: [1], supportedTrust: ["reputation", 2] });
    expect(w.image).toBe("ipfs://bafy");
    expect(w.registrations).toEqual([1]);
    expect(w.supportedTrust).toEqual(["reputation"]);
  });
  it("still keeps unknown keys", () => {
    expect(ok({ name: "A", custom: { x: 1 } }).custom).toEqual({ x: 1 });
  });
  it("safeHref returns the normalised href", () => {
    expect(safeHref("HTTP://X.example")).toBe("http://x.example/");
    expect(safeHref("  https://x.example/a ")).toBe("https://x.example/a");
  });
  it("strips invisible characters; invisible-only name rejected", () => {
    expect(sanitizeText("a​b‌c‍d⁠e﻿f g h؜i", 80)).toBe("abcdefghi");
    expect(parseDaoMetadata({ name: "​‍﻿" })).toEqual({ ok: false });
  });
  it("decodes a payload just under the 8 KiB cap but not over it", () => {
    const mk = (n: number) => jsonUri({ name: "A", description: "", pad: "x".repeat(n) });
    let n = 5000;
    while (mk(n + 4).length <= LIMITS.dataUriBytes) n += 4;
    expect(mk(n).length).toBeLessThanOrEqual(LIMITS.dataUriBytes);
    expect(mk(n).length).toBeGreaterThan(LIMITS.dataUriBytes - 8);
    expect(decodeDaoMetadata(mk(n)).ok).toBe(true);
    expect(decodeDaoMetadata(mk(n + 8))).toEqual({ ok: false });
  });
});

describe("encodeAgentMetadata", () => {
  const decode = (uri: string): Record<string, unknown> => {
    const r = decodeDataUriJson(uri);
    if (!r.ok) throw new Error("not decodable");
    return r.value as Record<string, unknown>;
  };
  it("always carries every registration-file field and round-trips through parseAgentMetadata", () => {
    const uri = encodeAgentMetadata(buildAgentMetadata({ name: "Ox‑Relay", description: "Relays orders." }));
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    const json = decode(uri);
    expect(Object.keys(json).sort()).toEqual(
      ["active", "description", "name", "registrations", "services", "supportedTrust", "type", "x402Support"],
    );
    expect(json).toMatchObject({ name: "Ox‑Relay", description: "Relays orders.", services: [], x402Support: false, active: true, registrations: [], supportedTrust: [] });
    const parsed = parseAgentMetadata(json);
    expect(parsed).toEqual({ ok: true, value: expect.objectContaining({ name: "Ox‑Relay", description: "Relays orders." }) });
  });
  it("writes an empty description when none was given", () => {
    const json = decode(encodeAgentMetadata(buildAgentMetadata({ name: "A" })));
    expect(json.description).toBe("");
  });
  it("keeps non-ASCII text intact", () => {
    const json = decode(encodeAgentMetadata(buildAgentMetadata({ name: "Çelik 🦊", description: "日本語" })));
    expect(json).toMatchObject({ name: "Çelik 🦊", description: "日本語" });
  });
  it("refuses a file above the 8 KiB cap", () => {
    expect(() => encodeAgentMetadata({ ...buildAgentMetadata({ name: "A" }), pad: "x".repeat(9000) })).toThrow(RangeError);
  });
  it("a maximum-length name and description fit under the cap", () => {
    const uri = encodeAgentMetadata(buildAgentMetadata({ name: "𝔸".repeat(LIMITS.name), description: "𝔹".repeat(LIMITS.description) }));
    expect(uri.length).toBeLessThanOrEqual(LIMITS.dataUriBytes);
    expect(decodeAgentRoundTrip(uri)).toBe(true);
  });
});

function decodeAgentRoundTrip(uri: string): boolean {
  const r = decodeDataUriJson(uri);
  return r.ok && parseAgentMetadata(r.value).ok;
}
