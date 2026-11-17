import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  assertOyunParity,
  expectedLines,
  maskDigits,
  oyunPrototypeText,
  patchPrototype,
  PROTOTYPE_FILE,
  STATE_MARKER,
} from "./oyun-parity";
import { OYUN_EXCEPTIONS, OYUN_SCREENS, type OyunException } from "./exceptions";

const ROWS: [Record<string, unknown>, number][] = [
  [{ screen: "builder", bStep: 0 }, 62],
  [{ screen: "builder", bStep: 1 }, 38],
  [{ screen: "builder", bStep: 2 }, 107],
  [{ screen: "live" }, 77],
  [{ screen: "result" }, 6],
  [{ screen: "runs" }, 12],
  [{ screen: "start" }, 11],
];
const STATE = { screen: "runs" };

const page_ = (lines: string[]) => `<body>${lines.map((l) => `<p>${l.replace(/</g, "&lt;")}</p>`).join("")}</body>`;
const lines = () => expectedLines(STATE, "runs").map((l) => l.text);
async function show(page: Page, html: string) {
  await page.setContent(html);
}
const msg = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (e) {
    return String((e as Error).message);
  }
  return "";
};

test.describe("oyun parity self-test", () => {
  test("marker appears exactly once and row counts are fixed", () => {
    const html = fs.readFileSync(PROTOTYPE_FILE, "utf8");
    expect(html.split(STATE_MARKER).length - 1).toBe(1);
    for (const [state, n] of ROWS) {
      expect(oyunPrototypeText(state).split("\n").filter((l) => l.trim()).length, JSON.stringify(state)).toBe(n);
    }
  });

  test("patchPrototype throws when the marker is missing or duplicated", () => {
    expect(() => patchPrototype("<html></html>", {})).toThrow(/exactly once/);
    expect(() => patchPrototype(`${STATE_MARKER} ${STATE_MARKER}`, {})).toThrow(/exactly once/);
  });

  test("maskDigits", () => {
    expect(maskDigits("%42 ve 1.250 Akçe")).toBe("%# ve #.# Akçe");
  });

  test("page with all lines in order passes", async ({ page }) => {
    await show(page, page_(lines()));
    await assertOyunParity(page, STATE, { screen: "runs" });
  });

  test("a missing line fails naming it", async ({ page }) => {
    const l = lines();
    const gone = l[3]!;
    await show(page, page_(l.filter((_, i) => i !== 3)));
    const m = await msg(() => assertOyunParity(page, STATE, { screen: "runs" }));
    expect(m).toContain(gone);
  });

  test("swapped lines fail with an order error", async ({ page }) => {
    const l = lines();
    [l[4], l[5]] = [l[5]!, l[4]!];
    await show(page, page_(l));
    const m = await msg(() => assertOyunParity(page, STATE, { screen: "runs" }));
    expect(m).toContain("order broken");
  });

  test("different digits still pass", async ({ page }) => {
    // every digit run in the real lines is replaced by a different number (a %42 line shows as %87)
    const swapped = lines().map((x) => x.replace(/\d+/g, (d) => String(Number(d) + 7)));
    await show(page, page_(swapped));
    await assertOyunParity(page, STATE, { screen: "runs" });
  });

  test("omit exception drops the line from the expected set", async ({ page }) => {
    const l = lines();
    const ex: OyunException[] = [{ screen: "runs", kind: "omit", line: l[2]!, reason: "test" }];
    expect(expectedLines(STATE, "runs", undefined, ex).map((x) => x.text)).not.toContain(l[2]);
    await show(page, page_(l.filter((_, i) => i !== 2)));
    // the real exception list has no entry for this line, so the page without it must fail
    expect(await msg(() => assertOyunParity(page, STATE, { screen: "runs" }))).toContain(l[2]!);
  });

  test("strip exception: stripped part may be absent", async () => {
    const l = lines();
    const piece = l[1]!.slice(0, 3);
    const ex: OyunException[] = [{ screen: "runs", kind: "strip", line: piece, reason: "test" }];
    const got = expectedLines(STATE, "runs", undefined, ex).find((x) => x.n === 2)!;
    expect(got.text).toBe(l[1]!.replace(piece, ""));
  });

  test("only: a missing line outside the range passes, inside it fails, order only checked inside", async ({ page }) => {
    const l = lines();
    await show(page, page_(l.filter((_, i) => i !== 5))); // line #6 missing
    await assertOyunParity(page, STATE, { screen: "runs", only: [{ from: 1, to: 3 }] });
    expect(await msg(() => assertOyunParity(page, STATE, { screen: "runs", only: [{ from: 5, to: 8 }] }))).toContain(l[5]!);
    const swapped = [...l];
    // #9/#10 ("Çatallanma ağacı", "Dışa / içe aktar") yer değiştirir. Eskiden 9. ve 10. dizin değişiyordu ("İçe aktar: ..." ve "İçe aktar"): biri ötekinin içinde geçtiği için
    // sıra bozukluğu algılanamıyordu (736a00a şablon sırası değişikliğinden önce de kırmızıydı); iç içe geçmeyen iki satır seçilir.
    [swapped[6], swapped[7]] = [swapped[7]!, swapped[6]!];
    await show(page, page_(swapped));
    await assertOyunParity(page, STATE, { screen: "runs", only: [{ from: 1, to: 6 }] });
    expect(await msg(() => assertOyunParity(page, STATE, { screen: "runs", only: [{ from: 8, to: 11 }] }))).toContain("order broken");
  });

  test("real exceptions: builder step 1 may lack the measurement tail but not the rest of the line", async ({ page }) => {
    const state = { screen: "builder", bStep: 1 };
    const raw = oyunPrototypeText(state).split("\n").filter((l) => l.trim() !== "");
    const tail = /Oynayan seri: S\d+(?: · çöküş ~?\d+(?:\. hafta)?(?:, yumuşak)?)?/;
    expect(raw.filter((l) => tail.test(l)).length).toBeGreaterThan(0);
    const without = raw.map((l) => l.replace(tail, ""));
    await show(page, page_(without));
    await assertOyunParity(page, state, { screen: "builder" });
    // "Bu şablon ... varsayımını" cümlesi artık kayıttan türetilir (istisna kaldırır); satırın geri kalanı hâlâ zorunludur.
    const broken = without.map((l) => l.replace("Ölçüm:", "Ölçek:"));
    await show(page, page_(broken));
    expect(await msg(() => assertOyunParity(page, state, { screen: "builder" }))).toContain("Ölçüm:");
  });

  test("real exceptions: no Oynayan seri leftovers on any builder step, and a page without the fragments passes", async ({ page }) => {
    const tail = /Oynayan seri:.*?(?= Bu şablon|$)/;
    for (const bStep of [0, 1, 2]) {
      const state = { screen: "builder", bStep };
      const exp = expectedLines(state, "builder").map((l) => l.text);
      expect(exp.filter((t) => /Oynayan seri|çöküş ~\d+\. hf\)/.test(t)), `bStep ${bStep}`).toEqual([]);
      const raw = oyunPrototypeText(state).split("\n").filter((l) => l.trim() !== "");
      await show(page, page_(raw.map((l) => l.replace(tail, "").trim()).filter((l) => l !== "")));
      await assertOyunParity(page, state, { screen: "builder" });
    }
  });

  test("real exceptions: live may lack the R shortcut but any other missing line fails", async ({ page }) => {
    const state = { screen: "live" };
    const raw = oyunPrototypeText(state).split("\n").filter((l) => l.trim() !== "");
    expect(raw.some((l) => /, R$/.test(l))).toBe(true);
    await show(page, page_(raw.map((l) => l.replace(/, R$/, ""))));
    await assertOyunParity(page, state, { screen: "live" });
    // a long line is unique on the page; short ones such as "Dünya" also occur inside other lines
    const gone = raw.filter((l) => !/, R$/.test(l)).reduce((a, b) => (b.length > a.length ? b : a));
    await show(page, page_(raw.filter((l) => l !== gone)));
    expect(await msg(() => assertOyunParity(page, state, { screen: "live" }))).toContain(gone);
  });

  test("horizontal overflow fails", async ({ page }) => {
    await show(page, `<body>${lines().map((x) => `<p>${x}</p>`).join("")}<div style="width:3000px;height:4px"></div></body>`);
    expect(await msg(() => assertOyunParity(page, STATE, { screen: "runs" }))).not.toBe("");
  });

  test("every exception has a reason and a known screen", () => {
    expect(OYUN_EXCEPTIONS.length).toBeGreaterThan(0);
    for (const e of OYUN_EXCEPTIONS) {
      expect(e.reason.trim().length, String(e.line)).toBeGreaterThan(5);
      expect(OYUN_SCREENS).toContain(e.screen);
    }
  });
});
