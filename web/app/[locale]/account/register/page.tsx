/**
 * Create a guest account.
 *
 * `noindex`: account pages are personal, and the verify and reset links carry
 * single-use secrets that must never end up in a search result.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { isLocale } from '@/i18n/routing';
import { RegisterForm } from './RegisterForm';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/account/register'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });

  return {
    title: t('register.title'),
    robots: { index: false, follow: false },
  };
}

export default async function RegisterPage({
  params,
}: PageProps<'/[locale]/account/register'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return (
    <>
      <SiteNav />
      <main id="main">
        <RegisterForm locale={locale} />
      </main>
      <SiteFooter />
    </>
  );
}
