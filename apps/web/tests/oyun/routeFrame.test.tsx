import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteShell, routeFor } from "@/components/shell/RouteShell";
import { OyunApp } from "@/oyun/OyunApp";

let pathname = "/oyun/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

// P-04: kaynak seçimi artık asenkron yoklar; bu test dosyası kayıt kaynağıyla çalışır (sunucu yok).
vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

describe("routeFor oyun", () => {
  it("oyun_yollari_bare_doner", () => {
    for (const p of ["/oyun/", "/oyun", "/oyun/tema/", "/oyun/canli"]) expect(routeFor(p), p).toEqual({ variant: "bare" });
  });

  it("oyunlar_bare_degildir_onek_siniri", () => {
    expect(routeFor("/oyunlar").variant).toBe("app");
    expect(routeFor("/oyunlar/").variant).toBe("app");
  });

  it("mevcut_yollar_degismedi", () => {
    const root = { variant: "root" };
    const expected: Record<string, unknown> = {
      "/": { variant: "landing" },
      "/treasuries": { variant: "app", current: "treasuries", mobile: root },
      "/treasuries/new": { variant: "app", current: "treasuries", mobile: root },
      "/treasury": {
        variant: "app",
        current: "treasuries",
        mobile: { variant: "detail", backHref: "/treasuries/", backLabel: "Back to treasuries", title: "Treasury" },
      },
      "/daos": { variant: "app", current: "daos", mobile: root },
      "/daos/new": { variant: "app", current: "daos", mobile: root },
      "/dao": { variant: "app", current: "daos", mobile: root },
      "/agents": { variant: "app", current: "agents", mobile: root },
      "/earnings": { variant: "app", current: "earnings", mobile: root },
    };
    for (const [p, frame] of Object.entries(expected)) expect(routeFor(p), p).toEqual(frame);
  });
});

describe("RouteShell bare", () => {
  it("oyun_yolunda_site_cercevesi_cizilmez", () => {
    pathname = "/oyun/";
    render(
      <RouteShell>
        <p>icerik</p>
      </RouteShell>,
    );
    expect(screen.getByText("icerik")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByText(/Connect wallet/i)).toBeNull();
  });

  it("oyun_app_lang_tr_tasir", () => {
    const { container } = render(<OyunApp />);
    expect(container.querySelector('[lang="tr"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
