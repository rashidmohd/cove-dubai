/**
 * Password reset: request a link, or set a new password from one.
 *
 * `noindex`: account pages are personal, and the verify and reset links carry
 * single-use secrets that must never end up in a search result.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { isLocale } from '@/i18n/routing';
import { ResetPassword } from './ResetPassword';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/account/reset'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });

  return {
    title: t('reset.requestTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function ResetPage({
  params,
}: PageProps<'/[locale]/account/reset'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return (
    <>
      <SiteNav />
      <main id="main">
        {/* Reads the token with `useSearchParams`, which cannot be known at
            build time; without the boundary the build fails rather than
            silently opting the page out of prerendering. */}
        <Suspense fallback={null}>
          <ResetPassword locale={locale} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
