/**
 * Request a table at one of the restaurants. The team confirms by email.
 *
 * The page itself is `ServiceRequestPage`, shared with the spa page.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ServiceRequestPage } from '@/components/requests/ServiceRequestPage';
import { isLocale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/dining/reserve'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'requests.dining' });

  return {
    title: t('pageTitle'),
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/dining/reserve`,
      languages: { en: '/en/dining/reserve', ar: '/ar/dining/reserve' },
    },
  };
}

export default async function DiningReservePage({
  params,
}: PageProps<'/[locale]/dining/reserve'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <ServiceRequestPage kind="dining" locale={locale} />;
}
