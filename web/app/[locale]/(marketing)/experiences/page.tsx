/**
 * Experiences — things to do beyond the hotel, arranged by the concierge.
 *
 * Starts with one: a desert safari. Each experience is a section in the
 * Wellness page's venue layout (photograph beside copy), so adding the next is
 * a copy of the section and its message keys rather than a new design.
 *
 * Nothing here is booked online. The call to action writes to the hotel, which
 * is honest about how an outside excursion is actually arranged.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Glow, Weave } from '@/components/BrandEffects';
import {
  BodyText,
  Photo,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
  marketingStyles as m,
} from '@/components/marketing';
import { isLocale } from '@/i18n/routing';
import type { Photograph } from '@/lib/media';
import styles from './page.module.css';

/**
 * Served from `public/` rather than the media bucket, because it was supplied
 * directly rather than uploaded with the client's photography. Moving it to
 * the bucket later is this one value.
 */
const DESERT_SAFARI_PHOTO = {
  url: '/images/experiences/desert-safari.jpg',
  width: 720,
  height: 480,
} as const;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/experiences'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'experiences' });

  return {
    title: t('label'),
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/experiences`,
      languages: { en: '/en/experiences', ar: '/ar/experiences' },
    },
  };
}

export default async function ExperiencesPage({
  params,
}: PageProps<'/[locale]/experiences'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('experiences');
  const tFooter = await getTranslations('footer');

  const safariPhoto: Photograph = { ...DESERT_SAFARI_PHOTO, alt: t('safari.alt') };
  const enquiry = `mailto:${tFooter('email')}?subject=${encodeURIComponent(t('safari.enquirySubject'))}`;

  return (
    <>
      <Section className={styles.hero}>
        <Glow />
        <Weave />
        <Reveal>
          <SectionLabel>{t('label')}</SectionLabel>
          <SectionHeading as="h1" accent={t('titleAccent')}>
            {t('title')}
          </SectionHeading>
          <BodyText className={styles.intro}>{t('intro')}</BodyText>
        </Reveal>
      </Section>

      {/* --- Desert safari --- */}
      <Section tone="linen">
        <div className={styles.experience}>
          <Reveal>
            <div className={styles.visual}>
              <Photo photo={safariPhoto} sizes="(max-width: 900px) 100vw, 50vw" />
            </div>
          </Reveal>

          <Reveal delay={120}>
            <p className={styles.kind}>{t('safari.kind')}</p>
            <h2 className={styles.name}>{t('safari.name')}</h2>
            <SectionHeading accent={t('safari.titleAccent')}>{t('safari.title')}</SectionHeading>
            <BodyText className={styles.spaced}>{t('safari.body1')}</BodyText>
            <BodyText className={styles.spaced}>{t('safari.body2')}</BodyText>
            <a href={enquiry} className={`${m.textLink} ${styles.cta}`}>
              {t('safari.cta')}
            </a>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
