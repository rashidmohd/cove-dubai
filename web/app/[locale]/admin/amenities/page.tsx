import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { Amenities } from './Amenities';

export default async function AmenitiesPage({
  params,
}: PageProps<'/[locale]/admin/amenities'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <Amenities locale={locale} />;
}
