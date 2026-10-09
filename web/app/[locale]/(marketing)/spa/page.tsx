/**
 * The spa — a menu of treatments, and a form to request one. The team confirms by email.
 *
 * The page itself is `ServiceRequestPage`, shared with the dining page.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ServiceRequestPage } from '@/components/requests/ServiceRequestPage';
import { isLocale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/spa'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'requests.spa' });

  return {
    title: t('pageTitle'),
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/spa`,
      languages: { en: '/en/spa', ar: '/ar/spa' },
    },
  };
}

export default async function SpaPage({
  params,
}: PageProps<'/[locale]/spa'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <ServiceRequestPage kind="spa" locale={locale} />;
}
