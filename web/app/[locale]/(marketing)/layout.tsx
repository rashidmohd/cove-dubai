/**
 * Marketing layout — the shared chrome for the public pages.
 *
 * Nav and footer live here rather than in each page, so every marketing route
 * gets identical chrome and the ghost monogram sits behind all of them.
 */
import { setRequestLocale } from 'next-intl/server';

import { GhostMonogram } from '@/components/BrandEffects';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';

export default async function MarketingLayout({
  children,
  params,
}: LayoutProps<'/[locale]'>) {
  const { locale } = await params;

  // Required, not incidental. This layout renders translated chrome (the
  // footer), and without declaring the locale here next-intl resolves it from
  // request headers instead — which opts the whole marketing tree into dynamic
  // rendering and costs the static Arabic HTML that `/ar` needs for SEO.
  setRequestLocale(locale);

  return (
    <>
      <GhostMonogram />
      <SiteNav />
      {/* Target of the skip link, and the landmark screen readers jump to. */}
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
