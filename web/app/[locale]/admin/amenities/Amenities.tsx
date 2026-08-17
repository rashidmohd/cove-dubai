'use client';

/**
 * Manage the amenity vocabulary.
 *
 * This is the shared list every room type draws from, so it is edited in one
 * place rather than per room. Which amenities a given room *has* is set on the
 * room type itself.
 *
 * Two behaviours worth knowing:
 *
 *   - **Withdraw, don't delete.** Setting an amenity inactive hides it from
 *     guests everywhere while leaving the room-type links intact, so it can be
 *     brought back. Deleting is only offered once nothing lists it — the API
 *     refuses otherwise, because the cascade would rewrite published room
 *     descriptions as a side effect.
 *   - **The OTA code is the portability hook.** It is the OpenTravel RMA code
 *     that channel managers and PMS platforms exchange. Leaving it blank is
 *     fine for something genuinely bespoke; guessing a code that means
 *     something else is not.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { adminApi, type AdminAmenity } from '@/lib/api/admin-client';
import type { AmenityCategory, Locale } from '@/lib/api/types';
import { formatNumber } from '@/lib/format';
import { AdminShell } from '../AdminShell';
import { useAdminSession } from '../AdminSession';
import { AddIcon, DeleteIcon } from '../icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorNote,
  Field,
  Input,
  Loading,
  Num,
  SavedNote,
  Select,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

const CATEGORIES: AmenityCategory[] = [
  'bathroom',
  'comfort',
  'technology',
  'services',
  'accessibility',
];

export function Amenities({ locale }: { locale: Locale }) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();
  const { admin } = useAdminSession();

  const canEdit = admin.role === 'ADMIN';

  const [amenities, setAmenities] = useState<AdminAmenity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  // The amenity the delete dialog is currently asking about, if any.
  const [pendingDelete, setPendingDelete] = useState<AdminAmenity | null>(null);

  const load = useCallback(async () => {
    try {
      setAmenities(await adminApi.listAmenities());
    } catch (caught) {
      setError(describeError(caught));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    code: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ): Promise<void> {
    setBusyCode(code);
    setError(null);

    try {
      await action();
      await load();
      setNotice(successMessage);
    } catch (caught) {
      setNotice(null);
      setError(describeError(caught));
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <AdminShell
      title={t('nav.amenities')}
      meta={
        amenities ? t('amenities.count', { count: amenities.length }) : undefined
      }
      actions={
        canEdit && !adding ? (
          <Button
            variant="primary"
            size="small"
            onClick={() => {
              setNotice(null);
              setAdding(true);
            }}
          >
            <AddIcon className={styles.icon} size="0.875rem" />
            {t('amenities.add')}
          </Button>
        ) : undefined
      }
    >
      <Alert tone="info">{t('amenities.intro')}</Alert>

      <ErrorNote message={error} />
      <SavedNote message={notice} />

      {adding ? (
        <AmenityForm
          onCancel={() => setAdding(false)}
          onSaved={async (name) => {
            setAdding(false);
            await load();
            setNotice(t('amenities.created', { name }));
          }}
          onError={setError}
        />
      ) : null}

      {!amenities && !error ? <Loading /> : null}

      {amenities
        ? CATEGORIES.map((category) => {
            const inCategory = amenities.filter(
              (amenity) => amenity.category === category,
            );
            if (inCategory.length === 0) return null;

            return (
              <Card key={category}>
                <CardHeader
                  title={t(`amenities.categories.${category}`)}
                  actions={
                    <Badge tone="neutral">
                      <Num>{formatNumber(inCategory.length, locale)}</Num>
                    </Badge>
                  }
                  tight
                />

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">{t('amenities.name')}</th>
                        <th scope="col">{t('amenities.code')}</th>
                        <th scope="col">{t('amenities.otaCode')}</th>
                        <th scope="col">{t('amenities.usedBy')}</th>
                        <th scope="col">{t('amenities.shown')}</th>
                        {canEdit ? (
                          <th scope="col">{t('reservations.actions')}</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {inCategory.map((amenity) => (
                        <tr key={amenity.code}>
                          <td>
                            <bdi>{amenity.name[locale]}</bdi>
                          </td>
                          <td className={styles.mono}>
                            <Num>{amenity.code}</Num>
                          </td>
                          <td className={styles.mono}>
                            {amenity.otaCode === null ? (
                              <span className={styles.muted}>—</span>
                            ) : (
                              // Printed raw, not through `formatNumber`: this is
                              // an identifier, and grouping it renders RMA 5017
                              // as "5,017", which is not the code.
                              <Num>{amenity.otaCode}</Num>
                            )}
                          </td>
                          <td className={styles.numeric}>
                            <Num>
                              {formatNumber(amenity.roomTypeCount, locale)}
                            </Num>
                          </td>
                          <td>
                            {/* "Shown", not "Yes" — it pairs with "Withdrawn",
                                and a badge has to carry its meaning away from
                                the column header that asked the question. */}
                            <Badge
                              tone={amenity.isActive ? 'success' : 'neutral'}
                              dot
                            >
                              {amenity.isActive
                                ? t('amenities.shownYes')
                                : t('amenities.withdrawn')}
                            </Badge>
                          </td>
                          {canEdit ? (
                            <td>
                              <div className={styles.rowActions}>
                                <Button
                                  size="small"
                                  disabled={busyCode === amenity.code}
                                  onClick={() =>
                                    void act(
                                      amenity.code,
                                      () =>
                                        adminApi.updateAmenity(amenity.code, {
                                          isActive: !amenity.isActive,
                                        }),
                                      t('amenities.saved', {
                                        name: amenity.name[locale],
                                      }),
                                    )
                                  }
                                >
                                  {amenity.isActive
                                    ? t('amenities.withdraw')
                                    : t('amenities.restore')}
                                </Button>

                                {/* Only offered when nothing lists it. The API
                                    refuses regardless; this avoids showing a
                                    button that can only fail. */}
                                {amenity.roomTypeCount === 0 ? (
                                  <Button
                                    variant="danger"
                                    size="small"
                                    disabled={busyCode === amenity.code}
                                    onClick={() => setPendingDelete(amenity)}
                                  >
                                    <DeleteIcon
                                      className={styles.icon}
                                      size="0.875rem"
                                    />
                                    {t('amenities.delete')}
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })
        : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('amenities.confirmDeleteTitle')}
        description={t('amenities.confirmDelete', {
          name: pendingDelete ? pendingDelete.name[locale] : '',
        })}
        confirmLabel={t('amenities.delete')}
        destructive
        busy={busyCode !== null}
        onDismiss={() => setPendingDelete(null)}
        onConfirm={() => {
          const amenity = pendingDelete;
          if (!amenity) return;
          setPendingDelete(null);
          void act(
            amenity.code,
            () => adminApi.deleteAmenity(amenity.code),
            t('amenities.deleted', { name: amenity.name[locale] }),
          );
        }}
      />
    </AdminShell>
  );
}

