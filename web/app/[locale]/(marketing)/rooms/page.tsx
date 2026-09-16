/**
 * Rooms & Suites.
 *
 * Room data comes from the API, so what a guest sees here is whatever the hotel
 * has configured in the admin panel — the page has no hardcoded room list of
 * its own. Per-room specifications (size, bed, view) are marketing copy in the
 * message files rather than database fields: Phase 1 has no structured column
 * for them, and inventing one would mean guessing the shape a future PMS
 * expects (`pms-readiness`).
 *
 * Statically rendered in both locales, revalidated hourly, so `/ar` ships real
 * Arabic HTML for search.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import {
  BodyText,
  Photo,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
  marketingStyles as m,
} from '@/components/marketing';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { bookingApi } from '@/lib/api/client';
import { formatMoney } from '@/lib/format';
import { resolveRoomPhoto } from '@/lib/media';
import type { RoomType } from '@/lib/api/types';
import styles from './page.module.css';

const SPEC_KEYS = ['size', 'bed', 'view', 'bathroom', 'floor'] as const;

/**
 * Specs whose value is a measurement or a numeric range rather than prose.
 *
 * These are always read left-to-right, whatever the page language. Left to
 * inherit the Arabic page's direction, bidi reordering displays "42 m²" as
 * "m² 42" and — worse — the floor range "2 – 6" as "6 – 2", which is not a
 * styling problem but wrong information. The stored values are correct; only
 * the rendering direction needs pinning.
 */
const LTR_SPEC_KEYS = new Set<string>(['size', 'floor']);

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/rooms'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'rooms' });

  return {
    title: `${t('title')} ${t('titleAccent')}`,
    description: t('intro'),
    alternates: {
      canonical: `/${locale}/rooms`,
      languages: { en: '/en/rooms', ar: '/ar/rooms' },
    },
  };
}

export default async function RoomsPage({
  params,
}: PageProps<'/[locale]/rooms'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('rooms');
  const tCommon = await getTranslations('common');
  const tPhoto = await getTranslations('photos');

  let roomTypes: RoomType[] = [];
  try {
    roomTypes = await bookingApi.getRoomTypes();
  } catch {
    // A page listing no rooms is poor, but a build that fails because the API
    // was briefly unreachable is worse.
    roomTypes = [];
  }

  return (
    <>
      <Section tone="light">
        <Reveal>
          <SectionLabel>{t('label')}</SectionLabel>
          <SectionHeading as="h1" accent={t('titleAccent')}>
            {t('title')}
          </SectionHeading>
          <BodyText className={styles.intro}>{t('intro')}</BodyText>
        </Reveal>
      </Section>

      <Section tone="linen">
        <ul className={styles.roomList}>
          {roomTypes.map((room, index) => (
            <li key={room.code}>
              <Reveal delay={index * 120}>
                <article className={styles.room}>
                  <div
                    className={styles.roomVisual}
                    data-swatch={room.imageKey}
                  >
                    <Photo
                      photo={resolveRoomPhoto(
                        room,
                        locale,
                        tPhoto('room', { name: room.name[locale] }),
                      )}
                      sizes="(max-width: 900px) 100vw, 50vw"
                    />
                  </div>

                  <div className={styles.roomBody}>
                    <p className={styles.roomCategory}>
                      <bdi>{room.category[locale]}</bdi>
                    </p>
                    <h2 className={styles.roomName}>
                      <bdi>{room.name[locale]}</bdi>
                    </h2>
                    <BodyText className={styles.roomDescription}>
                      <bdi>{room.description[locale]}</bdi>
                    </BodyText>

                    <dl className={styles.specs}>
                      {SPEC_KEYS.map((key) => {
                        // Specs are optional: a room type added in the admin
                        // panel will not have copy here until the client writes
                        // it, and a missing spec must simply not render rather
                        // than throw.
                        const value = t.has(`specs.${room.code}.${key}`)
                          ? t(`specs.${room.code}.${key}`)
                          : null;
                        if (!value) return null;

                        return (
                          <div key={key} className={styles.spec}>
                            <dt className={styles.specLabel}>
                              {t(`specLabels.${key}`)}
                            </dt>
                            <dd className={styles.specValue}>
                              {/* `bdi` isolates the value so it cannot disturb
                                  the surrounding text; `dir` pins measurements
                                  that must read left-to-right in both
                                  languages. */}
                              <bdi
                                {...(LTR_SPEC_KEYS.has(key)
                                  ? { dir: 'ltr' as const }
                                  : {})}
                              >
                                {value}
                              </bdi>
                            </dd>
                          </div>
                        );
                      })}
                      <div className={styles.spec}>
                        <dt className={styles.specLabel}>
                          {tCommon('adults')}
                        </dt>
                        <dd className={styles.specValue}>
                          {t('sleeps', { count: room.maxOccupancy })}
                        </dd>
                      </div>
                    </dl>

                    {/* Amenities come from the API, so the hotel edits them in
                        the admin panel rather than in a message file. The specs
                        above are still prose in `messages/` — they have no
                        standard vocabulary behind them, unlike these.

                        `?? []` is load-bearing, not defensive habit. This page
                        caches room types for an hour, and `web` and `server`
                        deploy independently — so a response predating this
                        field is a normal state, not a broken one, and reading
                        `.length` off it directly throws. */}
                    {(room.amenities ?? []).length > 0 ? (
                      <div className={styles.amenities}>
                        <h3 className={styles.amenitiesTitle}>
                          {t('amenitiesTitle')}
                        </h3>
                        <ul className={styles.amenityList}>
                          {(room.amenities ?? []).map((amenity) => (
                            <li
                              key={amenity.code}
                              className={styles.amenityItem}
                            >
                              {/* Database text in either script — isolated so
                                  it cannot disturb the surrounding layout. */}
                              <bdi>{amenity.name[locale]}</bdi>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className={styles.roomFooter}>
                      <p className={styles.price}>
                        <span className={styles.priceLabel}>{t('from')}</span>
                        <span className={styles.priceAmount}>
                          {formatMoney(
                            room.baseRate,
                            tCommon('currency'),
                            locale,
                          )}
                        </span>
                        <span className={styles.pricePer}>
                          {tCommon('perNight')}
                        </span>
                      </p>
                      <div className={styles.roomActions}>
                        {/* The quiet action of the pair: a guest still
                            deciding wants the room, not the form. The filled
                            button stays the one that starts a booking. */}
                        <Link
                          href={`/rooms/${room.code}`}
                          className={styles.viewRoom}
                        >
                          {t('viewRoom')}
                        </Link>
                        <Link
                          href={{
                            pathname: '/reserve',
                            query: { room: room.code },
                          }}
                          className={styles.reserve}
                        >
                          {t('reserve')}
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="light" className={styles.help}>
        <Reveal>
          <SectionHeading accent={t('help.titleAccent')}>
            {t('help.title')}
          </SectionHeading>
          <BodyText className={styles.helpBody}>{t('help.body')}</BodyText>
          <Link href="/reserve" className={m.textLink}>
            {t('help.cta')}
          </Link>
        </Reveal>
      </Section>
    </>
  );
}
