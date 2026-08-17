/**
 * Admin layout.
 *
 * A thin Server Component: it validates the locale and wraps everything in the
 * session gate. It fetches nothing — admin data needs the session cookie, which
 * a Server Component cannot present to a cross-origin API, so every screen
 * loads its own data in the browser.
 *
 * `robots: noindex, nofollow` matters more here than on the reserve page. The
 * panel must never appear in a search result, and a crawler that follows a
 * link into it would only generate failed requests.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';
import { AdminSessionProvider } from './AdminSession';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
  params,
}: LayoutProps<'/[locale]/admin'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return <AdminSessionProvider>{children}</AdminSessionProvider>;
}
