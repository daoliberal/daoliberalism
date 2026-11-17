import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { drawerOf } from "../helpers/sehirZincirVeri";
import { ayrintilariAc, ayrintilarHazir, mountCanli, packets, state } from "../helpers/canliMount";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Şehir çekmecesi: Ayrıntılar > Genel > sağlık başlığındaki "en kötü şehir" bağlantısı (varsayılan paketlerde 5. şehir) çekmeceyi açar (pencere kapanır). */
const sehirCekmecesiAc = async (): Promise<HTMLElement> => {
  const pencere = await ayrintilarHazir("Genel");
  fireEvent.click(within(pencere).getByRole("button", { name: /En kötü şehir/ }));
  return screen.findByRole("dialog", { name: "Şehir 5" });
};

describe("W9a zincir ve çekmece", () => {
  it("chain_nodes_render_from_snapshot", async () => {
    mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    await waitFor(() => expect(document.querySelectorAll("[data-dugum]")).toHaveLength(6));
    expect(document.querySelector("[data-dugum='un']")!.textContent).toContain("Un değirmeni");
    expect(document.querySelectorAll("[data-kenar]")).toHaveLength(3);
    expect(document.querySelector("[data-dugum='un']")!.getAttribute("data-durum")).toBe("kit");
    expect(document.querySelector("[data-dugum='tekstil']")!.getAttribute("data-durum")).toBe("normal");
  });

  it("scarce_list_links_drawer", async () => {
    const { drawer } = mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    const liste = await screen.findByRole("list", { name: "En kıt halkalar" });
    const ilk = within(liste).getAllByRole("button")[0]!;
    expect(ilk.textContent).toContain("Un değirmeni");
    fireEvent.click(ilk);
    const dlg = await screen.findByRole("dialog", { name: "Un değirmeni" });
    expect(drawer).toHaveBeenCalledWith("r", "sector", "un", 3);
    expect(within(dlg).getByText("Üretici firma sayısı")).toBeTruthy();
    expect(within(dlg).getByText("Girdi")).toBeTruthy();
  });

  it("drawer_links_open_other_drawer", async () => {
    const { drawer } = mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    const dlg = await screen.findByRole("dialog", { name: "Un değirmeni" });
    fireEvent.click(within(dlg).getByRole("button", { name: /Buğday tarlası/ }));
    await waitFor(() => expect(drawer).toHaveBeenLastCalledWith("r", "sector", "tarla_bugday", 3));
  });

  it("drawer_request_does_not_change_week", async () => {
    const { drawer, control } = mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    const hafta = await screen.findByText(t("canli.hafta", { n: 3, toplam: 200 }));
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    await screen.findByRole("dialog");
    expect(drawer).toHaveBeenCalledTimes(1);
    expect(control).not.toHaveBeenCalled();
    expect(hafta.textContent).toBe(t("canli.hafta", { n: 3, toplam: 200 }));
  });

  it("drawer_stale_note_for_old_week", async () => {
    mountCanli([state(), ...packets(3)], { drawer: async (_r, kind, ref) => drawerOf(kind, ref, { stale: true, week: 2 }) });
    await ayrintilariAc("Zincir");
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText(/2\. haftanın verisi/)).toBeTruthy();
  });

  it("drawer_fresh_has_no_stale_note", async () => {
    mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByText("Girdi");
    expect(dlg.textContent).not.toContain("haftanın verisi");
  });

  it("drawer_focus_and_escape", async () => {
    mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    const opener = (await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button") as HTMLElement;
    opener.focus();
    fireEvent.click(opener);
    const dlg = await screen.findByRole("dialog");
    expect(screen.queryByRole("dialog", { name: "Ayrıntılar" })).toBeNull(); // çekmece pencerenin yerine açılır
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Çekmece kapanınca pencere kendiliğinden geri açılmaz; odak pencereyi açan "Ayrıntılar" düğmesine döner.
    expect(screen.queryByRole("dialog", { name: "Ayrıntılar" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ayrıntılar" }));
  });

  it("chain_node_opens_drawer_closes_window_and_returns_focus", async () => {
    const { drawer } = mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    const dugum = document.querySelector("[data-dugum='un']") as SVGElement;
    expect(dugum.getAttribute("role")).toBe("button");
    fireEvent.click(dugum);
    const dlg = await screen.findByRole("dialog", { name: "Un değirmeni" });
    expect(drawer).toHaveBeenCalledWith("r", "sector", "un", 3);
    expect(screen.queryByRole("dialog", { name: "Ayrıntılar" })).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: "Kapat" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ayrıntılar" }));
  });

  it("drawer_error_shows_message_and_closes", async () => {
    mountCanli([state(), ...packets(3)], { drawer: async () => { throw new Error("x"); } });
    await ayrintilariAc("Zincir");
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText(t("cekmece.yuklenemedi"))).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Kapat" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("drawer_ahir_note_key_text", async () => {
    mountCanli([state(), ...packets(3)], { drawer: async (_r, kind, ref) => drawerOf(kind, ref, { title: "Ahır", fields: { label: "Ahır", note_key: "cekmece.ahir_notu" }, note_key: "cekmece.ahir_notu" }) });
    await ayrintilariAc("Zincir");
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText(t("cekmece.ahir_notu"))).toBeTruthy();
  });

  it("city_link_opens_city_drawer", async () => {
    const { drawer } = mountCanli([state(), ...packets(3)]);
    await sehirCekmecesiAc();
    expect(drawer).toHaveBeenCalledWith("r", "city", "4", 3);
  });

  it("city_drawer_top_sectors_show_workers_not_invented_firm_count", async () => {
    mountCanli([state(), ...packets(3)], {
      drawer: async (_r, kind, ref) => drawerOf(kind, ref, { fields: { served: 0.5, top_sectors: [{ sector: "un", label: "Un değirmeni", workers: 12 }, { sector: "firin", label: "Fırın" }] } }),
    });
    const dlg = await sehirCekmecesiAc();
    expect(await within(dlg).findByText("En çok çalışanı olan sektörler")).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "Un değirmeni: 12 çalışan" })).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "Fırın" })).toBeTruthy();
    expect(dlg.textContent).not.toContain("0 firma");
  });

  it("city_drawer_shows_cash_weeks_row_neutral_and_unmeasured_as_olculmuyor", async () => {
    let alan: Record<string, unknown> = { served: 0.5, cash: 5000, cash_weeks: 2.5 };
    mountCanli([state(), ...packets(3)], { drawer: async (_r, kind, ref) => drawerOf(kind, ref, { fields: alan }) });
    const ac = sehirCekmecesiAc;
    const dlg = await ac();
    const satir = (await within(dlg).findByText(t("cekmece.alan.cash_weeks"))).parentElement!;
    expect(satir.textContent).toContain("2,50");
    expect(t("cekmece.alan.cash_weeks")).not.toMatch(/taban/i); // taban kuralı kapalıyken de doğru: yalnız ölçü, modelin uyguladığı taban iddiası yok
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Şehir 5" })).toBeNull());
    alan = { served: 0.5, cash: 5000, cash_weeks: null };
    const dlg2 = await ac();
    const satir2 = (await within(dlg2).findByText(t("cekmece.alan.cash_weeks"))).parentElement!;
    expect(satir2.textContent).toContain(t("canli.gosterge.olculmuyor"));
  });

  it("drawer_link_labels_carry_recipe_quantity", async () => {
    mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    const dlg = await screen.findByRole("dialog", { name: "Un değirmeni" });
    expect(within(dlg).getByRole("button", { name: "Buğday tarlası (miktar 2)" })).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "Fırın (miktar 1)" })).toBeTruthy();
  });

  it("sector_to_firm_to_city_and_lonca_drawers", async () => {
    const drawer = vi.fn(async (_r: string, kind: string, ref: string) => {
      if (kind === "sector") return drawerOf(kind, ref, { fields: { firms: 2, firm_refs: [{ ref: "f1", city: 1, workers: 7 }] } });
      if (kind === "firm") return drawerOf(kind, ref, { title: "Fırın", fields: { city: 1, lonca: "lonca1", workers: 7, ownership: "npc", alive: true } });
      if (kind === "lonca") return drawerOf(kind, ref, { title: "Lonca 1", fields: { members: 5, fee: 0.02, owner: "none", top_sectors: [{ sector: "un", label: "Un değirmeni", firms: 3 }] } });
      return drawerOf(kind, ref);
    });
    mountCanli([state(), ...packets(3)], { drawer });
    await ayrintilariAc("Zincir");
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Bora: 7 çalışan" }));
    const firma = await screen.findByRole("dialog", { name: "Fırın" });
    expect(await within(firma).findByText("Sahiplik")).toBeTruthy();
    expect(within(firma).getByText("yerleşik")).toBeTruthy();
    expect(within(firma).getByRole("button", { name: "Şehrin ayrıntısı: Bora" })).toBeTruthy();
    fireEvent.click(within(firma).getByRole("button", { name: "Loncanın ayrıntısı" }));
    await waitFor(() => expect(drawer).toHaveBeenLastCalledWith("r", "lonca", "lonca1", 3));
    const lonca = await screen.findByRole("dialog", { name: "Lonca 1" });
    expect(await within(lonca).findByText("Üye sayısı")).toBeTruthy();
    expect(within(lonca).getByText("En çok firması olan sektörler")).toBeTruthy();
    expect(within(lonca).getByRole("button", { name: "Un değirmeni: 3 firma" })).toBeTruthy();
  });

  it("chain_edges_have_text_alternative_and_distinct_names", async () => {
    mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Zincir");
    const liste = await screen.findByRole("list", { name: "Zincir bağlantıları" });
    expect(within(liste).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Buğday tarlası → Un değirmeni", "Un değirmeni → Fırın", "Tekstil → Giyim"]);
    const adlar = [...document.querySelectorAll("[role='region'][aria-label], svg[aria-label]")].map((e) => e.getAttribute("aria-label"));
    expect(new Set(adlar).size).toBe(adlar.length);
  });
});
