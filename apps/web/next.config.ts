import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // B5: `NEXT_PUBLIC_OYUN_KAYNAK=tarayici` (model tarayicida). Bayrak tanimsizken de bos dizge olarak SABITLENIR: Next yalniz tanimli degiskenleri
  // derleme zamaninda yerine koyar; sabitlenmezse bayraksiz derleme tarayici kodunu (Worker dahil) ayiklayamaz ve cikti dizinine yazar.
  env: {
    NEXT_PUBLIC_OYUN_KAYNAK: process.env.NEXT_PUBLIC_OYUN_KAYNAK ?? "",
    // B9: olcum kancasi (`src/oyun/tarayici/olcumKancasi.ts`); varsayilan kapali, ayni nedenle bos dizge olarak sabitlenir.
    NEXT_PUBLIC_OYUN_OLCUM: process.env.NEXT_PUBLIC_OYUN_OLCUM ?? "",
  },
};

export default config;
