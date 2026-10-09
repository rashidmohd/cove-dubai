import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { RatePlans } from './RatePlans';

export default async function RatePlansPage({
  params,
}: PageProps<'/[locale]/admin/rates'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <RatePlans locale={locale} />;
}
