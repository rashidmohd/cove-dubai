'use client';

/**
 * Site navigation.
 *
 * A Client Component only because it reacts to scroll and needs the current
 * pathname. Everything it renders comes from message keys, so it works in both
 * languages without knowing which one it is in.
 *
 * The mockups link to seven destinations but only five have pages. Wellness,
 * Experiences and Members point at the coming-soon page — the client's decision,
 * so the approved nav is preserved without any dead links.
 */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import styles from './SiteNav.module.css';

const NAV_ITEMS = [
  { key: 'about', href: '/about' },
  { key: 'rooms', href: '/rooms' },
  // After Rooms and before Dining: a guest who has just looked at rooms is the
  // one an offer is for, and it is the standard position on hotel sites.
  { key: 'offers', href: '/offers' },
  { key: 'dining', href: '/dining' },
  { key: 'wellness', href: '/coming-soon' },
  { key: 'experiences', href: '/coming-soon' },
  { key: 'members', href: '/coming-soon' },
] as const;

export function SiteNav() {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  // The home page has a full-bleed hero designed to run behind a transparent,
  // fixed nav. Interior pages do not, and a fixed bar there overlaps their
  // content — so they get the sticky variant the interior mockups use.
  //
  // `/preview/still` is a candidate home page built the same way: a dark
  // photograph running to the top of the screen. The other two drafts are not —
  // both open on a pale panel, where the transparent nav's light text would be
  // unreadable — so they keep the solid bar.
  const overlay = pathname === '/' || pathname === '/preview/still';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={[
        styles.nav,
        overlay ? null : styles.navSolid,
        overlay && scrolled ? styles.scrolled : null,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={t('menu')}
    >
      <Link href="/" className={styles.brand}>
        <span className={styles.logo}>{tCommon('brand')}</span>
        <span className={styles.city}>{tCommon('brandLocation')}</span>
      </Link>

      <ul className={styles.links}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className={isActive ? styles.active : undefined}
                // Announces the current page to screen readers rather than
                // relying on colour alone, which fails WCAG on its own.
                aria-current={isActive ? 'page' : undefined}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className={styles.actions}>
        <LanguageToggle />
        <Link href="/reserve" className={styles.reserveButton}>
          {t('reserve')}
        </Link>
      </div>
    </nav>
  );
}

/**
 * Language toggle.
 *
 * Switches locale while staying on the current page, so a guest reading about
 * the rooms in English lands on the rooms page in Arabic rather than the home
 * page. `usePathname` from our i18n navigation returns the path without the
 * locale prefix, which is exactly what `Link` needs to re-prefix.
 */
function LanguageToggle() {
  const t = useTranslations('common');
  const pathname = usePathname();
  const locale = useLocale();
  const other = locale === 'ar' ? 'en' : 'ar';

  return (
    <Link
      href={pathname}
      locale={other}
      className={styles.langToggle}
      aria-label={t('languageToggleLabel')}
      // Names the target language in its own script, so the label reads
      // correctly whichever side you are on.
      lang={other}
    >
      {t('languageToggle')}
    </Link>
  );
}
