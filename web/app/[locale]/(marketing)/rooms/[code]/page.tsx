/**
 * A single room type.
 *
 * The page a guest reaches by clicking a room — from the Rooms listing, or from
 * the room list in step 2 of the booking flow, where the cards are deliberately
 * terse and this is where the detail lives.
 *
 * **Statically rendered, like the listing it came from.** The query string can
 * carry the stay a guest is mid-way through choosing, and the price for those
 * nights is not cacheable — but reading `searchParams` here would opt the whole
 * page out of prerendering, and a room page is the most valuable thing a hotel
 * has to show a searcher. So the stay-specific part is the client `StayCta`
 * below, and everything a searcher and the first paint need is static HTML in
 * both languages.
 *
 * Room data comes from the API, so the hotel's admin panel is the only place a
 * room is edited. Specs (size, bed, view) remain marketing copy in the message
 * files, exactly as on the listing — see the note there for why they are not
 * database fields in Phase 1.
 */
import { Suspense } from 'react';
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
} from '@/components/marketing';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';
import { bookingApi } from '@/lib/api/client';
import { resolveRoomPhoto } from '@/lib/media';
import type { Locale, RoomType } from '@/lib/api/types';
import { StayCta, StayCtaFallback } from './StayCta';
import styles from './page.module.css';

const SPEC_KEYS = ['size', 'bed', 'view', 'bathroom', 'floor'] as const;

/** See the listing page: measurements and ranges must not be bidi-reordered. */
const LTR_SPEC_KEYS = new Set<string>(['size', 'floor']);

/**
 * One room type, or null.
 *
 * Reads the cached list rather than a per-room endpoint. There are a handful of
 * room types, `getRoomTypes` already carries amenities and photographs, and its
 * response is revalidated hourly and shared with the listing page — so this
 * costs nothing beyond a find, and adds no API surface to keep in step.
 */
async function findRoom(code: string): Promise<RoomType | null> {
  try {
    const roomTypes = await bookingApi.getRoomTypes();
    return roomTypes.find((room) => room.code === code) ?? null;
  } catch {
    // Matches the listing page: a build must not fail because the API was
    // briefly unreachable. `notFound()` is the honest response — the page
    // cannot be shown — and the next revalidation will render it properly.
    return null;
  }
}

/**
 * Prerender every room in both languages.
 *
 * Unknown codes still render on demand (`dynamicParams` defaults to true), so a
 * room added in the admin panel between deploys is reachable immediately rather
 * than 404-ing until the next build.
 */
export async function generateStaticParams() {
  try {
    const roomTypes = await bookingApi.getRoomTypes();
    return roomTypes.map((room) => ({ code: room.code }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/rooms/[code]'>): Promise<Metadata> {
  const { locale, code } = await params;
  if (!isLocale(locale)) return {};

  const room = await findRoom(code);
  if (!room) return {};

  return {
    title: room.name[locale],
    description: room.description[locale],
    alternates: {
      canonical: `/${locale}/rooms/${code}`,
      languages: Object.fromEntries(
        locales.map((alt) => [alt, `/${alt}/rooms/${code}`]),
      ),
    },
  };
}

export default async function RoomDetailPage({
  params,
}: PageProps<'/[locale]/rooms/[code]'>) {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const room = await findRoom(code);
  if (!room) notFound();

  const t = await getTranslations('rooms');
  const tCommon = await getTranslations('common');
  const tPhoto = await getTranslations('photos');

  const photo = resolveRoomPhoto(
    room,
    locale,
    tPhoto('room', { name: room.name[locale] }),
  );

  // Primary first, and it is already the hero above — so the gallery is the
  // rest. A room with one photograph has no gallery rather than an empty
  // heading over a repeat of the picture directly above it.
  const gallery = (room.images ?? []).slice(1);

  return (
    <>
      <div className={styles.hero} data-swatch={room.imageKey}>
        <Photo photo={photo} sizes="100vw" priority />
      </div>

      <Section tone="light">
        <Reveal>
          <nav className={styles.breadcrumb} aria-label={t('title')}>
            <Link href="/rooms" className={styles.crumb}>
              {t('detail.allRooms')}
            </Link>
          </nav>

          <SectionLabel>{room.category[locale]}</SectionLabel>
          <SectionHeading as="h1">
            <bdi data-testid="room-detail-name">{room.name[locale]}</bdi>
          </SectionHeading>
          <BodyText className={styles.description}>
            <bdi>{room.description[locale]}</bdi>
          </BodyText>

          <dl className={styles.specs}>
            {SPEC_KEYS.map((key) => {
              // Optional, as on the listing: a room added in the admin panel
              // has no copy here until the client writes it, and a missing
              // spec must not render rather than throw.
              const value = t.has(`specs.${room.code}.${key}`)
                ? t(`specs.${room.code}.${key}`)
                : null;
              if (!value) return null;

              return (
                <div key={key} className={styles.spec}>
                  <dt className={styles.specLabel}>{t(`specLabels.${key}`)}</dt>
                  <dd className={styles.specValue}>
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
              <dt className={styles.specLabel}>{tCommon('adults')}</dt>
              <dd className={styles.specValue}>
                {t('sleeps', { count: room.maxOccupancy })}
              </dd>
            </div>
          </dl>

          {/* `?? []` is load-bearing here for the same reason as the listing:
              this response is cached for an hour and the two services deploy
              independently, so one predating the field is a normal state. */}
          {(room.amenities ?? []).length > 0 ? (
            <div className={styles.amenities}>
              <h2 className={styles.amenitiesTitle}>{t('amenitiesTitle')}</h2>
              <ul className={styles.amenityList}>
                {(room.amenities ?? []).map((amenity) => (
                  <li key={amenity.code} className={styles.amenityItem}>
                    <bdi>{amenity.name[locale]}</bdi>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* The fallback is what the static HTML carries: the "from" rate and
              a working reserve link. `StayCta` replaces it in the browser when
              the URL names a stay, with the real total for those nights. A
              guest arriving without dates never sees a flash — the two render
              the same shape. */}
          <Suspense
            fallback={
              <StayCtaFallback
                roomCode={room.code}
                baseRate={room.baseRate}
                locale={locale as Locale}
              />
            }
          >
            <StayCta
              roomCode={room.code}
              baseRate={room.baseRate}
              locale={locale as Locale}
            />
          </Suspense>
        </Reveal>
      </Section>

      {gallery.length > 0 ? (
        <Section tone="linen">
          <Reveal>
            <h2 className={styles.galleryTitle}>{t('detail.gallery')}</h2>
            <ul className={styles.gallery}>
              {gallery.map((image) => (
                <li key={image.storageKey} className={styles.galleryItem}>
                  <Photo
                    photo={{
                      url: image.url,
                      alt: image.alt[locale],
                      width: image.width,
                      height: image.height,
                    }}
                    sizes="(max-width: 900px) 100vw, 33vw"
                  />
                </li>
              ))}
            </ul>
          </Reveal>
        </Section>
      ) : null}
    </>
  );
}
