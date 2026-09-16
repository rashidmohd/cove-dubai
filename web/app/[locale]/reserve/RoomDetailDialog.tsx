'use client';

/**
 * What a room actually is, without leaving step 2.
 *
 * The room list is deliberately terse — a name, a category, a rooms-left count
 * and a price — and a guest choosing between four of them needs more than that.
 * This is where the more lives, and it opens in place: a guest mid-booking who
 * is sent to another page has to find their way back, and the comparison they
 * were making is over.
 *
 * **Nothing is fetched here.** `AvailableRoomType` extends `RoomType`, so the
 * availability response the step already holds carries the description,
 * amenities and photographs, and the price it carries is the real total for the
 * guest's nights. The dialog is a different view of data that has already
 * arrived, not a second request.
 *
 * A native `<dialog>` with `showModal()`, as the admin panel's `ConfirmDialog`
 * uses: it brings the focus trap, the Escape key and top-layer stacking with no
 * library, which is most of what WCAG 2.1 AA asks of a modal (CLAUDE.md).
 */
import { useEffect, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';

import { Photo } from '@/components/marketing';
import { RoomDetailBody } from '@/components/RoomDetail';
import type { AvailableRoomType, Locale } from '@/lib/api/types';
import { formatMoney } from '@/lib/format';
import { resolveRoomPhoto } from '@/lib/media';
import styles from './Reserve.module.css';

export function RoomDetailDialog({
  room,
  locale,
  nights,
  selected,
  onSelect,
  onDismiss,
}: {
  /** Null when nothing is open — the dialog stays mounted and closed. */
  room: AvailableRoomType | null;
  locale: Locale;
  nights: number;
  selected: boolean;
  onSelect: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('reserve');
  const tRooms = useTranslations('rooms');
  const tCommon = useTranslations('common');
  const tPhoto = useTranslations('photos');

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (room && !dialog.open) dialog.showModal();
    if (!room && dialog.open) dialog.close();
  }, [room]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.detailDialog}
      aria-labelledby={titleId}
      // The `cancel` event is Escape. Prevented so the close goes through the
      // caller's state, which is what the effect above reads — otherwise the
      // element closes itself and React still believes a room is open.
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      // Clicking the backdrop. The `<dialog>` element itself fills the
      // viewport and the card inside it stops the event, so a click that
      // lands on this element landed outside the card.
      onClick={(event) => {
        if (event.target === dialogRef.current) onDismiss();
      }}
      data-testid="room-detail-dialog"
    >
      {/* Mounted only while a room is open. Without this the dialog would
          render the previous room's photograph and price for a frame as it
          closes, and — worse — keep them in the accessibility tree. */}
      {room ? (
        <div
          className={styles.detailCard}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.detailClose}
            onClick={onDismiss}
            aria-label={tCommon('close')}
            data-testid="room-detail-close"
          >
            <span aria-hidden="true">×</span>
          </button>

          <div className={styles.detailVisual} data-swatch={room.imageKey}>
            <Photo
              photo={resolveRoomPhoto(
                room,
                locale,
                tPhoto('room', { name: room.name[locale] }),
              )}
              sizes="(max-width: 700px) 100vw, 640px"
            />
          </div>

          <div className={styles.detailBody}>
            <p className={styles.detailCategory}>
              <bdi>{room.category[locale]}</bdi>
            </p>
            <h2 id={titleId} className={styles.detailName}>
              <bdi data-testid="room-detail-name">{room.name[locale]}</bdi>
            </h2>

            <RoomDetailBody room={room} locale={locale} amenitiesHeading="h3" />

            <div className={styles.detailFooter}>
              <p className={styles.detailPrice}>
                <span className={styles.detailPriceLabel}>
                  {tRooms('detail.forStay')}
                </span>
                <span
                  className={styles.detailAmount}
                  data-testid="room-detail-amount"
                >
                  {formatMoney(
                    room.price.grandTotal,
                    room.price.currency,
                    locale,
                  )}
                </span>
                <span className={styles.detailPer}>
                  {nights} {nights === 1 ? tCommon('night') : tCommon('nights')}
                </span>
              </p>

              {/* Selecting from here closes the dialog and leaves the room
                  chosen in the list behind it, so the guest carries on where
                  they were rather than having to find the row again. A room
                  that is already selected gets the plain close instead — a
                  button that repeats what is already true reads as a failure
                  to register the first press. */}
              <button
                type="button"
                className={styles.detailAction}
                onClick={selected ? onDismiss : onSelect}
                data-testid="room-detail-select"
              >
                {selected ? t('step2.selected') : t('step2.selectRoom')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
