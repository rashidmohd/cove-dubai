/**
 * Wellness — the pool deck and the fitness floor.
 *
 * There is no mockup for this page; it replaces the coming-soon stub the nav
 * pointed at, and follows the Dining page's shape (a venue per section, image
 * and copy alternating) so it reads as the same site. The copy is a
 * PLACEHOLDER describing only what the renders show — no hours, no claims —
 * for the client to replace (docs/project-status.md).
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import {
  BodyText,
  Photo,
  PhotoGallery,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
} from '@/components/marketing';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto } from '@/lib/media';
import type { Photograph, PropertyPhotoName } from '@/lib/media';
import styles from './page.module.css';

/** Pool first, then the fitness floor. Photograph, then its `photos.*` alt. */
const GALLERY = [
  ['pool', 'pool'],
  ['poolTerrace', 'poolTerrace'],
  ['poolDusk', 'poolDusk'],
  ['gymStudio', 'gym'],
  ['gymTreadmills', 'gymTreadmills'],
  ['gymNight', 'gymNight'],
  ['gymWeights', 'gymWeights'],
  ['gym', 'gymEquipment'],
] as const satisfies ReadonlyArray<readonly [PropertyPhotoName, string]>;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/wellness'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'wellness' });

  return {
    title: t('label'),
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/wellness`,
      languages: { en: '/en/wellness', ar: '/ar/wellness' },
    },
  };
}

export default async function WellnessPage({
  params,
}: PageProps<'/[locale]/wellness'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('wellness');
  const tPhoto = await getTranslations('photos');

  const gallery = GALLERY.map(([name, alt]) =>
    propertyPhoto(name, tPhoto(alt)),
  ).filter((photo): photo is Photograph => photo !== null);

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

      {/* --- The Pool --- */}
      <Section tone="linen">
        <div className={styles.venue}>
          <Reveal>
            <div className={styles.venueVisual} data-venue="pool">
              <Photo
                photo={propertyPhoto('poolTerrace', tPhoto('poolTerrace'))}
                sizes="(max-width: 900px) 100vw, 45vw"
              />
            </div>
          </Reveal>

          <Reveal delay={120}>
            <p className={styles.venueKind}>{t('pool.kind')}</p>
            <h2 className={styles.venueName}>{t('pool.name')}</h2>
            <SectionHeading accent={t('pool.titleAccent')}>
              {t('pool.title')}
            </SectionHeading>
            <BodyText className={styles.spaced}>{t('pool.body1')}</BodyText>
            <BodyText className={styles.spaced}>{t('pool.body2')}</BodyText>
          </Reveal>
        </div>
      </Section>

      {/* --- The Fitness Floor --- */}
      <Section tone="light">
        <div className={`${styles.venue} ${styles.venueReversed}`}>
          <Reveal>
            <div className={styles.venueVisual} data-venue="gym">
              <Photo
                photo={propertyPhoto('gymStudio', tPhoto('gym'))}
                sizes="(max-width: 900px) 100vw, 45vw"
              />
            </div>
          </Reveal>

          <Reveal delay={120}>
            <p className={styles.venueKind}>{t('gym.kind')}</p>
            <h2 className={styles.venueName}>{t('gym.name')}</h2>
            <SectionHeading accent={t('gym.titleAccent')}>
              {t('gym.title')}
            </SectionHeading>
            <BodyText className={styles.spaced}>{t('gym.body1')}</BodyText>
            <BodyText className={styles.spaced}>{t('gym.body2')}</BodyText>
          </Reveal>
        </div>
      </Section>

      {/* --- Gallery --- */}
      {gallery.length > 0 ? (
        <Section tone="linen">
          <Reveal>
            <h2 className={styles.galleryTitle}>{t('gallery')}</h2>
            <PhotoGallery photos={gallery} label={t('label')} />
          </Reveal>
        </Section>
      ) : null}
    </>
  );
}
