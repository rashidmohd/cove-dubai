import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { Vouchers } from './Vouchers';

export default async function VouchersPage({
  params,
}: PageProps<'/[locale]/admin/vouchers'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <Vouchers locale={locale} />;
}
