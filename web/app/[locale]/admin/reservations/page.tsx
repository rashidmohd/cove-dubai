import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { Reservations } from './Reservations';

export default async function ReservationsPage({
  params,
}: PageProps<'/[locale]/admin/reservations'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <Reservations locale={locale} />;
}
