import { fireEvent, screen, within } from "@testing-library/react";
import { t } from "@/oyun/copy/t";

/** Şart panelindeki tek "Şartı değiştir" düğmesiyle diyaloğu açar ve geçiş desteği kartının grubunu açık hâle getirir. */
export async function degistirAcDiyalog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: t("degistir.dugme") }));
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(await within(dlg).findByRole("button", { name: /Kurtarma ve geçiş/ }));
  await within(dlg).findByRole("group", { name: t("setting.gecis_destegi.name") });
  return dlg;
}

export const gecisSec = (k: "kapali" | "kisa_sureli" | "kurtarma_fonuyla"): void => {
  const grup = within(screen.getByRole("dialog")).getByRole("group", { name: t("setting.gecis_destegi.name") });
  fireEvent.click(within(grup).getByRole("button", { name: t(`setting.gecis_destegi.options.${k}`) }));
};
