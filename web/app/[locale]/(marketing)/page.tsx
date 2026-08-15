/**
 * Home.
 *
 * A Server Component, statically rendered in both locales so `/ar` ships real
 * Arabic HTML for search engines rather than an empty shell hydrated later.
 *
 * This is the hero only. The remaining sections from design/mockups/home.html
 * (about, rooms, facilities, experiences, press, guests) are ported in M5.
 */
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Glow, Weave } from '@/components/BrandEffects';
import { Link } from '@/i18n/navigation';
import styles from './page.module.css';

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');

  return (
    <section className={styles.hero}>
      <Weave opacity={0.04} gap={22} />
      <Glow centre breathing width={900} height={600} strength={0.1} />

      <div className={styles.heroInner}>
        <p className={styles.eyebrow}>{t('heroEyebrow')}</p>
        <h1 className={styles.title}>
          {t('heroTitle')}{' '}
          <span className={styles.titleAccent}>{t('heroTitleAccent')}</span>
        </h1>
        <p className={styles.body}>{t('heroBody')}</p>
        <Link href="/reserve" className={styles.cta}>
          {t('heroCta')}
        </Link>
      </div>
    </section>
  );
}
