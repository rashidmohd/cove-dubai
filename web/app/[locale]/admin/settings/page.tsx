import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { Settings } from './Settings';

export default async function SettingsPage({
  params,
}: PageProps<'/[locale]/admin/settings'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <Settings />;
}
