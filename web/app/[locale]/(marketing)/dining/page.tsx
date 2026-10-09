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
  Photo,
  PhotoGallery,
  QuoteBand,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
  marketingStyles as m,
} from '@/components/marketing';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto } from '@/lib/media';
import type { Photograph, PropertyPhotoName } from '@/lib/media';
import styles from './page.module.css';

/**
 * The restaurant and the lobby lounge, as a guest would walk through them.
 * Each entry names a photograph and the `photos.*` key of its alt text.
 */
const GALLERY = [
  ['restaurant', 'loom'],
  ['restaurantLong', 'restaurantLong'],
  ['restaurantColumns', 'restaurantColumns'],
  ['restaurantMarble', 'restaurantMarble'],
  ['restaurantHost', 'restaurantHost'],
  ['restaurantCorner', 'restaurantCorner'],
  ['restaurantLength', 'restaurantLength'],
  ['restaurantTables', 'atelier'],
  ['lobby', 'lobby'],
  ['loungeCafe', 'loungeCafe'],
  ['loungeArmchairs', 'loungeArmchairs'],
  ['loungeSofas', 'loungeSofas'],
] as const satisfies ReadonlyArray<readonly [PropertyPhotoName, string]>;

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
          <Link href="/dining/reserve" className={m.textLink}>
            {t('reserveCta')}
          </Link>
        </Reveal>
      </Section>

      {/* --- The Loom --- */}
      <Section tone="linen">
        <div className={styles.venue}>
          <Reveal>
            <div className={styles.venueVisual} data-venue="loom">
              <Photo
                photo={propertyPhoto('restaurant', tPhoto('loom'))}
                sizes="(max-width: 900px) 100vw, 45vw"
              />
            </div>
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
            </Link>{' '}
            <Link
              href={{ pathname: '/dining/reserve', query: { item: 'the-loom' } }}
              className={m.textLink}
            >
              {t('reserveCta')}
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
            <div className={styles.venueVisual} data-venue="atelier">
              <Photo
                photo={propertyPhoto('restaurantTables', tPhoto('atelier'))}
                sizes="(max-width: 900px) 100vw, 45vw"
              />
            </div>
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
          {/* The Chef's Table is by arrangement, so "Enquire" opens the
              table request with it already chosen. */}
          <Link
            href={{ pathname: '/dining/reserve', query: { item: 'chefs-table' } }}
            className={m.textLink}
          >
            {t('private.cta')}
          </Link>
        </Reveal>
      </Section>

      {/* --- Gallery --- */}
      {gallery.length > 0 ? (
        <Section tone="light">
          <Reveal>
            <h2 className={styles.galleryTitle}>{t('gallery')}</h2>
            <PhotoGallery photos={gallery} label={t('label')} />
          </Reveal>
        </Section>
      ) : null}
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
