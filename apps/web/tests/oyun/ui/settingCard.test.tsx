import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingCard } from "@/oyun/ui";

describe("SettingCard", () => {
  it("aktifken disabled:false verir; başlık ve üç etiketli satır çizilir", () => {
    const kids = vi.fn((p: { disabled: boolean; describedBy?: string }) => <div role="group" aria-label="grup" aria-describedby={p.describedBy} />);
    const { container } = render(<SettingCard id="gecis_destegi" state="active">{kids}</SettingCard>);
    expect(kids).toHaveBeenCalledWith(expect.objectContaining({ disabled: false }));
    expect(screen.getByRole("heading", { name: "Geçiş desteği" })).toBeInTheDocument();
    for (const label of ["Bu ne demek", "Oyunda neyi değiştirir", "İpucu"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/Özel firmalar yetişene kadar/)).toBeInTheDocument();
    expect(screen.getByText(/talep karşılama ▲, şehir kasası ▼/)).toBeInTheDocument();
    expect(screen.getByText(/Kurtarma fonuyla \(tavan 28 bin\)/)).toBeInTheDocument();
    expect(container.querySelector("[style]")).toBeNull();
    expect(screen.queryByText(/kayıtlı değil|canlı modelde|kayıtlarda sabit/)).toBeNull();
  });

  it.each([
    ["lock.sabit", /kayıtlarda sabit/],
    ["lock.kayitsiz", /kayıtlı değil/],
    ["lock.canli", /canlı model/],
  ] as const)("kilitliyken (%s) disabled:true, neden görünür ve grup aria-describedby ile betimlenir", (key, re) => {
    const kids = vi.fn((p: { disabled: boolean; describedBy?: string }) => <div role="group" aria-label="grup" aria-describedby={p.describedBy} />);
    render(<SettingCard id="gecis_destegi" state="locked" lockReason={key}>{kids}</SettingCard>);
    expect(kids).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
    expect(screen.getByText(re)).toBeVisible();
    expect(screen.getByRole("group", { description: re })).toBeInTheDocument();
  });

  it("kilitliyken lockReason zorunlu (tür düzeyinde)", () => {
    // @ts-expect-error locked kart neden olmadan çizilemez
    const bad = <SettingCard id="gecis_destegi" state="locked">{() => null}</SettingCard>;
    expect(bad).toBeTruthy();
  });

  it("rozetler çizilir", () => {
    render(<SettingCard id="gecis_destegi" state="active" badges={["today", "unmeasured"]}>{() => null}</SettingCard>);
    expect(screen.getByText("Bugün")).toBeInTheDocument();
    expect(screen.getByText("Ölçülmedi")).toBeInTheDocument();
  });
});
