import { describe, expect, it } from "vitest";
import { cityDisplayName, codePoints, normalizeName } from "@/oyun/lib/names";

describe("names", () => {
  it("normalizeName_kirpar_ve_birlestirir", () => {
    expect(normalizeName("  a \t  b ")).toBe("a b");
  });
  it("codePoints_emoji_tek", () => {
    expect(codePoints("😀😀")).toBe(2);
  });
  it("cityDisplayName_bos_ve_bosluk_yedek_ad_0_tabanli", () => {
    expect(cityDisplayName("", 0)).toBe("Şehir 1");
    expect(cityDisplayName("  \t ", 4)).toBe("Şehir 5");
  });
  it("cityDisplayName_dolu_ad_kirpilmis_doner", () => {
    expect(cityDisplayName("  Ada  Kent ", 2)).toBe("Ada Kent");
  });
});
