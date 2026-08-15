/**
 * Shared marketing building blocks.
 *
 * All Server Components except `Reveal`, so the marketing pages ship almost no
 * JavaScript — which is most of how the Core Web Vitals budget in CLAUDE.md
 * gets met.
 */
import type { ReactNode } from 'react';

import styles from './Marketing.module.css';

export { Reveal } from './Reveal';

type Tone = 'light' | 'linen' | 'dark';

const TONE_CLASS: Record<Tone, string> = {
  light: styles.sectionLight as string,
  linen: styles.sectionLinen as string,
  dark: styles.sectionDark as string,
};

export function Section({
  tone = 'light',
  children,
  className,
  id,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      {...(id ? { id } : {})}
      className={[styles.section, TONE_CLASS[tone], className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.inner}>{children}</div>
    </section>
  );
}

/** The gold eyebrow above every section heading. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className={styles.label}>{children}</p>;
}

/**
 * A section heading, optionally with the italic accent phrase the design
 * system treats as a signature.
 */
export function SectionHeading({
  children,
  accent,
  onDark = false,
  as: Tag = 'h2',
}: {
  children: ReactNode;
  accent?: ReactNode;
  onDark?: boolean;
  as?: 'h1' | 'h2';
}) {
  return (
    <Tag
      className={[styles.heading, onDark ? styles.headingOnDark : null]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
      {accent ? (
        <span
          className={[
            styles.headingAccent,
            onDark ? styles.headingAccentOnDark : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {accent}
        </span>
      ) : null}
    </Tag>
  );
}

export function BodyText({
  children,
  onDark = false,
  className,
}: {
  children: ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <p
      className={[styles.body, onDark ? styles.bodyOnDark : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </p>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <p className={styles.kicker}>{children}</p>;
}

export function Stats({
  items,
}: {
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <ul className={styles.stats}>
      {items.map((item) => (
        <li key={item.label}>
          <span className={styles.statNumber}>{item.value}</span>
          <span className={styles.statLabel}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** The full-width dark quote band between sections. */
export function QuoteBand({
  quote,
  attribution,
  children,
}: {
  quote: ReactNode;
  attribution?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={styles.band}>
      {children}
      <blockquote className={styles.bandQuote}>{quote}</blockquote>
      {attribution ? (
        <p className={styles.bandAttribution}>{attribution}</p>
      ) : null}
    </section>
  );
}

export const marketingStyles = styles;
