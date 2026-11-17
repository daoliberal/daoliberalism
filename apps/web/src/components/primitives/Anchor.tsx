import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "style"> & { href: string; className?: string };

/**
 * Anchor for primitives: internal routes (`/…`) go through next/link so navigation stays client-side (the in-memory mock
 * state survives it); everything else is a plain `<a>` with `rel="noopener noreferrer"` (same tab: the prototype sets no target) (the one place
 * that enforces it). Hrefs must be internal routes, `safeHref` output or `explorerUrl` output.
 */
export function Anchor({ href, ...rest }: Props) {
  if (href.startsWith("/") && !href.startsWith("//")) return <Link href={href} {...rest} />;
  return <a {...rest} href={href} rel="noopener noreferrer" />;
}
