/**
 * Home.
 *
 * One photograph at full bleed, the hero line over it, and the stay search
 * resting on the lower third. The bet is that a hotel sells the room before it
 * sells the sentence, so the first screen is the photograph and everything is
 * laid on top of it — and the guest's first question, "do you have my dates",
 * is answered here rather than a page later.
 *
 * Chosen 15 Sep 2026 from three drafts; the other two are still under
 * `(marketing)/preview/`. What was the "Still" draft is now this file.
 *
 * A Server Component, statically rendered in both locales so `/ar` ships real
 * Arabic HTML for search engines rather than an empty shell hydrated later.
 * Metadata is deliberately absent: the locale layout already sets the canonical
 * URL, the language alternates and the default title for exactly this page.
 *
 * Everything below the hero is `components/marketing/HomeSections`, which the
 * remaining drafts share, so a change to the rooms strip or the press band
 * cannot land on one and miss the other.
 */
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

/**
 * The hero's photographs, in order: arrival, dining, the pool, then the two
 * rooms. The lobby leads because it is the LCP image and the one the scrim was
 * tuned against. Each names a photograph and the `photos.*` key of its alt.
 */
const HERO_PHOTOS = [
  ['lobby', 'lobby'],
  ['restaurant', 'loom'],
  ['pool', 'pool'],
  ['suiteLounge', 'suiteLounge'],
  ['roomPendant', 'roomInterior'],
] as const satisfies ReadonlyArray<readonly [PropertyPhotoName, string]>;

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tPhoto = await getTranslations('photos');

  // The API is the only source of room data. If it is unreachable at build time
  // the page still renders; the rooms strip falls back to its link through.
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

        {/* The photograph is not a background image, so the text needs its own
            ground. A gradient rather than a flat wash: the hotel is what the
            guest should see at the top, the words are what they should read at
            the bottom, and a single opacity cannot serve both. */}
        <div className={styles.scrim} aria-hidden="true" />
        <Weave opacity={0.04} gap={22} />

        <div className={styles.inner}>
          <p className={styles.eyebrow}>{t('heroEyebrow')}</p>
          <h1 className={styles.title}>
            {t('heroTitle')}{' '}
            <span className={styles.titleAccent}>{t('heroTitleAccent')}</span>
          </h1>
          <p className={styles.body}>{t('heroBody')}</p>

          <StaySearch locale={locale} tone="dark" className={styles.search} />
        </div>
      </section>

      <HomeSections locale={locale} roomTypes={roomTypes} />
    </>
  );
}
