import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { ServiceDesk } from '../services/ServiceDesk';

export default async function SpaRequestsPage({
  params,
}: PageProps<'/[locale]/admin/spa'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <ServiceDesk kind="spa" locale={locale} />;
}
