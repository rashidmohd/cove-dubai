import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { RoomTypes } from './RoomTypes';

export default async function RoomsPage({
  params,
}: PageProps<'/[locale]/admin/rooms'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <RoomTypes locale={locale} />;
}
