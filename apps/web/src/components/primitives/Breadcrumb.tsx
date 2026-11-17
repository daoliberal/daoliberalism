import { Anchor } from "./Anchor";
import styles from "./Breadcrumb.module.css";

/** Hrefs must be internal routes or `safeHref` output; labels render as text only. */
type Props = { trail: { label: string; href?: string }[] };

export function Breadcrumb({ trail }: Props) {
  return (
    <nav aria-label="Breadcrumb" className={styles.nav}>
      {trail.map((item, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={i}>
            {i > 0 && " / "}
            {item.href && !last ? (
              <Anchor href={item.href}>{item.label}</Anchor>
            ) : (
              <span aria-current={last ? "page" : undefined}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