function AmenityForm({
  onCancel,
  onSaved,
  onError,
}: {
  onCancel: () => void;
  onSaved: (name: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [category, setCategory] = useState<AmenityCategory>('comfort');
  const [otaCode, setOtaCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    try {
      await adminApi.createAmenity({
        code: code.trim(),
        name: { en: nameEn.trim(), ar: nameAr.trim() },
        category,
        // Blank means "no standard code for this", which is a legitimate
        // answer — not the same as zero.
        ...(otaCode.trim() === '' ? {} : { otaCode: Number(otaCode) }),
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
        <CardHeader title={t('amenities.add')} tight />

        <CardBody className={styles.stack}>
          <div className={styles.formGrid}>
            <Field label={t('amenities.code')} hint={t('amenities.codeHint')}>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="air-conditioning"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title={t('amenities.codeHint')}
                dir="ltr"
                required
              />
            </Field>

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

            <Field label={t('amenities.category')}>
              <Select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as AmenityCategory)
                }
              >
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`amenities.categories.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('amenities.otaCode')} hint={t('amenities.otaHint')}>
              <Input
                type="number"
                min="1"
                value={otaCode}
                onChange={(event) => setOtaCode(event.target.value)}
                placeholder={t('amenities.otaOptional')}
                dir="ltr"
              />
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
