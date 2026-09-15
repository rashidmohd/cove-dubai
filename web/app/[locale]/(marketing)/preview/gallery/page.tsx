/**
 * Home, direction three: "Gallery".
 *
 * A masthead of type, then four photographs at once, with the search bar
 * crossing the seam beneath them. Where the other two directions pick a single
 * image to speak for the hotel, this one answers "what is this place" with four
 * rooms of it before the guest scrolls — and puts the search on the join, so it
 * belongs to neither the pictures nor the page and is hard to miss in either.
 *
 * A draft for the client to compare — see `preview/page.tsx`. Not indexed, and
 * not linked from the site.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { StaySearch } from '@/components/booking/StaySearch';
import { Photo } from '@/components/marketing';
import { HomeSections } from '@/components/marketing/HomeSections';
import { bookingApi } from '@/lib/api/client';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto } from '@/lib/media';
import type { PropertyPhotoName } from '@/lib/media';
import type { RoomType } from '@/lib/api/types';

import styles from './page.module.css';

/**
 * The four frames, in the order they read.
 *
 * Chosen to answer four different questions — where is it, what does the room
 * look like, where do I eat, what else is there — rather than to show the four
 * best photographs, three of which would be lobbies.
 */
const FRAMES = [
  { photo: 'facade', alt: 'facade' },
  { photo: 'roomKing', alt: 'roomInterior' },
  // The photograph is named for the room it is in; the caption is named for the
  // restaurant that room is. The dining page maps the same pair.
  { photo: 'restaurant', alt: 'loom' },
  { photo: 'pool', alt: 'pool' },
] as const satisfies ReadonlyArray<{ photo: PropertyPhotoName; alt: string }>;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/preview/gallery'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'preview' });

  return {
    title: `${t('variants.gallery.name')} — ${t('title')}`,
    robots: { index: false, follow: false },
  };
}

export default async function GalleryPreviewPage({
  params,
}: PageProps<'/[locale]/preview/gallery'>) {
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
        <div className={styles.masthead}>
          <p className={styles.eyebrow}>{t('heroEyebrow')}</p>
          <h1 className={styles.title}>
            {t('heroTitle')}{' '}
            <span className={styles.titleAccent}>{t('heroTitleAccent')}</span>
          </h1>
          <p className={styles.body}>{t('heroBody')}</p>
        </div>

        <div className={styles.mosaic}>
          {FRAMES.map((frame, index) => (
            <div key={frame.photo} className={styles.frame}>
              <Photo
                photo={propertyPhoto(frame.photo, tPhoto(frame.alt))}
                sizes="(max-width: 900px) 50vw, 25vw"
                // Only the first. Four urgent images are four images competing
                // for the same bandwidth, which delays the one that is the LCP.
                priority={index === 0}
              />
            </div>
          ))}
        </div>

        <div className={styles.searchRow}>
          <StaySearch locale={locale} tone="light" className={styles.search} />
        </div>
      </section>

      <HomeSections locale={locale} roomTypes={roomTypes} />
    </>
  );
}
