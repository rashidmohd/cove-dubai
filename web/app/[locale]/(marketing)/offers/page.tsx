/**
 * Offers.
 *
 * The sixth public page, and the only one with no mockup behind it — it was
 * added after the approved designs. It follows the Rooms page's structure
 * deliberately rather than inventing a layout: an offer is a room at a price,
 * and the guest is making the same kind of decision.
 *
 * Every figure comes from the API. An offer *is* a rate plan, so the nightly
 * rate shown here is the row the booking will price against — there is no
 * second source for it to disagree with (`pms-readiness`).
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Glow, Weave } from '@/components/BrandEffects';
import {
  BodyText,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
} from '@/components/marketing';
import { Link } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { bookingApi } from '@/lib/api/client';
import type { Offer } from '@/lib/api/types';
import { formatMoney, formatNumber, formatStayDate } from '@/lib/format';
import styles from './page.module.css';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/offers'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'offers' });

  return {
    title: t('label'),
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/offers`,
      languages: { en: '/en/offers', ar: '/ar/offers' },
    },
  };
}

export default async function OffersPage({
  params,
}: PageProps<'/[locale]/offers'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('offers');
  const tCommon = await getTranslations('common');

  // An unreachable API must not take the page down: the hotel's own copy still
  // stands on its own, and an empty offers list reads as "none at the moment"
  // rather than as a broken site.
  let offers: Offer[] = [];
  try {
    offers = await bookingApi.getOffers();
  } catch {
    offers = [];
  }

  return (
    <>
      <Section className={styles.hero}>
        <Glow />
        <Weave />
        <Reveal>
          <SectionLabel>{t('label')}</SectionLabel>
          <SectionHeading as="h1" accent={t('titleAccent')}>{t('title')}</SectionHeading>
          <BodyText className={styles.intro}>{t('intro')}</BodyText>
        </Reveal>
      </Section>

      <Section className={styles.list}>
        {offers.length === 0 ? (
          <Reveal>
            <p className={styles.empty}>{t('none')}</p>
          </Reveal>
        ) : (
          <ul className={styles.offerList}>
            {offers.map((offer, index) => (
              <li key={`${offer.roomTypeCode}-${offer.name.en}`}>
                <Reveal delay={index * 80}>
                  <article className={styles.offer}>
                    {/* The gradient treatment from the mockups, selected by
                        attribute exactly as the Rooms page does. Photography
                        replaces this when the client supplies it — `images` is
                        already on the payload. */}
                    <div
                      className={styles.visual}
                      data-swatch={offer.imageKey}
                      role="presentation"
                    >
                      {offer.standardRate !== null ? (
                        <p className={styles.saving}>
                          {t('save', {
                            percent: formatNumber(
                              Math.round(
                                ((offer.standardRate - offer.nightlyRate) /
                                  offer.standardRate) *
                                  100,
                              ),
                              locale,
                            ),
                          })}
                        </p>
                      ) : null}
                    </div>

                    <div className={styles.body}>
                      <p className={styles.room}>
                        <bdi>{offer.roomTypeName[locale as Locale]}</bdi>
                      </p>
                      <h2 className={styles.name}>
                        <bdi>{offer.name[locale as Locale]}</bdi>
                      </h2>

                      {offer.description ? (
                        <p className={styles.description}>
                          <bdi>{offer.description[locale as Locale]}</bdi>
                        </p>
                      ) : null}

                      <dl className={styles.terms}>
                        <Term
                          label={t('nightlyRate')}
                          value={formatMoney(
                            offer.nightlyRate,
                            tCommon('currency'),
                            locale as Locale,
                          )}
                          was={
                            offer.standardRate === null
                              ? null
                              : formatMoney(
                                  offer.standardRate,
                                  tCommon('currency'),
                                  locale as Locale,
                                )
                          }
                        />

                        {offer.minimumStayNights > 1 ? (
                          <Term
                            label={t('minimumStay')}
                            value={t('nights', {
                              count: offer.minimumStayNights,
                            })}
                          />
                        ) : null}

                        {/* Seven days is no restriction at all, and listing
                            every day of the week would say nothing. */}
                        {offer.daysOfWeek.length < 7 ? (
                          <Term
                            label={t('nightsAvailable')}
                            value={weekdayList(offer.daysOfWeek, locale as Locale)}
                          />
                        ) : null}

                        {offer.validTo ? (
                          <Term
                            label={t('bookBy')}
                            value={formatStayDate(offer.validTo, locale as Locale)}
                          />
                        ) : null}
                      </dl>

                      <Link
                        href={{
                          pathname: '/reserve',
                          query: { room: offer.roomTypeCode },
                        }}
                        className={styles.cta}
                      >
                        {t('book')}
                      </Link>
                    </div>
                  </article>
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Term({
  label,
  value,
  was,
}: {
  label: string;
  value: string;
  was?: string | null;
}) {
  return (
    <div className={styles.term}>
      <dt className={styles.termLabel}>{label}</dt>
      <dd className={styles.termValue}>
        {/* Prices and dates are isolated so they cannot be reordered inside
            Arabic text — `bdi` infers direction from the content itself. */}
        <bdi>{value}</bdi>
        {was ? (
          <span className={styles.was}>
            <bdi>{was}</bdi>
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * "Fri, Sat" — the weekday names, from the locale rather than hardcoded.
 *
 * Generated the same way the booking calendar generates its headers, so Arabic
 * gets real Arabic weekday names instead of transliterated English ones.
 */
function weekdayList(days: number[], locale: Locale): string {
  const formatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-AE' : 'en-AE',
    { weekday: 'short', timeZone: 'UTC' },
  );

  // 2024-01-07 was a Sunday, so index 0 lines up with getUTCDay().
  const names = [...days]
    .sort((a, b) => a - b)
    .map((day) => formatter.format(new Date(Date.UTC(2024, 0, 7 + day))));

  // `ListFormat` rather than joining on a comma: the separator and the final
  // conjunction differ by language, and Arabic does not use "," at all.
  return new Intl.ListFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    style: 'long',
    type: 'conjunction',
  }).format(names);
}
