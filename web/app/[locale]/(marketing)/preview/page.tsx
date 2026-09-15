/**
 * The home page directions that were not taken.
 *
 * A place to send the client, not a page of the site: nothing links here, and
 * it is not indexed.
 *
 * "Still" was chosen on 15 Sep 2026 and **is** `(marketing)/page.tsx` now, so it
 * is no longer listed here — the link at the foot of the page goes to the real
 * thing rather than to a copy of it. The two below are kept only so the choice
 * can be revisited; when nobody needs them any more, this whole directory goes.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Photo } from '@/components/marketing';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto } from '@/lib/media';
import type { PropertyPhotoName } from '@/lib/media';

import styles from './page.module.css';

/** Each direction, with the photograph its own hero leads on. */
const VARIANTS = [
  {
    key: 'editorial',
    href: '/preview/editorial',
    photo: 'facade',
    alt: 'facade',
  },
  {
    key: 'gallery',
    href: '/preview/gallery',
    photo: 'restaurant',
    alt: 'loom',
  },
] as const satisfies ReadonlyArray<{
  key: string;
  href: string;
  photo: PropertyPhotoName;
  alt: string;
}>;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/preview'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'preview' });

  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function PreviewIndexPage({
  params,
}: PageProps<'/[locale]/preview'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('preview');
  const tPhoto = await getTranslations('photos');

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <p className={styles.badge}>{t('badge')}</p>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.intro}>{t('intro')}</p>

        <ul className={styles.grid}>
          {VARIANTS.map((variant) => (
            <li key={variant.key}>
              <Link href={variant.href} className={styles.card}>
                <span className={styles.thumb}>
                  <Photo
                    photo={propertyPhoto(variant.photo, tPhoto(variant.alt))}
                    sizes="(max-width: 900px) 100vw, 30vw"
                  />
                </span>
                <span className={styles.cardBody}>
                  <span className={styles.cardName}>
                    {t(`variants.${variant.key}.name`)}
                  </span>
                  <span className={styles.cardNote}>
                    {t(`variants.${variant.key}.note`)}
                  </span>
                  <span className={styles.cardLink}>{t('view')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link href="/" className={styles.current}>
          {t('current')}
        </Link>
      </div>
    </div>
  );
}
