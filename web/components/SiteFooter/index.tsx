/**
 * Site footer.
 *
 * A Server Component — it is entirely static, so it ships no JavaScript.
 */
import { getTranslations } from 'next-intl/server';

import { Weave } from '@/components/BrandEffects';
import { Link } from '@/i18n/navigation';
import styles from './SiteFooter.module.css';

/**
 * Footer columns.
 *
 * Destinations without a Phase 1 page point at the coming-soon page, matching
 * the nav.
 */
const COLUMNS = [
  {
    key: 'about',
    links: [
      { key: 'theHotel', href: '/about' },
      { key: 'ourStory', href: '/about' },
      { key: 'press', href: '/coming-soon' },
      { key: 'careers', href: '/coming-soon' },
    ],
  },
  {
    key: 'stay',
    links: [
      { key: 'rooms', href: '/rooms' },
      { key: 'reserve', href: '/reserve' },
      { key: 'longStays', href: '/coming-soon' },
      { key: 'giftCards', href: '/coming-soon' },
    ],
  },
  {
    key: 'explore',
    links: [
      { key: 'dining', href: '/dining' },
      { key: 'wellness', href: '/coming-soon' },
      { key: 'experiences', href: '/coming-soon' },
      { key: 'events', href: '/coming-soon' },
    ],
  },
] as const;

export async function SiteFooter() {
  const t = await getTranslations('footer');
  const tCommon = await getTranslations('common');

  return (
    <footer className={styles.footer}>
      <Weave opacity={0.04} gap={22} />

      <div className={styles.inner}>
        <div className={styles.brandBlock}>
          <span className={styles.logo}>{tCommon('brand')}</span>
          <span className={styles.city}>{tCommon('brandLocation')}</span>
          <p className={styles.tagline}>{t('tagline')}</p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.key}>
            <h2 className={styles.columnTitle}>{t(`columns.${column.key}`)}</h2>
            <ul className={styles.list}>
              {column.links.map((link) => (
                <li key={link.key}>
                  <Link href={link.href}>{t(`links.${link.key}`)}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <h2 className={styles.columnTitle}>{t('columns.reachUs')}</h2>
          <ul className={styles.list}>
            <li>
              <a href={`mailto:${t('email')}`}>{t('email')}</a>
            </li>
            <li>
              {/* `dir="ltr"` is deliberate: a phone number is always read
                  left-to-right, even inside an Arabic page, or the country
                  code renders at the wrong end. */}
              <a href={`tel:${t('phoneHref')}`} dir="ltr">
                {t('phone')}
              </a>
            </li>
            <li>
              <Link href="/coming-soon">{t('links.gettingHere')}</Link>
            </li>
          </ul>
        </div>
      </div>

      <div className={styles.bottom}>
        <span>{t('copyright', { year: new Date().getFullYear() })}</span>
        <span>{t('legal')}</span>
      </div>
    </footer>
  );
}
