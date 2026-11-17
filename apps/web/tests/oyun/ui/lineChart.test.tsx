import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineChart } from "@/oyun/ui";

type S = { id: string; labelKey: "card.what"; values: (number | null)[]; styleIndex: 0 | 1 | 2 | 3 | 4 | 5 };
const series = (values: (number | null)[], styleIndex: S["styleIndex"] = 0, id = "s"): S => ({ id, labelKey: "card.what", values, styleIndex });
const ds = (c: HTMLElement) => [...c.querySelectorAll("path[data-seri]")].map((p) => p.getAttribute("d") ?? "");

describe("LineChart", () => {
  it.each([
    ["boş", []],
    ["yalnız null", [null, null]],
    ["tek nokta", [3]],
    ["200 nokta", Array.from({ length: 200 }, (_, i) => Math.sin(i / 7) * 50)],
    ["delikli", [1, null, 3, 4, null, null, 7]],
    ["NaN/Infinity", [1, Number.NaN, Infinity, 4]],
  ] as [string, (number | null)[]][])("%s: çökmez, NaN yok", (_n, values) => {
    const { container } = render(<LineChart titleKey="card.hint" series={[series(values)]} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("figure figcaption")).not.toBeNull();
    for (const d of ds(container)) expect(d).not.toMatch(/NaN|Infinity/);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("null noktada çizgi kopar (iki parça)", () => {
    const { container } = render(<LineChart titleKey="card.hint" series={[series([1, 2, null, 4, 5])]} />);
    expect((ds(container)[0].match(/M/g) ?? []).length).toBe(2);
  });

  it("svg yalnız viewBox taşır (width/height/renk yok)", () => {
    const { container } = render(<LineChart titleKey="card.hint" series={[series([1, 2])]} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBeTruthy();
    for (const a of ["width", "height", "fill", "stroke"]) expect(svg.hasAttribute(a), a).toBe(false);
  });

  it("altı seri farklı (renk sınıfı, biçim sınıfı) çifti", () => {
    const six = ([0, 1, 2, 3, 4, 5] as const).map((i) => series([1, 2, 3], i, `s${i}`));
    const { container } = render(<LineChart titleKey="card.hint" series={six} />);
    const pairs = [...container.querySelectorAll("path[data-seri]")].map((p) => p.getAttribute("class"));
    expect(pairs).toHaveLength(6);
    expect(new Set(pairs).size).toBe(6);
    expect(container.querySelectorAll("figure li")).toHaveLength(6);
  });

  it("göstergede seri adı ve çizgi biçimi var, renk adı yok", () => {
    const { container } = render(<LineChart titleKey="card.hint" series={[series([1, 2], 1)]} />);
    const text = container.querySelector("li")!.textContent ?? "";
    expect(text).toMatch(/kesik/);
    expect(text).not.toMatch(/yeşil|kahverengi|turuncu|gri|mavi|kırmızı/);
  });

  it("markers: iğne sayısı kadar dikey çizgi ve metin", () => {
    const { container } = render(
      <LineChart
        titleKey="card.hint"
        series={[series(Array.from({ length: 50 }, (_, i) => i))]}
        markers={[
          { week: 10, kind: "event", labelKey: "card.what" },
          { week: 30, kind: "collapse", labelKey: "card.changes" },
          { week: 999, kind: "seam", labelKey: "card.hint" },
        ]}
      />,
    );
    expect(container.querySelectorAll("line[data-isaret]")).toHaveLength(3);
    expect(container.innerHTML).not.toMatch(/NaN/);
    expect(container.textContent).toMatch(/Hf 10/);
  });

  it("yDomain verilince kullanılır", () => {
    const { container } = render(<LineChart titleKey="card.hint" yDomain={[0, 1]} series={[series([0.5, 0.5])]} />);
    expect(ds(container)[0]).not.toMatch(/NaN/);
  });
});
