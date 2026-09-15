/**
 * Home.
 *
 * A Server Component, statically rendered in both locales so `/ar` ships real
 * Arabic HTML for search engines rather than an empty shell hydrated later.
 *
 * Ported from design/mockups/home.html: hero, about, rooms, the chef's quote
 * band, experiences, press and guest voices.
 *
 * The rooms strip reads live room types from the API rather than the mockup's
 * hardcoded list, so editing a room in the admin panel updates the home page.
 */
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Glow, Weave } from '@/components/BrandEffects';
import {
  BodyText,
  Kicker,
  Photo,
  QuoteBand,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
  Stats,
  marketingStyles as m,
} from '@/components/marketing';
import { Link } from '@/i18n/navigation';
import { bookingApi } from '@/lib/api/client';
import { formatMoney } from '@/lib/format';
import { isLocale } from '@/i18n/routing';
import { propertyPhoto, resolveRoomPhoto } from '@/lib/media';
import type { PropertyPhotoName } from '@/lib/media';
import type { RoomType } from '@/lib/api/types';
import styles from './page.module.css';

/**
 * The parts of the building that are not a room and not a restaurant.
 *
 * `key` addresses the copy, `photo` the photograph — they differ where the
 * better shot of a space is not the one named after it.
 */
const FACILITIES = [
  { key: 'pool', photo: 'pool' },
  { key: 'gym', photo: 'gymStudio' },
  { key: 'entrance', photo: 'entrance' },
  { key: 'liftLobby', photo: 'liftLobby' },
] as const satisfies ReadonlyArray<{ key: string; photo: PropertyPhotoName }>;

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tCommon = await getTranslations('common');
  const tPhoto = await getTranslations('photos');

  // The API is the only source of room data — the front-end never reaches past
  // it. If it is unreachable at build time the page still renders; the rooms
  // strip simply falls back to a link through to the Rooms page.
  let roomTypes: RoomType[] = [];
  try {
    roomTypes = await bookingApi.getRoomTypes();
  } catch {
    roomTypes = [];
  }

  const activeLocale = isLocale(locale) ? locale : 'en';

  return (
    <>
      {/* --- Hero --- */}
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
          <div className={styles.heroActions}>
            <Link href="/reserve" className={styles.cta}>
              {t('heroCta')}
            </Link>
            <Link href="/rooms" className={styles.ctaQuiet}>
              {t('heroCtaSecondary')}
            </Link>
          </div>
        </div>
      </section>

      {/* --- About --- */}
      <Section tone="light">
        <div className={styles.aboutGrid}>
          <Reveal>
            <SectionLabel>{t('about.label')}</SectionLabel>
            <SectionHeading accent={t('about.titleAccent')}>
              {t('about.title')}
            </SectionHeading>
            <Kicker>{t('about.kicker')}</Kicker>
            <BodyText className={styles.spaced}>{t('about.body1')}</BodyText>
            <BodyText className={styles.spacedTight}>
              {t('about.body2')}
            </BodyText>
            <Link href="/about" className={m.textLink}>
              {t('about.link')}
            </Link>

            <Stats
              items={[
                {
                  value: t('stats.roomsValue'),
                  label: t('stats.roomsLabel'),
                },
                {
                  value: t('stats.diningValue'),
                  label: t('stats.diningLabel'),
                },
                {
                  value: t('stats.ratingValue'),
                  label: t('stats.ratingLabel'),
                },
              ]}
            />
          </Reveal>

          <Reveal delay={120}>
            {/* Two photographs offset against each other, the composition the
                mockups drew as gradients. Both slots keep their gradient
                underneath as the loading and no-photography state. */}
            <div className={styles.aboutVisual}>
              <div className={styles.aboutVisualMain}>
                <Photo
                  photo={propertyPhoto('lobby', tPhoto('lobby'))}
                  sizes="(max-width: 900px) 100vw, 40vw"
                />
              </div>
              <div className={styles.aboutVisualSmall}>
                <Photo
                  photo={propertyPhoto('reception', tPhoto('reception'))}
                  sizes="(max-width: 900px) 45vw, 18vw"
                />
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* --- Rooms --- */}
      <Section tone="linen">
        <Reveal>
          <div className={styles.sectionHead}>
            <div>
              <SectionLabel>{t('rooms.label')}</SectionLabel>
              <SectionHeading accent={t('rooms.titleAccent')}>
                {t('rooms.title')}
              </SectionHeading>
            </div>
            <Link href="/rooms" className={m.textLink}>
              {t('rooms.viewAll')}
            </Link>
          </div>
        </Reveal>

        <ul className={styles.roomGrid}>
          {roomTypes.map((room, index) => (
            <li key={room.code}>
              <Reveal delay={index * 120}>
                <Link href="/rooms" className={styles.roomCard}>
                  <span
                    className={styles.roomFill}
                    data-swatch={room.imageKey}
                  >
                    <Photo
                      photo={resolveRoomPhoto(
                        room,
                        activeLocale,
                        tPhoto('room', { name: room.name[activeLocale] }),
                      )}
                      sizes="(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 25vw"
                    />
                  </span>
                  <span className={styles.roomInfo}>
                    <span className={styles.roomCategory}>
                      <bdi>{room.category[activeLocale]}</bdi>
                    </span>
                    <span className={styles.roomName}>
                      <bdi>{room.name[activeLocale]}</bdi>
                    </span>
                    <span className={styles.roomPrice}>
                      {t('rooms.from')}{' '}
                      {formatMoney(room.baseRate, tCommon('currency'), activeLocale)}{' '}
                      {tCommon('perNight')}
                    </span>
                  </span>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      {/* --- Facilities --- */}
      <Section tone="light">
        <Reveal>
          <SectionLabel>{t('facilities.label')}</SectionLabel>
          <SectionHeading accent={t('facilities.titleAccent')}>
            {t('facilities.title')}
          </SectionHeading>
          <BodyText className={styles.facilitiesIntro}>
            {t('facilities.intro')}
          </BodyText>
        </Reveal>

        <ul className={styles.facilityGrid}>
          {FACILITIES.map((facility, index) => (
            <li key={facility.key}>
              <Reveal delay={index * 120}>
                <figure className={styles.facility}>
                  <div className={styles.facilityVisual}>
                    <Photo
                      photo={propertyPhoto(
                        facility.photo,
                        tPhoto(facility.key),
                      )}
                      sizes="(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 25vw"
                    />
                  </div>
                  <figcaption>
                    <h3 className={styles.facilityName}>
                      {t(`facilities.items.${facility.key}Name`)}
                    </h3>
                    <BodyText>
                      {t(`facilities.items.${facility.key}Body`)}
                    </BodyText>
                  </figcaption>
                </figure>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      {/* --- Chef's quote band --- */}
      <QuoteBand
        quote={t('band.quote')}
        attribution={t('band.attribution')}
      >
        <Weave opacity={0.06} gap={20} />
        <Glow centre width={600} height={300} strength={0.08} />
      </QuoteBand>

      {/* --- Experiences --- */}
      <Section tone="linen">
        <Reveal>
          <SectionLabel>{t('experiences.label')}</SectionLabel>
          <SectionHeading accent={t('experiences.titleAccent')}>
            {t('experiences.title')}
          </SectionHeading>
        </Reveal>

        <ol className={styles.experienceList}>
          {(['desert', 'city', 'car'] as const).map((key, index) => (
            <li key={key}>
              <Reveal delay={index * 120}>
                <div className={styles.experience}>
                  <span className={styles.experienceNumber} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className={styles.experienceTitle}>
                    {t(`experiences.items.${key}Title`)}
                  </h3>
                  <BodyText>{t(`experiences.items.${key}Body`)}</BodyText>
                  <Link href="/coming-soon" className={m.textLink}>
                    {t(`experiences.items.${key}Link`)}
                  </Link>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </Section>

      {/* --- Press --- */}
      <Section tone="light">
        <Reveal>
          <SectionLabel>{t('press.label')}</SectionLabel>
          <SectionHeading accent={t('press.titleAccent')}>
            {t('press.title')}
          </SectionHeading>
        </Reveal>

        <ul className={styles.pressList}>
          {(['one', 'two', 'three'] as const).map((key, index) => (
            <li key={key}>
              <Reveal delay={index * 120}>
                <figure className={styles.press}>
                  <figcaption className={styles.pressSource}>
                    {t(`press.items.${key}Source`)}
                  </figcaption>
                  <blockquote className={styles.pressQuote}>
                    {t(`press.items.${key}Quote`)}
                  </blockquote>
                  <p className={styles.pressAward}>
                    {t(`press.items.${key}Award`)}
                  </p>
                </figure>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      {/* --- Guest voices --- */}
      <Section tone="linen" className={styles.guests}>
        <Reveal>
          <SectionHeading accent={t('guests.titleAccent')}>
            {t('guests.title')}
          </SectionHeading>
        </Reveal>

        <ul className={styles.guestList}>
          {(['one', 'two', 'three'] as const).map((key, index) => (
            <li key={key}>
              <Reveal delay={index * 120}>
                <figure className={styles.guest}>
                  <blockquote className={styles.guestQuote}>
                    {t(`guests.items.${key}Quote`)}
                  </blockquote>
                  <figcaption className={styles.guestAttribution}>
                    {t(`guests.items.${key}Name`)} ·{' '}
                    {t(`guests.items.${key}City`)}
                  </figcaption>
                </figure>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
