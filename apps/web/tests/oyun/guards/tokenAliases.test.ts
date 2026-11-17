import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TOKENS_SHA256 = "84ae90d10d41fed415f017c8e9b5d7200510f20b6a229340ddefaacb814d22df";
const tokensPath = path.resolve(process.cwd(), "src/styles/tokens.css");
const durumPath = path.resolve(process.cwd(), "src/oyun/ui/durum.module.css");

describe("durum takma adları", () => {
  it("tokens.css plan tabanıyla aynı", () => {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(tokensPath)).digest("hex");
    expect(digest).toBe(TOKENS_SHA256);
  });

  it(".kok içindeki her --durum-* değeri var(--x) ve x tokens.css'te tanımlı (en çok 8 özellik)", () => {
    const css = fs.readFileSync(durumPath, "utf8");
    const block = /\.kok\s*\{([^}]*)\}/.exec(css);
    expect(block).not.toBeNull();
    const props = [...block![1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({ name: m[1], value: m[2].trim() }));
    expect(props.length).toBeGreaterThan(0);
    expect(props.length).toBeLessThanOrEqual(8);
    const tokens = fs.readFileSync(tokensPath, "utf8");
    for (const p of props) {
      expect(p.name.startsWith("--durum-"), p.name).toBe(true);
      const m = /^var\((--[\w-]+)\)$/.exec(p.value);
      expect(m, `${p.name}: ${p.value}`).not.toBeNull();
      expect(tokens.includes(`${m![1]}:`), `${m![1]} tokens.css'te yok`).toBe(true);
    }
    expect(props.map((p) => p.name).sort()).toEqual(
      ["--durum-kriz-bg", "--durum-kriz-fg", "--durum-kriz-kenar", "--durum-ok-bg", "--durum-ok-fg", "--durum-uyari-bg", "--durum-uyari-fg"],
    );
  });
});
