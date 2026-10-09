import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { ServiceDesk } from '../services/ServiceDesk';

export default async function DiningRequestsPage({
  params,
}: PageProps<'/[locale]/admin/dining'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <ServiceDesk kind="dining" locale={locale} />;
}
