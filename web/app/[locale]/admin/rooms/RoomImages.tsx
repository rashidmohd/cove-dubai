'use client';

/**
 * A room type's photographs.
 *
 * The upload is a three-step handshake and it is worth knowing why:
 *
 *   1. Ask the API to sign a one-shot URL for exactly this file's type and size.
 *   2. **PUT the bytes straight to object storage from the browser.** They never
 *      pass through our API, which would otherwise buffer multi-megabyte
 *      photography in the same process that holds the booking transaction.
 *   3. Tell the API it landed, which is the only step that writes a row.
 *
 * Splitting 2 and 3 is what stops a failed transfer leaving a gallery entry
 * pointing at bytes that are not there.
 *
 * Ordering is done with buttons rather than drag-and-drop. Dragging is not
 * reachable by keyboard without a substantial amount of extra work, and WCAG
 * 2.1 AA is not optional here — two buttons are also simply less to go wrong.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { adminApi, type AdminRoomType } from '@/lib/api/admin-client';
import { ApiError } from '@/lib/api/client';
import type { Locale } from '@/lib/api/types';
import { AddIcon, DeleteIcon, NextIcon, PreviousIcon } from '../icons';
import {
  Badge,
  Button,
  CardBody,
  CardHeader,
  cx,
  Field,
  Input,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

/** What the browser can measure about a file before it is uploaded. */
interface Measured {
  file: File;
  width: number;
  height: number;
  /** An object URL for the preview. Revoked when the picker is reset. */
  previewUrl: string;
}

/**
 * Read a file's intrinsic pixel dimensions.
 *
 * Stored alongside the image so the front-end can reserve its space before it
 * loads — unsized images are the usual way to blow the CLS budget. Measured
 * here because the browser is the only place that can do it without decoding
 * the image on the server.
 */
function measure(file: File): Promise<Measured> {
  return new Promise((resolve, reject) => {
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({ file, width: image.naturalWidth, height: image.naturalHeight, previewUrl });
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error('unreadable'));
    };
    image.src = previewUrl;
  });
}

