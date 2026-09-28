/**
 * Home, direction three: "Below".
 *
 * The home page as it is, with one change: the stay search leaves the
 * photograph and sits in its own band directly beneath it. The hero carries
 * only the words, so nothing is laid over the lower third of the image, and
 * the search reads as the first thing on the page rather than as an overlay.
 * The cost is that the search is no longer on the first screen at full height;
 * the hero is cut a little short so the top of the band still shows.
 *
 * A draft for the client to compare — see `preview/page.tsx`. Not indexed, and
 * not linked from the site.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { StaySearch } from '@/components/booking/StaySearch';
import { Weave } from '@/components/BrandEffects';
import { HeroSlideshow } from '@/components/marketing';
import { HomeSections } from '@/components/marketing/HomeSections';
import { bookingApi } from '@/lib/api/client';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto } from '@/lib/media';
import type { Photograph, PropertyPhotoName } from '@/lib/media';
import type { RoomType } from '@/lib/api/types';

import styles from './page.module.css';

/** The same photographs, in the same order, as the home page's hero. */
const HERO_PHOTOS = [
  ['lobby', 'lobby'],
  ['restaurant', 'loom'],
  ['pool', 'pool'],
  ['suiteLounge', 'suiteLounge'],
  ['roomPendant', 'roomInterior'],
] as const satisfies ReadonlyArray<readonly [PropertyPhotoName, string]>;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/preview/below'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'preview' });

  return {
    title: `${t('variants.below.name')} — ${t('title')}`,
    robots: { index: false, follow: false },
  };
}

export default async function BelowPreviewPage({
  params,
}: PageProps<'/[locale]/preview/below'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tPhoto = await getTranslations('photos');

  let roomTypes: RoomType[] = [];
  try {
    roomTypes = await bookingApi.getRoomTypes();
  } catch {
    roomTypes = [];
  }

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.photo}>
          <HeroSlideshow
            photos={HERO_PHOTOS.map(([name, alt]) =>
              propertyPhoto(name, tPhoto(alt)),
            ).filter((photo): photo is Photograph => photo !== null)}
            labels={{ pause: t('heroPause'), play: t('heroPlay') }}
          />
        </div>

        <div className={styles.scrim} aria-hidden="true" />
        <Weave opacity={0.04} gap={22} />

        <div className={styles.inner}>
          <p className={styles.eyebrow}>{t('heroEyebrow')}</p>
          <h1 className={styles.title}>
            {t('heroTitle')}{' '}
            <span className={styles.titleAccent}>{t('heroTitleAccent')}</span>
          </h1>
          <p className={styles.body}>{t('heroBody')}</p>
        </div>
      </section>

      {/* The search, off the photograph. The band takes the scrim's darkest
          stop as its ground, so the image ends without a seam and the search
          keeps the dark tone it was designed in. */}
      <section className={styles.booking}>
        <div className={styles.inner}>
          <StaySearch locale={locale} tone="dark" />
        </div>
      </section>

      <HomeSections locale={locale} roomTypes={roomTypes} />
    </>
  );
}
