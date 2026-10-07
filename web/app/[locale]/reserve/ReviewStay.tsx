'use client';

/** As many photographs as the room list shows per room. */
const PHOTO_LIMIT = 5;

/**
 * Step 3 — the stay and its price, before the guest's details.
 *
 * Its own step so the guest settles what they are paying — every line of it,
 * and any discount code — before typing a name or an email. On a phone the
 * summary panel sits below the whole form, so without this step the price was
 * first seen after the "Confirm" button, and the code field beneath that.
 *
 * Nothing is priced here. The breakdown is `StayBreakdown`, the same component
 * the sidebar uses, fed the API's figures (`pms-readiness`); applying a code
 * asks the API to reprice the stay.
 *
 * On a desktop the room's photographs sit beside the price, in what was empty
 * space, so the guest sees which room they are paying for. No "View details"
 * link: they reach this step having just chosen the room, and "Back" returns
 * to the list where every room's details are. Narrower screens leave the
 * photographs out — there they would push the price below the fold, which is
 * what this step exists to avoid.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { RoomCarousel } from '@/components/marketing';
import { resolveRoomPhotos } from '@/lib/media';
import type {
  AvailableRoomType,
  Locale,
  PriceBreakdown,
  VoucherPreview,
} from '@/lib/api/types';
import { StayBreakdown, VoucherField } from './StaySummary';
import styles from './Reserve.module.css';

export function ReviewStay({
  locale,
  checkIn,
  checkOut,
  adults,
  childCount,
  room,
  price,
  voucher,
  onApplyVoucher,
  onRemoveVoucher,
  onBack,
  onContinue,
  barTotal,
}: {
  locale: Locale;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  childCount: number;
  room: AvailableRoomType | null;
  price: PriceBreakdown | null;
  voucher: VoucherPreview | null;
  /** Resolves to an error message to show inline, or null on success. */
  onApplyVoucher: (code: string) => Promise<string | null>;
  onRemoveVoucher: () => void;
  onBack: () => void;
  onContinue: () => void;
  /** The total, shown in the action row a phone pins to the screen's foot. */
  barTotal?: ReactNode;
}) {
  const t = useTranslations('reserve');
  const tCommon = useTranslations('common');
  const tRooms = useTranslations('rooms');
  const tPhoto = useTranslations('photos');

  return (
    <>
      {/* The room is still being re-fetched after a restored session. */}
      {!room || !price ? (
        <p className={styles.loading}>{tCommon('loading')}</p>
      ) : (
        <div className={styles.reviewLayout}>
          <section
            className={styles.reviewPanel}
            aria-label={t('summary.title')}
            data-testid="review-stay"
          >
            <StayBreakdown
              locale={locale}
              checkIn={checkIn}
              checkOut={checkOut}
              adults={adults}
              childCount={childCount}
              room={room}
              price={price}
            />
            <VoucherField
              locale={locale}
              voucher={voucher}
              onApply={onApplyVoucher}
              onRemove={onRemoveVoucher}
            />
          </section>

          {/* The gradient behind it is the loading and the no-photograph state,
            as on the room cards. */}
          <figure className={styles.reviewRoom} data-testid="review-room">
            <div className={styles.reviewPhoto} data-swatch={room.imageKey}>
              <RoomCarousel
                photos={resolveRoomPhotos(
                  room,
                  locale,
                  tPhoto('room', { name: room.name[locale] }),
                  PHOTO_LIMIT,
                )}
                sizes="(max-width: 1000px) 0px, 40vw"
                label={room.name[locale]}
                labels={{
                  previous: tRooms('carousel.previous'),
                  next: tRooms('carousel.next'),
                  // Placeholders left for the carousel to fill.
                  slide: tRooms.raw('carousel.slide') as string,
                }}
              />
            </div>
            <figcaption className={styles.reviewCaption}>
              <span className={styles.roomCategory}>
                <bdi>{room.category[locale]}</bdi>
              </span>
              <span className={styles.reviewRoomName}>
                <bdi>{room.name[locale]}</bdi>
              </span>
            </figcaption>
          </figure>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btnBack} onClick={onBack}>
          {t('back')}
        </button>
        {barTotal}
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onContinue}
          disabled={!room || !price}
          data-testid="continue-to-guest"
        >
          {t('continue')}
        </button>
      </div>
    </>
  );
}
