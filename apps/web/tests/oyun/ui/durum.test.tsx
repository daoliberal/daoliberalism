import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Bos, Hata, Yukleniyor } from "@/oyun/ui";

describe("Durum", () => {
  it("Yukleniyor metin gösterir", () => {
    render(<Yukleniyor />);
    expect(screen.getByRole("status")).toHaveTextContent("Yükleniyor");
  });
  it("Hata: Yeniden dene retry çağırır", () => {
    const retry = vi.fn();
    render(<Hata retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("Hata messageKey ile metin gösterir", () => {
    render(<Hata retry={() => {}} messageKey="card.hint" />);
    expect(screen.getByText("İpucu")).toBeInTheDocument();
  });
  it("Bos messageKey metnini gösterir", () => {
    render(<Bos messageKey="card.what" />);
    expect(screen.getByText("Bu ne demek")).toBeInTheDocument();
  });
});
