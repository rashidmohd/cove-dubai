'use client';

/**
 * Room types — content and base rate, both languages on one screen.
 *
 * English and Arabic sit side by side in the same form deliberately. The
 * `arabic-rtl` rule is that neither language can silently go missing, and an
 * editor who has to switch screens to add the Arabic name will eventually
 * forget. The API rejects a partial pair for the same reason.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  adminApi,
  type AdminAmenity,
  type AdminRoomType,
} from '@/lib/api/admin-client';
import type { AmenityCategory, Locale } from '@/lib/api/types';
import { formatMoney, formatNumber } from '@/lib/format';
import { AdminShell } from '../AdminShell';
import { useAdminSession } from '../AdminSession';
import { EditIcon } from '../icons';
import { RoomImages } from './RoomImages';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  Loading,
  Num,
  SavedNote,
  Select,
  Textarea,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

/** Display order for the amenity groups, matching the guest-facing page. */
const CATEGORY_ORDER: AmenityCategory[] = [
  'bathroom',
  'comfort',
  'technology',
  'services',
  'accessibility',
];

export function RoomTypes({ locale }: { locale: Locale }) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();
  const { admin } = useAdminSession();

  const [roomTypes, setRoomTypes] = useState<AdminRoomType[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Editing a room type changes published prices and public copy, so the API
  // restricts it to ADMIN. Hiding the button matches that rather than letting
  // staff discover the rule by getting a 403.
  const canEdit = admin.role === 'ADMIN';

  async function load(): Promise<void> {
    try {
      setRoomTypes(await adminApi.listRoomTypes());
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminShell
      title={t('nav.rooms')}
      meta={
        roomTypes ? t('rooms.count', { count: roomTypes.length }) : undefined
      }
    >
      <ErrorNote message={error} />
      <SavedNote message={saved} />

      {!roomTypes && !error ? <Loading /> : null}

      {roomTypes?.map((roomType) =>
        editing === roomType.code ? (
          <RoomTypeForm
            key={roomType.code}
            roomType={roomType}
            onCancel={() => setEditing(null)}
            onSaved={async (name) => {
              setEditing(null);
              setSaved(t('rooms.saved', { name }));
              await load();
            }}
            onError={setError}
          />
        ) : (
          <Card key={roomType.code}>
            <CardHeader
              title={<bdi>{roomType.name[locale]}</bdi>}
              description={
                <span className={styles.mono}>
                  <Num>{roomType.code}</Num>
                </span>
              }
              actions={
                <>
                  {/* States the condition, not a bare "Yes" — a badge has to
                      mean something on its own, away from the label it
                      answered. */}
                  <Badge tone={roomType.isActive ? 'success' : 'neutral'} dot>
                    {roomType.isActive
                      ? t('rooms.onSaleYes')
                      : t('rooms.onSaleNo')}
                  </Badge>
                  {canEdit ? (
                    <Button
                      size="small"
                      onClick={() => {
                        setSaved(null);
                        setEditing(roomType.code);
                      }}
                    >
                      <EditIcon className={styles.icon} size="0.875rem" />
                      {t('rooms.edit')}
                    </Button>
                  ) : null}
                </>
              }
              tight
            />

            <CardBody>
              <dl className={styles.defGrid}>
                <Figure
                  label={t('rooms.baseRate')}
                  value={<Num>{formatMoney(roomType.baseRate, 'AED', locale)}</Num>}
                />
                <Figure
                  label={t('rooms.maxOccupancy')}
                  value={<Num>{formatNumber(roomType.maxOccupancy, locale)}</Num>}
                />
                <Figure
                  label={t('rooms.totalRooms')}
                  value={<Num>{formatNumber(roomType.totalRooms, locale)}</Num>}
                />
                {/* No "On sale" figure here — the badge in the header above
                    already answers it, and twice is once too many. */}
              </dl>
            </CardBody>

            <RoomImages
              roomType={roomType}
              locale={locale}
              canEdit={canEdit}
              onChanged={(updated) => {
                // Patch the one room type in place rather than reloading the
                // whole screen: a gallery edit changes nothing else, and a
                // reload would collapse any open editor further down the page.
                setRoomTypes((current) =>
                  (current ?? []).map((item) =>
                    item.code === updated.code ? updated : item,
                  ),
                );
                setSaved(null);
              }}
              onError={setError}
            />

            <AmenityPicker
              roomType={roomType}
              locale={locale}
              canEdit={canEdit}
              onSaved={async () => {
                setSaved(t('rooms.amenitiesSaved'));
                await load();
              }}
              onError={setError}
            />
          </Card>
        ),
      )}
    </AdminShell>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className={styles.defLabel}>{label}</dt>
      <dd className={styles.defValue}>{value}</dd>
    </div>
  );
}

/**
 * Choose which amenities this room type has.
 *
 * The full vocabulary is loaded once and shown grouped, with checkboxes,
 * because the useful question is "what does this room have" rather than "add
 * one at a time". Saving replaces the whole list in a single request, which is
 * also how the API applies it — atomically, so a failure cannot leave the room
 * with half its amenities.
 *
 * Withdrawn amenities are hidden unless this room still has one, in which case
 * it is shown and labelled, so the state is visible rather than mysterious.
 */
function AmenityPicker({
  roomType,
  locale,
  canEdit,
  onSaved,
  onError,
}: {
  roomType: AdminRoomType;
  locale: Locale;
  canEdit: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [all, setAll] = useState<AdminAmenity[] | null>(null);
  // `?? []` throughout: the shared RoomType type marks amenities optional
  // because the guest pages can meet a cached older response. The admin client
  // never caches, so in practice it is always present here.
  const chosen = roomType.amenities ?? [];
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(chosen.map((amenity) => amenity.code)),
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || all) return;
    adminApi
      .listAmenities()
      .then(setAll)
      .catch((caught: unknown) => onError(describeError(caught)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, all]);

  // Re-sync if the room type is reloaded from the server after a save.
  useEffect(() => {
    setSelected(
      new Set((roomType.amenities ?? []).map((amenity) => amenity.code)),
    );
  }, [roomType.amenities]);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await adminApi.setRoomTypeAmenities(roomType.code, [...selected]);
      setOpen(false);
      await onSaved();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CardHeader
        title={t('amenities.title')}
        headingLevel={3}
        actions={
          <>
            <Badge tone="neutral">
              <Num>{formatNumber(chosen.length, locale)}</Num>
            </Badge>
            {canEdit && !open ? (
              <Button size="small" onClick={() => setOpen(true)}>
                {t('amenities.choose')}
              </Button>
            ) : null}
          </>
        }
      />

      <CardBody>
        {chosen.length === 0 ? (
          <p className={styles.hint}>{t('amenities.noneOnRoom')}</p>
        ) : (
          <ul className={styles.chipList}>
            {chosen.map((amenity) => (
              <li key={amenity.code} className={styles.chip}>
                <bdi>{amenity.name[locale]}</bdi>
              </li>
            ))}
          </ul>
        )}

        {open ? (
          all ? (
            <div className={`${styles.stack} ${styles.amenityEditor}`}>
              {CATEGORY_ORDER.map((category) => {
                const inCategory = all.filter(
                  (amenity) =>
                    amenity.category === category &&
                    // Hide withdrawn amenities unless this room still lists one.
                    (amenity.isActive || selected.has(amenity.code)),
                );
                if (inCategory.length === 0) return null;

                return (
                  <fieldset key={category} className={styles.fieldset}>
                    <legend className={styles.legend}>
                      {t(`amenities.categories.${category}`)}
                    </legend>

                    <div className={styles.checkOptions}>
                      {inCategory.map((amenity) => (
                        <label key={amenity.code} className={styles.checkOption}>
                          <input
                            className={styles.checkbox}
                            type="checkbox"
                            checked={selected.has(amenity.code)}
                            onChange={(event) => {
                              const next = new Set(selected);
                              if (event.target.checked) next.add(amenity.code);
                              else next.delete(amenity.code);
                              setSelected(next);
                            }}
                          />
                          <bdi>{amenity.name[locale]}</bdi>
                          {!amenity.isActive ? (
                            <span className={styles.hint}>
                              ({t('amenities.withdrawn')})
                            </span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}

              <div className={styles.formActions}>
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={busy}
                >
                  {busy ? t('saving') : t('save')}
                </Button>
                <Button
                  onClick={() => {
                    // Discard the edit by resetting to what the server holds.
                    setSelected(new Set(chosen.map((a) => a.code)));
                    setOpen(false);
                  }}
                  disabled={busy}
                >
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Loading />
          )
        ) : null}
      </CardBody>
    </>
  );
}

function RoomTypeForm({
  roomType,
  onCancel,
  onSaved,
  onError,
}: {
  roomType: AdminRoomType;
  onCancel: () => void;
  onSaved: (name: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [nameEn, setNameEn] = useState(roomType.name.en);
  const [nameAr, setNameAr] = useState(roomType.name.ar);
  const [descriptionEn, setDescriptionEn] = useState(roomType.description.en);
  const [descriptionAr, setDescriptionAr] = useState(roomType.description.ar);
  const [baseRate, setBaseRate] = useState(String(roomType.baseRate));
  const [maxOccupancy, setMaxOccupancy] = useState(
    String(roomType.maxOccupancy),
  );
  const [isActive, setIsActive] = useState(roomType.isActive);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    try {
      await adminApi.updateRoomType(roomType.code, {
        name: { en: nameEn.trim(), ar: nameAr.trim() },
        description: {
          en: descriptionEn.trim(),
          ar: descriptionAr.trim(),
        },
        baseRate: Number(baseRate),
        maxOccupancy: Number(maxOccupancy),
        isActive,
      });
      await onSaved(nameEn.trim());
    } catch (caught) {
      onError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader
          title={t('rooms.editing')}
          description={
            <span className={styles.mono}>
              <Num>{roomType.code}</Num>
            </span>
          }
          tight
        />

        <CardBody className={styles.stack}>
          {/* Each language's field is marked with its own lang and dir, so an
              Arabic value renders right-to-left in the Almarai face even while
              the panel itself is in English — and the reverse. */}
          <div className={styles.formGrid}>
            <Field label={t('rooms.nameEn')}>
              <Input
                value={nameEn}
                onChange={(event) => setNameEn(event.target.value)}
                lang="en"
                dir="ltr"
                required
              />
            </Field>
            <Field label={t('rooms.nameAr')}>
              <Input
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                lang="ar"
                dir="rtl"
                required
              />
            </Field>
          </div>

          <Field label={t('rooms.descriptionEn')}>
            <Textarea
              value={descriptionEn}
              onChange={(event) => setDescriptionEn(event.target.value)}
              lang="en"
              dir="ltr"
              required
            />
          </Field>

          <Field label={t('rooms.descriptionAr')}>
            <Textarea
              value={descriptionAr}
              onChange={(event) => setDescriptionAr(event.target.value)}
              lang="ar"
              dir="rtl"
              required
            />
          </Field>

          <div className={styles.formGrid}>
            <Field label={t('rooms.baseRate')} hint={t('rooms.rateNote')}>
              <Input
                type="number"
                min="0"
                step="1"
                value={baseRate}
                onChange={(event) => setBaseRate(event.target.value)}
                dir="ltr"
                required
              />
            </Field>
            <Field label={t('rooms.maxOccupancy')}>
              <Input
                type="number"
                min="1"
                max="20"
                value={maxOccupancy}
                onChange={(event) => setMaxOccupancy(event.target.value)}
                dir="ltr"
                required
              />
            </Field>
            <Field label={t('rooms.onSale')}>
              <Select
                value={isActive ? 'yes' : 'no'}
                onChange={(event) => setIsActive(event.target.value === 'yes')}
              >
                <option value="yes">{t('rooms.yes')}</option>
                <option value="no">{t('rooms.no')}</option>
              </Select>
            </Field>
          </div>

          <div className={styles.formActions}>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? t('saving') : t('save')}
            </Button>
            <Button onClick={onCancel} disabled={busy}>
              {t('cancel')}
            </Button>
          </div>
        </CardBody>
      </form>
    </Card>
  );
}
