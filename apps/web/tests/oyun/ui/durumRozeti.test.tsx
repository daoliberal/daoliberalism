import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { DurumRozeti } from "@/oyun/ui/DurumRozeti";

afterEach(cleanup);

describe("DurumRozeti (hesaplaniyor / kaydediliyor)", () => {
  it("canli_bolge_her_zaman_vardir_polite_icerik_yokken_bos", () => {
    render(<DurumRozeti hesaplaniyor={false} kaydediliyor={false} />);
    const b = screen.getByRole("status");
    expect(b).toHaveAttribute("aria-live", "polite");
    expect(b).toBeEmptyDOMElement();
  });

  it("hesaplaniyorken_metin_gorunur_kaydediliyorken_kendi_metni", () => {
    const { rerender } = render(<DurumRozeti hesaplaniyor kaydediliyor={false} />);
    expect(screen.getByText(t("hesap.hesaplaniyor"))).toBeVisible();
    rerender(<DurumRozeti hesaplaniyor={false} kaydediliyor />);
    expect(screen.queryByText(t("hesap.hesaplaniyor"))).toBeNull();
    expect(screen.getByText(t("kayit.durum.kaydediliyor"))).toBeVisible();
  });

  it("hareket_nokta_dekoratif_aria_hidden", () => {
    const { container } = render(<DurumRozeti hesaplaniyor kaydediliyor={false} />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
