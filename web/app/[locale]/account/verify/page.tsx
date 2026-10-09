/**
 * Confirm an email address, from the link in the verification email.
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
import { VerifyEmail } from './VerifyEmail';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/account/verify'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });

  return {
    title: t('verify.title'),
    robots: { index: false, follow: false },
  };
}

export default async function VerifyPage({
  params,
}: PageProps<'/[locale]/account/verify'>) {
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
          <VerifyEmail />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
