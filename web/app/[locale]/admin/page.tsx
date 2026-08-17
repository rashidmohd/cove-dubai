/**
 * Dashboard — the panel's landing screen.
 *
 * Server Component shell only; the data needs the session cookie, so it is
 * fetched in the browser by `Dashboard`.
 */
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { Dashboard } from './Dashboard';

export default async function AdminDashboardPage({
  params,
}: PageProps<'/[locale]/admin'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <Dashboard locale={locale} />;
}
