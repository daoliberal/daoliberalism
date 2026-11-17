import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Rozet, type RozetKind } from "@/oyun/ui";

const TEXTS: Record<RozetKind, string> = {
  today: "Bugün",
  planned: "Planlanan",
  server: "Sunucu",
  experimental: "Deneysel",
  unmeasured: "Ölçülmedi",
  founderPrinciple: "Kurucunun ilkesi",
  passive: "Modelde henüz yok",
};

describe("Rozet", () => {
  it("her tür metin + aria-hidden glif taşır, glifler ayrıdır", () => {
    const glyphs = new Set<string>();
    for (const kind of Object.keys(TEXTS) as RozetKind[]) {
      const { container, unmount } = render(<Rozet kind={kind} />);
      expect(screen.getByText(TEXTS[kind])).toBeInTheDocument();
      const g = container.querySelector('[aria-hidden="true"]');
      expect(g, kind).not.toBeNull();
      expect(g!.textContent).toBeTruthy();
      glyphs.add(g!.textContent!);
      expect(container.querySelector("[style]")).toBeNull();
      unmount();
    }
    expect(glyphs.size).toBe(7);
  });
});
