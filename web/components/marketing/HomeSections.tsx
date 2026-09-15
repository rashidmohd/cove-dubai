/**
 * The home page below the hero.
 *
 * The three hero treatments under `(marketing)/preview/` are a choice about the
 * first screen, not about the whole page. Everything after it — about, rooms,
 * facilities, the chef's band, experiences, press, guest voices — is the same
 * for all of them, and lives here so that comparing the heroes compares the
 * heroes rather than three drifting copies of a page.
 *
 * A Server Component, like the page it came from: the rooms strip reads live
 * room types, so editing a room in the admin panel updates every variant.
 */
import { getTranslations } from 'next-intl/server';

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
import { formatMoney } from '@/lib/format';
import { propertyPhoto, resolveRoomPhoto } from '@/lib/media';
import type { PropertyPhotoName } from '@/lib/media';
import type { Locale, RoomType } from '@/lib/api/types';

import styles from './HomeSections.module.css';

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

export async function HomeSections({
  locale,
  roomTypes,
}: {
  locale: Locale;
  roomTypes: RoomType[];
}) {
  const t = await getTranslations('home');
  const tCommon = await getTranslations('common');
  const tPhoto = await getTranslations('photos');

  return (
    <>
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
                { value: t('stats.roomsValue'), label: t('stats.roomsLabel') },
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
                  <span className={styles.roomFill} data-swatch={room.imageKey}>
                    <Photo
                      photo={resolveRoomPhoto(
                        room,
                        locale,
                        tPhoto('room', { name: room.name[locale] }),
                      )}
                      sizes="(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 25vw"
                    />
                  </span>
                  <span className={styles.roomInfo}>
                    <span className={styles.roomCategory}>
                      <bdi>{room.category[locale]}</bdi>
                    </span>
                    <span className={styles.roomName}>
                      <bdi>{room.name[locale]}</bdi>
                    </span>
                    <span className={styles.roomPrice}>
                      {t('rooms.from')}{' '}
                      {formatMoney(room.baseRate, tCommon('currency'), locale)}{' '}
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
      <QuoteBand quote={t('band.quote')} attribution={t('band.attribution')}>
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
