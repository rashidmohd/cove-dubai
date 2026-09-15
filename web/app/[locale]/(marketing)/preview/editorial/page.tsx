/**
 * Home, direction two: "Editorial".
 *
 * The screen splits: the words and the search on a linen panel, a full-height
 * photograph beside them. Where "Still" puts the text on the photograph, this
 * puts them side by side — nothing is dimmed to make room for anything else, so
 * the search reads as a tool rather than as an overlay, and the photograph is
 * never cropped by a paragraph.
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
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto } from '@/lib/media';
import type { RoomType } from '@/lib/api/types';

import styles from './page.module.css';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/preview/editorial'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'preview' });

  return {
    title: `${t('variants.editorial.name')} — ${t('title')}`,
    robots: { index: false, follow: false },
  };
}

export default async function EditorialPreviewPage({
  params,
}: PageProps<'/[locale]/preview/editorial'>) {
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
        <div className={styles.panel}>
          <div className={styles.panelInner}>
            <p className={styles.eyebrow}>{t('heroEyebrow')}</p>
            <h1 className={styles.title}>
              {t('heroTitle')}{' '}
              <span className={styles.titleAccent}>{t('heroTitleAccent')}</span>
            </h1>
            <p className={styles.body}>{t('heroBody')}</p>

            <StaySearch
              locale={locale}
              tone="light"
              className={styles.search}
            />

            {/* The panel has room for the quieter of the two original calls to
                action. The loud one is now the search button, and two primary
                actions competing on one screen is one too many. */}
            <Link href="/rooms" className={styles.quiet}>
              {t('heroCtaSecondary')}
            </Link>
          </div>
        </div>

        {/* The facade is the one portrait photograph the client supplied, and
            this is the only slot on the site shaped to suit it. */}
        <div className={styles.photo}>
          <Photo
            photo={propertyPhoto('facade', tPhoto('facade'))}
            sizes="(max-width: 900px) 100vw, 50vw"
            priority
          />
        </div>
      </section>

      <HomeSections locale={locale} roomTypes={roomTypes} />
    </>
  );
}
