/**
 * Locale layout — the root layout for every page.
 *
 * This is where Arabic becomes a first-class layout rather than a translation:
 * `<html lang dir>` is set per locale, so the entire document flips direction
 * natively and every logical CSS property follows. Nothing downstream needs to
 * know which language it is rendering (`arabic-rtl`).
 */
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { fontVariables } from '../fonts';
import { publicConfig } from '@/lib/config';
import { locales, localeDirections, isLocale, type Locale } from '@/i18n/routing';
import '@/styles/globals.css';

/**
 * Render both locales at build time.
 *
 * Marketing pages must ship real Arabic HTML for SEO rather than an empty shell
 * hydrated later, so `/ar` has to be statically rendered too.
 */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    metadataBase: new URL(publicConfig.siteUrl),
    title: {
      default: t('defaultTitle'),
      template: `%s · ${t('siteName')}`,
    },
    description: t('description'),
    // Each locale indexes separately, so Arabic-language hotel searches in
    // Dubai and the GCC find the Arabic pages rather than the English ones.
    alternates: {
      canonical: `/${locale}`,
      languages: {
        en: '/en',
        ar: '/ar',
        'x-default': '/en',
      },
    },
    openGraph: {
      type: 'website',
      siteName: t('siteName'),
      title: t('defaultTitle'),
      description: t('description'),
      locale: locale === 'ar' ? 'ar_AE' : 'en_AE',
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<'/[locale]'>) {
  const { locale } = await params;

  // A URL like /de would otherwise render with missing messages rather than a
  // clean 404.
  if (!isLocale(locale)) notFound();

  // Required for static rendering — without it these pages opt into dynamic
  // rendering and the marketing SEO benefit is lost.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'common' });

  return (
    <html
      lang={locale}
      dir={localeDirections[locale as Locale]}
      className={fontVariables}
    >
      <body>
        <a className="skip-link" href="#main">
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
