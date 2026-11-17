import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Banner } from "@/oyun/ui";

const TONES = [
  ["ok", "●", "Tamam:"],
  ["warn", "▲", "Uyarı:"],
  ["crisis", "■", "Kriz:"],
  ["neutral", "◆", "Bilgi:"],
] as const;

describe("Banner", () => {
  it("dört ton: ayrı glif, ön ek, ayrı sınıf, role=status", () => {
    const glyphs = new Set<string>();
    const classes = new Set<string>();
    for (const [tone, glyph, prefix] of TONES) {
      const { container, unmount } = render(<Banner tone={tone}>Metin</Banner>);
      const root = screen.getByRole("status");
      expect(root.textContent).toContain(prefix);
      expect(root.textContent!.indexOf(prefix)).toBeLessThan(root.textContent!.indexOf("Metin"));
      const g = container.querySelector('[aria-hidden="true"]');
      expect(g!.textContent).toBe(glyph);
      glyphs.add(g!.textContent!);
      classes.add(root.className);
      expect(container.querySelector("[style]")).toBeNull();
      unmount();
    }
    expect(glyphs.size).toBe(4);
    expect(classes.size).toBe(4);
  });

  it("asItem iken role yok, ön ek ve glif var", () => {
    const { container } = render(<Banner tone="crisis" asItem>Metin</Banner>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent).toContain("Kriz:");
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe("■");
  });
});
