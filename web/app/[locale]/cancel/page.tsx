/**
 * Guest self-cancellation, reached from the link in the confirmation email.
 *
 * A thin Server Component shell. The cancellation itself is a write that needs
 * the token from the query string, so it happens in the client component.
 *
 * `noindex` for the same reason as the reserve flow, and more so: the URL
 * carries a secret, and a crawler that indexed one would put a working
 * cancellation link into a search result.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { isLocale } from '@/i18n/routing';
import { CancelFlow } from './CancelFlow';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/cancel'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cancel' });

  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function CancelPage({
  params,
}: PageProps<'/[locale]/cancel'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return (
    <>
      <SiteNav />
      <main id="main">
        {/* `CancelFlow` reads the token from the query string with
            `useSearchParams`, which cannot be known at build time. Without this
            boundary the page opts out of prerendering entirely — Next fails the
            build rather than letting it happen silently. */}
        <Suspense fallback={null}>
          <CancelFlow locale={locale} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
