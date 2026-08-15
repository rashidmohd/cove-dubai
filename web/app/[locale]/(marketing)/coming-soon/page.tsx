/**
 * Coming soon.
 *
 * The mockups' nav links to seven destinations but only five have pages.
 * Wellness, Experiences and Members land here, so the approved nav is preserved
 * exactly without any dead links — the client's decision.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Glow, Weave } from '@/components/BrandEffects';
import { Link } from '@/i18n/navigation';
import styles from './page.module.css';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/coming-soon'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'comingSoon' });

  return {
    title: t('title'),
    // Nothing here is worth indexing, and letting it in would put a thin,
    // duplicated page in front of searchers for three separate destinations.
    robots: { index: false, follow: true },
  };
}

export default async function ComingSoonPage({
  params,
}: PageProps<'/[locale]/coming-soon'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('comingSoon');

  return (
    <section className={styles.section}>
      <Weave opacity={0.05} gap={22} />
      <Glow centre width={700} height={400} strength={0.07} />

      <div className={styles.inner}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.body}>{t('body')}</p>
        <Link href="/" className={styles.link}>
          {t('backHome')}
        </Link>
      </div>
    </section>
  );
}
