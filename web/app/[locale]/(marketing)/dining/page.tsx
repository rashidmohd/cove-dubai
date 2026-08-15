/**
 * Dining.
 *
 * Ported from design/mockups/dining.html: The Loom (all-day dining), the chef's
 * quote, The Atelier (bar and café), and the Chef's Table.
 *
 * The fifth public page. CLAUDE.md's scope list names four, but the arabic-rtl
 * skill says five and a Dining mockup exists — this is it.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Glow, Weave } from '@/components/BrandEffects';
import {
  BodyText,
  QuoteBand,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
  marketingStyles as m,
} from '@/components/marketing';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import styles from './page.module.css';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dining'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dining' });

  return {
    title: t('label'),
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/dining`,
      languages: { en: '/en/dining', ar: '/ar/dining' },
    },
  };
}

export default async function DiningPage({
  params,
}: PageProps<'/[locale]/dining'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('dining');

  return (
    <>
      <Section tone="light">
        <Reveal>
          <SectionLabel>{t('label')}</SectionLabel>
          <SectionHeading as="h1" accent={t('titleAccent')}>
            {t('title')}
          </SectionHeading>
          <BodyText className={styles.intro}>{t('intro')}</BodyText>
        </Reveal>
      </Section>

      {/* --- The Loom --- */}
      <Section tone="linen">
        <div className={styles.venue}>
          <Reveal>
            <div className={styles.venueVisual} data-venue="loom" aria-hidden="true" />
          </Reveal>

          <Reveal delay={120}>
            <p className={styles.venueKind}>{t('loom.kind')}</p>
            <h2 className={styles.venueName}>{t('loom.name')}</h2>
            <SectionHeading accent={t('loom.titleAccent')}>
              {t('loom.title')}
            </SectionHeading>
            <BodyText className={styles.spaced}>{t('loom.body1')}</BodyText>
            <BodyText className={styles.spaced}>{t('loom.body2')}</BodyText>

            <dl className={styles.facts}>
              <Fact label={t('loom.hoursLabel')} value={t('loom.hours')} />
              <Fact label={t('loom.cuisineLabel')} value={t('loom.cuisine')} />
              <Fact label={t('loom.dressLabel')} value={t('loom.dress')} />
            </dl>

            <Link href="/coming-soon" className={m.textLink}>
              {t('loom.cta')}
            </Link>
          </Reveal>
        </div>
      </Section>

      {/* --- Chef's quote --- */}
      <QuoteBand
        quote={t('chef.quote')}
        attribution={`${t('chef.name')} · ${t('chef.role')}`}
      >
        <Weave opacity={0.06} gap={20} />
        <Glow centre width={600} height={300} strength={0.08} />
      </QuoteBand>

      {/* --- The Atelier --- */}
      <Section tone="light">
        <div className={`${styles.venue} ${styles.venueReversed}`}>
          <Reveal>
            <div
              className={styles.venueVisual}
              data-venue="atelier"
              aria-hidden="true"
            />
          </Reveal>

          <Reveal delay={120}>
            <p className={styles.venueKind}>{t('atelier.kind')}</p>
            <h2 className={styles.venueName}>{t('atelier.name')}</h2>
            <SectionHeading accent={t('atelier.titleAccent')}>
              {t('atelier.title')}
            </SectionHeading>
            <BodyText className={styles.spaced}>{t('atelier.body1')}</BodyText>
            <BodyText className={styles.spaced}>{t('atelier.body2')}</BodyText>

            <dl className={styles.facts}>
              <Fact
                label={t('atelier.hoursLabel')}
                value={t('atelier.hours')}
              />
              <Fact
                label={t('atelier.offersLabel')}
                value={t('atelier.offers')}
              />
              <Fact
                label={t('atelier.reservationsLabel')}
                value={t('atelier.reservations')}
              />
            </dl>

            <Link href="/coming-soon" className={m.textLink}>
              {t('atelier.cta')}
            </Link>
          </Reveal>
        </div>
      </Section>

      {/* --- Chef's Table --- */}
      <Section tone="linen" className={styles.private}>
        <Reveal>
          <SectionLabel>{t('private.label')}</SectionLabel>
          <SectionHeading accent={t('private.titleAccent')}>
            {t('private.title')}
          </SectionHeading>
          <h3 className={styles.privateName}>{t('private.name')}</h3>
          <BodyText className={styles.privateBody}>
            {t('private.body')}
          </BodyText>
          <Link href="/coming-soon" className={m.textLink}>
            {t('private.cta')}
          </Link>
        </Reveal>
      </Section>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}
