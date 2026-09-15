/**
 * Home, direction one: "Still".
 *
 * One photograph at full bleed, the hero line over it, and the stay search
 * resting on the lower third. The bet is that a hotel sells the room before it
 * sells the sentence, so the first screen is the photograph and everything else
 * sits on top of it.
 *
 * A draft for the client to compare — see `preview/page.tsx`. Not indexed, and
 * not linked from the site.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { StaySearch } from '@/components/booking/StaySearch';
import { Weave } from '@/components/BrandEffects';
import { Photo } from '@/components/marketing';
import { HomeSections } from '@/components/marketing/HomeSections';
import { bookingApi } from '@/lib/api/client';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto } from '@/lib/media';
import type { RoomType } from '@/lib/api/types';

import styles from './page.module.css';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/preview/still'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'preview' });

  return {
    title: `${t('variants.still.name')} — ${t('title')}`,
    // A second home page with the same copy is a duplicate of the real one.
    // Indexing it would have the two compete, and the draft could win.
    robots: { index: false, follow: false },
  };
}

export default async function StillPreviewPage({
  params,
}: PageProps<'/[locale]/preview/still'>) {
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
          <Photo
            photo={propertyPhoto('lobby', tPhoto('lobby'))}
            sizes="100vw"
            priority
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
