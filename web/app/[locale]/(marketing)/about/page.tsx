/**
 * About.
 *
 * Ported from design/mockups/about.html: the story, the founders' quote band,
 * the people, the philosophy, and the building.
 *
 * Entirely static — no API calls — so it prerenders in both locales.
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
  Stats,
} from '@/components/marketing';
import { isLocale } from '@/i18n/routing';
import styles from './page.module.css';

const PEOPLE = ['founder', 'design', 'chef'] as const;
const PRINCIPLES = [
  'materials',
  'scale',
  'service',
  'kitchen',
  'light',
] as const;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/about'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });

  return {
    title: t('label'),
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/about`,
      languages: { en: '/en/about', ar: '/ar/about' },
    },
  };
}

export default async function AboutPage({
  params,
}: PageProps<'/[locale]/about'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('about');

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

      {/* --- The story --- */}
      <Section tone="linen">
        <div className={styles.storyGrid}>
          <Reveal>
            <SectionLabel>{t('story.label')}</SectionLabel>
            <SectionHeading accent={t('story.titleAccent')}>
              {t('story.title')}
            </SectionHeading>
          </Reveal>

          <Reveal delay={120}>
            <BodyText>{t('story.body1')}</BodyText>
            <BodyText className={styles.spaced}>{t('story.body2')}</BodyText>
            <BodyText className={styles.spaced}>{t('story.body3')}</BodyText>
            <Stats
              items={[
                {
                  value: t('story.statValue'),
                  label: t('story.statLabel'),
                },
              ]}
            />
          </Reveal>
        </div>
      </Section>

      {/* --- Founders' quote --- */}
      <QuoteBand quote={t('band.quote')} attribution={t('band.attribution')}>
        <Weave opacity={0.06} gap={20} />
        <Glow centre width={600} height={300} strength={0.08} />
      </QuoteBand>

      {/* --- The people --- */}
      <Section tone="light">
        <Reveal>
          <SectionLabel>{t('people.label')}</SectionLabel>
          <SectionHeading accent={t('people.titleAccent')}>
            {t('people.title')}
          </SectionHeading>
        </Reveal>

        <ul className={styles.peopleList}>
          {PEOPLE.map((key, index) => (
            <li key={key}>
              <Reveal delay={index * 120}>
                <article className={styles.person}>
                  <div className={styles.personPortrait} aria-hidden="true" />
                  <p className={styles.personRole}>
                    {t(`people.items.${key}Role`)}
                  </p>
                  <h3 className={styles.personName}>
                    {t(`people.items.${key}Name`)}
                  </h3>
                  <BodyText>{t(`people.items.${key}Body`)}</BodyText>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      {/* --- The philosophy --- */}
      <Section tone="linen">
        <Reveal>
          <SectionLabel>{t('philosophy.label')}</SectionLabel>
          <SectionHeading accent={t('philosophy.titleAccent')}>
            {t('philosophy.title')}
          </SectionHeading>
          <BodyText className={styles.intro}>{t('philosophy.intro')}</BodyText>
        </Reveal>

        <dl className={styles.principles}>
          {PRINCIPLES.map((key, index) => (
            <div key={key} className={styles.principle}>
              <Reveal delay={index * 80}>
                <dt className={styles.principleTitle}>
                  {t(`philosophy.items.${key}Title`)}
                </dt>
                <dd className={styles.principleBody}>
                  {t(`philosophy.items.${key}Body`)}
                </dd>
              </Reveal>
            </div>
          ))}
        </dl>
      </Section>

      {/* --- The building --- */}
      <Section tone="light">
        <div className={styles.buildingGrid}>
          <Reveal>
            <SectionLabel>{t('building.label')}</SectionLabel>
            <SectionHeading accent={t('building.titleAccent')}>
              {t('building.title')}
            </SectionHeading>
            <BodyText className={styles.spaced}>{t('building.body1')}</BodyText>
            <BodyText className={styles.spaced}>{t('building.body2')}</BodyText>

            <dl className={styles.facts}>
              {(['location', 'rooms', 'opening'] as const).map((key) => (
                <div key={key} className={styles.fact}>
                  <dt className={styles.factLabel}>
                    {t(`building.facts.${key}Label`)}
                  </dt>
                  <dd className={styles.factValue}>
                    {t(`building.facts.${key}Value`)}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>

          <Reveal delay={120}>
            <div className={styles.buildingVisual} aria-hidden="true" />
          </Reveal>
        </div>
      </Section>
    </>
  );
}
