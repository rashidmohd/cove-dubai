import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { InventoryCalendarScreen } from './InventoryCalendar';

export default async function InventoryPage({
  params,
}: PageProps<'/[locale]/admin/inventory'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <InventoryCalendarScreen locale={locale} />;
}
