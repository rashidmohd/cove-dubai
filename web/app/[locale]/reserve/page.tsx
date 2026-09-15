/**
 * Reserve page.
 *
 * A thin Server Component shell: metadata, chrome, and the breadcrumb. The
 * booking itself is interactive, so it lives in the client `ReserveFlow`.
 *
 * Unlike the marketing pages this is deliberately not worth indexing — the
 * content is a form, and its value to a searcher is the Rooms page instead.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { ReserveFlow } from './ReserveFlow';
import styles from './Reserve.module.css';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/reserve'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'reserve' });

  return {
    title: t('title'),
    alternates: {
      canonical: `/${locale}/reserve`,
      languages: { en: '/en/reserve', ar: '/ar/reserve' },
    },
  };
}

export default async function ReservePage({
  params,
}: PageProps<'/[locale]/reserve'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('reserve');
  const tNav = await getTranslations('nav');

  return (
    <>
      <SiteNav />

      <nav className={styles.breadcrumb} aria-label={t('title')}>
        <Link href="/" className={styles.crumb}>
          {tNav('home')}
        </Link>
        <span className={styles.crumb} aria-hidden="true">
          ·
        </span>
        <span className={`${styles.crumb} ${styles.crumbCurrent}`}>
          {t('title')}
        </span>
      </nav>

      <main id="main">
        {/* `ReserveFlow` seeds its dates from the query string — the home page
            search links here with them — and `useSearchParams` cannot be known
            at build time. Without this boundary the page opts out of
            prerendering entirely, and Next fails the build rather than letting
            it happen silently. */}
        <Suspense fallback={null}>
          <ReserveFlow locale={locale} />
        </Suspense>
      </main>

      <SiteFooter />
    </>
  );
}