export function RoomImages({
  roomType,
  locale,
  canEdit,
  onChanged,
  onError,
}: {
  roomType: AdminRoomType;
  locale: Locale;
  canEdit: boolean;
  onChanged: (updated: AdminRoomType) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const images = roomType.images ?? [];

  const [picked, setPicked] = useState<Measured | null>(null);
  const [altEn, setAltEn] = useState('');
  const [altAr, setAltAr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    if (picked) URL.revokeObjectURL(picked.previewUrl);
    setPicked(null);
    setAltEn('');
    setAltAr('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      setPicked(await measure(file));
    } catch {
      onError(t('images.unreadable'));
    }
  }

  async function upload() {
    if (!picked) return;

    setBusy(true);
    try {
      const { uploadUrl, storageKey } = await adminApi.requestImageUpload({
        contentType: picked.file.type,
        byteSize: picked.file.size,
        width: picked.width,
        height: picked.height,
      });

      // Straight to object storage. `Content-Type` must match what was signed
      // exactly or the store rejects it — the signature pins it precisely so a
      // URL issued for a photograph cannot be used to host something else.
      // `Content-Length` is set by the browser from the body and cannot be
      // forged from script, so it is deliberately not passed here.
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': picked.file.type },
        body: picked.file,
      });

      if (!put.ok) {
        // Most often the bucket's CORS rule: the browser blocks the response
        // and this reads as a network failure with no useful status.
        onError(t('images.uploadFailed', { status: put.status }));
        return;
      }

      const updated = await adminApi.addRoomTypeImage(roomType.code, {
        storageKey,
        contentType: picked.file.type,
        byteSize: picked.file.size,
        width: picked.width,
        height: picked.height,
        alt: { en: altEn.trim(), ar: altAr.trim() },
      });

      onChanged(updated);
      reset();
    } catch (caught) {
      // A cross-origin PUT blocked by CORS surfaces as a TypeError with no
      // status at all, which `describeError` cannot say anything useful about.
      if (caught instanceof TypeError) {
        onError(t('images.corsBlocked'));
      } else if (
        caught instanceof ApiError &&
        caught.code === 'MEDIA_NOT_CONFIGURED'
      ) {
        onError(t('images.notConfigured'));
      } else {
        onError(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  async function act(run: () => Promise<AdminRoomType>) {
    setBusy(true);
    try {
      onChanged(await run());
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  /** Swap an image with its neighbour and send the whole new order. */
  function move(index: number, delta: number) {
    const keys = images.map((image) => image.storageKey);
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;

    const next = [...keys];
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;

    void act(() => adminApi.reorderRoomTypeImages(roomType.code, next));
  }

  return (
    <>
      <CardHeader
        title={t('images.title')}
        headingLevel={3}
        description={images.length === 0 ? t('images.fallbackNote') : undefined}
        actions={<Badge tone="neutral">{images.length}</Badge>}
      />

      <CardBody>
        {images.length > 0 ? (
          <ul className={styles.gallery}>
            {images.map((image, index) => (
              <li key={image.storageKey} className={styles.galleryItem}>
                <div className={styles.galleryFrame}>
                  {/*
                    A plain <img>, not next/image. The optimiser needs the
                    remote host allow-listed at build time, and the media origin
                    is configuration that differs per environment. These are
                    admin thumbnails behind a login, not a Core Web Vitals
                    surface — width and height still prevent the reflow.
                  */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={image.alt[locale] || image.alt.en}
                    width={image.width}
                    height={image.height}
                    className={styles.galleryImage}
                    loading="lazy"
                  />
                </div>

                <div className={styles.galleryMeta}>
                  {index === 0 ? (
                    <Badge tone="accent">{t('images.primary')}</Badge>
                  ) : null}
                  {!image.alt.en && !image.alt.ar ? (
                    // Not decoration: an image with no alt text is a WCAG
                    // failure on the guest site, and it is invisible unless
                    // something says so here.
                    <Badge tone="warning" dot>
                      {t('images.noAlt')}
                    </Badge>
                  ) : null}
                  <span className={styles.galleryDims}>
                    <bdi>
                      {image.width}×{image.height}
                    </bdi>
                  </span>
                </div>

                {canEdit ? (
                  <div className={styles.rowActions}>
                    <Button
                      size="small"
                      disabled={busy || index === 0}
                      aria-label={t('images.moveEarlier')}
                      onClick={() => move(index, -1)}
                    >
                      <PreviousIcon
                        className={cx(styles.icon, styles.iconDirectional)}
                        size="0.875rem"
                      />
                    </Button>
                    <Button
                      size="small"
                      disabled={busy || index === images.length - 1}
                      aria-label={t('images.moveLater')}
                      onClick={() => move(index, 1)}
                    >
                      <NextIcon
                        className={cx(styles.icon, styles.iconDirectional)}
                        size="0.875rem"
                      />
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      disabled={busy}
                      aria-label={t('images.remove')}
                      onClick={() =>
                        void act(() =>
                          adminApi.removeRoomTypeImage(
                            roomType.code,
                            image.storageKey,
                          ),
                        )
                      }
                    >
                      <DeleteIcon className={styles.icon} size="0.875rem" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canEdit ? (
          <div className={styles.uploader}>
            <Field label={t('images.choose')} hint={t('images.formats')}>
              <input
                ref={fileInput}
                type="file"
                className={styles.fileInput}
                accept="image/webp,image/avif,image/jpeg,image/png"
                disabled={busy}
                onChange={(event) => void choose(event.target.files?.[0])}
              />
            </Field>

            {picked ? (
              <>
                <div className={styles.uploadPreview}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={picked.previewUrl}
                    alt=""
                    className={styles.galleryImage}
                  />
                  <p className={styles.hint}>
                    <bdi>
                      {picked.width}×{picked.height} ·{' '}
                      {Math.round(picked.file.size / 1024)} KB
                    </bdi>
                  </p>
                </div>

                {/*
                  Alt text is collected before the upload, not after. Asked for
                  afterwards it is skipped, and an image with no alt text is a
                  WCAG failure on a guest-facing page. Empty is still allowed —
                  that is the correct value for a purely decorative image — but
                  it has to be a decision rather than an omission.
                */}
                <div className={styles.formGrid}>
                  <Field label={t('images.altEn')} hint={t('images.altHint')}>
                    <Input
                      value={altEn}
                      onChange={(event) => setAltEn(event.target.value)}
                      lang="en"
                      dir="ltr"
                      disabled={busy}
                    />
                  </Field>
                  <Field label={t('images.altAr')}>
                    <Input
                      value={altAr}
                      onChange={(event) => setAltAr(event.target.value)}
                      lang="ar"
                      dir="rtl"
                      disabled={busy}
                    />
                  </Field>
                </div>

                <div className={styles.formActions}>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void upload()}
                  >
                    <AddIcon className={styles.icon} size="0.875rem" />
                    {busy ? t('images.uploading') : t('images.add')}
                  </Button>
                  <Button disabled={busy} onClick={reset}>
                    {t('cancel')}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </>
  );
}
