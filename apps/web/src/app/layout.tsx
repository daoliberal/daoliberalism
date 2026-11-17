import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/500.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "@fontsource/atkinson-hyperlegible-mono/500.css";
import "../styles/tokens.css";
import "../styles/global.css";
import { RouteShell } from "../components/shell/RouteShell";
import { Providers } from "../providers/Providers";

export const metadata: Metadata = {
  title: "daoliberal",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <RouteShell>{children}</RouteShell>
        </Providers>
      </body>
    </html>
  );
}
