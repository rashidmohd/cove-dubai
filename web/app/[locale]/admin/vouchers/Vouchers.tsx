'use client';

/**
 * Discount codes.
 *
 * The engine behind this is in the API: validity, the atomic claim, and the
 * discount arithmetic all live there. This screen creates and edits codes and
 * reports how many uses are left — it never works out what a code is worth
 * (`pms-readiness`).
 *
 * Three behaviours worth knowing:
 *
 *   - **Deactivate, don't delete.** A code that has been redeemed cannot be
 *     deleted: the redemptions are the financial record of the campaign, and
 *     the cascade would take them with it. The API refuses, and Delete is only
 *     offered on a code nobody has used.
 *   - **A discount never touches the Tourism Dirham.** It comes off the
 *     accommodation charge, and VAT is then charged on what remains. The
 *     summary line on this screen says so, because it is the thing people
 *     assume works the other way.
 *   - **An edit never reprices a booking.** Each reservation carries the
 *     discount it was quoted, so changing a code affects future stays only.
 *     The bookings list under each code shows what it has already given away.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  adminApi,
  type AdminRoomType,
  type AdminVoucher,
  type DiscountType,
  type VoucherRedemption,
} from '@/lib/api/admin-client';
import type { Locale } from '@/lib/api/types';
import { formatMoney, formatNumber, formatStayDate } from '@/lib/format';
import { AdminShell } from '../AdminShell';
import { useAdminSession } from '../AdminSession';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Empty,
  ErrorNote,
  Field,
  Input,
  Loading,
  Num,
  SavedNote,
  Select,
  StatusPill,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

export function Vouchers({ locale }: { locale: Locale }) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();
  const { admin } = useAdminSession();

  const canEdit = admin.role === 'ADMIN';

  const [vouchers, setVouchers] = useState<AdminVoucher[] | null>(null);
  const [roomTypes, setRoomTypes] = useState<AdminRoomType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The form: `'new'` to add a code, or the code being edited. */
  const [editing, setEditing] = useState<AdminVoucher | 'new' | null>(null);
  /** Whose bookings are listed below the table, if anyone's. */
  const [reportCode, setReportCode] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVouchers(await adminApi.listVouchers());
    } catch (caught) {
      setError(describeError(caught));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    adminApi
      .listRoomTypes()
      .then(setRoomTypes)
      .catch(() => {
        // Only used to offer room-type restrictions. Failing to load them
        // should not stop the codes themselves being managed.
      });
  }, [load]);

  async function act(
    code: string,
    action: () => Promise<unknown>,
    message: string,
  ): Promise<void> {
    setBusyCode(code);
    setError(null);
    try {
      await action();
      await load();
      setNotice(message);
    } catch (caught) {
      setNotice(null);
      setError(describeError(caught));
    } finally {
      setBusyCode(null);
    }
  }

  const deleting = vouchers?.find((v) => v.code === pendingDelete) ?? null;

  return (
    <AdminShell
      title={t('nav.vouchers')}
      meta={vouchers ? t('vouchers.count', { count: vouchers.length }) : null}
      actions={
        canEdit && !editing ? (
          <Button
            variant="primary"
            onClick={() => {
              setNotice(null);
              setEditing('new');
            }}
          >
            {t('vouchers.add')}
          </Button>
        ) : undefined
      }
    >
      <ErrorNote message={error} />
      <SavedNote message={notice} />

      {editing ? (
        <VoucherForm
          key={editing === 'new' ? 'new' : editing.code}
          voucher={editing === 'new' ? null : editing}
          roomTypes={roomTypes}
          locale={locale}
          onCancel={() => setEditing(null)}
          onSaved={async (code) => {
            const created = editing === 'new';
            setEditing(null);
            await load();
            setNotice(
              created
                ? t('vouchers.created', { code })
                : t('vouchers.saved', { code }),
            );
          }}
          onError={setError}
        />
      ) : null}

      {!vouchers && !error ? <Loading /> : null}

      {vouchers && vouchers.length === 0 && !editing ? (
        <Empty message={t('vouchers.none')} />
      ) : null}

      {vouchers && vouchers.length > 0 ? (
        <Card>
          <CardHeader title={t('nav.vouchers')} description={t('vouchers.intro')} tight />
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('vouchers.code')}</th>
                  <th scope="col">{t('vouchers.discount')}</th>
                  <th scope="col">{t('vouchers.validity')}</th>
                  <th scope="col">{t('vouchers.used')}</th>
                  <th scope="col">{t('vouchers.appliesTo')}</th>
                  <th scope="col">{t('reservations.status')}</th>
                  <th scope="col">{t('reservations.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((voucher) => (
                  <tr key={voucher.code}>
                    <td className={styles.mono}>
                      <Num>{voucher.code}</Num>
                      <span className={styles.cellSub}>
                        <bdi>{voucher.name[locale]}</bdi>
                      </span>
                    </td>
                    <td className={styles.numeric}>
                      <Num>{formatDiscount(voucher, locale)}</Num>
                      {voucher.minimumNights > 1 ? (
                        <span className={styles.cellSub}>
                          {t('vouchers.minNights', {
                            count: voucher.minimumNights,
                          })}
                        </span>
                      ) : null}
                    </td>
                    <td className={styles.numeric}>
                      <Validity voucher={voucher} locale={locale} />
                    </td>
                    <td className={styles.numeric}>
                      <Num>
                        {voucher.maxRedemptions === null
                          ? t('vouchers.unlimitedUses', {
                              count: formatNumber(voucher.redemptionCount, locale),
                            })
                          : `${formatNumber(voucher.redemptionCount, locale)} / ${formatNumber(voucher.maxRedemptions, locale)}`}
                      </Num>
                    </td>
                    <td>
                      {voucher.roomTypeCodes.length === 0 ? (
                        <span className={styles.muted}>
                          {t('vouchers.allRooms')}
                        </span>
                      ) : (
                        <bdi>
                          {voucher.roomTypeCodes
                            .map(
                              (code) =>
                                roomTypes.find((r) => r.code === code)?.name[
                                  locale
                                ] ?? code,
                            )
                            .join(', ')}
                        </bdi>
                      )}
                    </td>
                    <td>
                      <VoucherState voucher={voucher} />
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {/* Open to staff: "did my booking get the discount"
                            is asked at the front desk. */}
                        <Button
                          size="small"
                          aria-expanded={reportCode === voucher.code}
                          onClick={() =>
                            setReportCode(
                              reportCode === voucher.code ? null : voucher.code,
                            )
                          }
                        >
                          {t('vouchers.bookings')}
                        </Button>
                        {canEdit ? (
                          <>
                            <Button
                              size="small"
                              disabled={busyCode === voucher.code}
                              onClick={() => {
                                setNotice(null);
                                setEditing(voucher);
                              }}
                            >
                              {t('vouchers.edit')}
                            </Button>
                            <Button
                              size="small"
                              disabled={busyCode === voucher.code}
                              onClick={() =>
                                void act(
                                  voucher.code,
                                  () =>
                                    adminApi.updateVoucher(voucher.code, {
                                      isActive: !voucher.isActive,
                                    }),
                                  t('vouchers.saved', { code: voucher.code }),
                                )
                              }
                            >
                              {voucher.isActive
                                ? t('vouchers.deactivate')
                                : t('vouchers.activate')}
                            </Button>

                            {/* Only ever offered on an unredeemed code — the API
                              refuses otherwise, and a button that can only
                              fail is worse than no button. */}
                            {voucher.redemptionCount === 0 ? (
                              <Button
                                size="small"
                                disabled={busyCode === voucher.code}
                                onClick={() => setPendingDelete(voucher.code)}
                              >
                                {t('vouchers.delete')}
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {reportCode ? (
        <RedemptionReport
          key={reportCode}
          code={reportCode}
          roomTypes={roomTypes}
          locale={locale}
          onClose={() => setReportCode(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t('vouchers.confirmDeleteTitle')}
        description={t('vouchers.confirmDelete', { code: deleting?.code ?? '' })}
        confirmLabel={t('vouchers.delete')}
        destructive
        busy={busyCode === deleting?.code}
        onConfirm={() => {
          const code = deleting?.code;
          setPendingDelete(null);
          if (code) {
            void act(
              code,
              () => adminApi.deleteVoucher(code),
              t('vouchers.deleted', { code }),
            );
          }
        }}
        onDismiss={() => setPendingDelete(null)}
      />
    </AdminShell>
  );
}

/** `15%` or `AED 300`, in the reader's locale. */
function formatDiscount(voucher: AdminVoucher, locale: Locale): string {
  return voucher.discountType === 'percentage'
    ? `${formatNumber(voucher.discountValue, locale)}%`
    : formatMoney(voucher.discountValue, 'AED', locale);
}

function Validity({
  voucher,
  locale,
}: {
  voucher: AdminVoucher;
  locale: Locale;
}) {
  const t = useTranslations('admin');

  if (!voucher.validFrom && !voucher.validTo) {
    return <span className={styles.muted}>{t('vouchers.always')}</span>;
  }

  return (
    <Num>
      {voucher.validFrom ? formatStayDate(voucher.validFrom, locale) : '—'}
      {' – '}
      {voucher.validTo ? formatStayDate(voucher.validTo, locale) : '—'}
    </Num>
  );
}

/**
 * Why a code is or is not usable right now.
 *
 * Deliberately more than `isActive`: a live code that has expired or run out
 * is not usable either, and someone looking at this table wants to know that
 * without working it out from two other columns.
 */
function VoucherState({ voucher }: { voucher: AdminVoucher }) {
  const t = useTranslations('admin');
  const today = new Date().toISOString().slice(0, 10);

  if (!voucher.isActive) {
    return <Badge tone="neutral">{t('vouchers.inactive')}</Badge>;
  }
  if (voucher.validTo && voucher.validTo < today) {
    return <Badge tone="warning">{t('vouchers.expired')}</Badge>;
  }
  if (voucher.validFrom && voucher.validFrom > today) {
    return <Badge tone="neutral">{t('vouchers.scheduled')}</Badge>;
  }
  if (
    voucher.maxRedemptions !== null &&
    voucher.redemptionCount >= voucher.maxRedemptions
  ) {
    return <Badge tone="warning">{t('vouchers.exhausted')}</Badge>;
  }
  return (
    <Badge tone="success" dot>
      {t('vouchers.live')}
    </Badge>
  );
}

function VoucherForm({
  voucher,
  roomTypes,
  locale,
  onCancel,
  onSaved,
  onError,
}: {
  /** Null when adding a new code. */
  voucher: AdminVoucher | null;
  roomTypes: AdminRoomType[];
  locale: Locale;
  onCancel: () => void;
  onSaved: (code: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [code, setCode] = useState(voucher?.code ?? '');
  const [nameEn, setNameEn] = useState(voucher?.name.en ?? '');
  const [nameAr, setNameAr] = useState(voucher?.name.ar ?? '');
  const [discountType, setDiscountType] = useState<DiscountType>(
    voucher?.discountType ?? 'percentage',
  );
  const [discountValue, setDiscountValue] = useState(
    String(voucher?.discountValue ?? 10),
  );
  const [validFrom, setValidFrom] = useState(voucher?.validFrom ?? '');
  const [validTo, setValidTo] = useState(voucher?.validTo ?? '');
  const [maxRedemptions, setMaxRedemptions] = useState(
    voucher?.maxRedemptions == null ? '' : String(voucher.maxRedemptions),
  );
  const [minimumNights, setMinimumNights] = useState(
    String(voucher?.minimumNights ?? 1),
  );
  const [minimumSpend, setMinimumSpend] = useState(
    voucher?.minimumSpend == null ? '' : String(voucher.minimumSpend),
  );
  const [restricted, setRestricted] = useState<Set<string>>(
    () => new Set(voucher?.roomTypeCodes ?? []),
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const fields = {
      name: { en: nameEn.trim(), ar: nameAr.trim() },
      discountType,
      discountValue: Number(discountValue),
      // Blank means no limit, which is not the same as zero.
      validFrom: validFrom || null,
      validTo: validTo || null,
      maxRedemptions:
        maxRedemptions.trim() === '' ? null : Number(maxRedemptions),
      minimumNights: Number(minimumNights),
      minimumSpend: minimumSpend.trim() === '' ? null : Number(minimumSpend),
      roomTypeCodes: [...restricted],
    };

    try {
      if (voucher) {
        await adminApi.updateVoucher(voucher.code, fields);
        await onSaved(voucher.code);
      } else {
        await adminApi.createVoucher({
          code: code.trim().toUpperCase(),
          ...fields,
        });
        await onSaved(code.trim().toUpperCase());
      }
    } catch (caught) {
      onError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={voucher ? t('vouchers.editTitle', { code: voucher.code }) : t('vouchers.add')}
        description={voucher ? t('vouchers.editHint') : t('vouchers.formHint')}
      />
      <CardBody>
        <form onSubmit={submit} className={styles.stack}>
          <div className={styles.formGrid}>
            <Field label={t('vouchers.code')} hint={t('vouchers.codeHint')}>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="SPRING25"
                pattern="[A-Za-z0-9][A-Za-z0-9-]*"
                minLength={3}
                maxLength={40}
                dir="ltr"
                // The code is what guests were given, so it cannot change.
                disabled={voucher !== null}
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

            <Field label={t('vouchers.discountType')}>
              <Select
                value={discountType}
                onChange={(event) =>
                  setDiscountType(event.target.value as DiscountType)
                }
              >
                <option value="percentage">{t('vouchers.percentage')}</option>
                <option value="fixed">{t('vouchers.fixed')}</option>
              </Select>
            </Field>

            <Field
              label={
                discountType === 'percentage'
                  ? t('vouchers.percentOff')
                  : t('vouchers.amountOff')
              }
            >
              <Input
                type="number"
                min="0"
                max={discountType === 'percentage' ? 100 : undefined}
                step="0.01"
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
                dir="ltr"
                required
              />
            </Field>

            <Field
              label={t('vouchers.maxRedemptions')}
              hint={
                voucher && voucher.redemptionCount > 0
                  ? t('vouchers.capHint', { count: voucher.redemptionCount })
                  : t('vouchers.unlimitedHint')
              }
            >
              <Input
                type="number"
                min={Math.max(1, voucher?.redemptionCount ?? 1)}
                value={maxRedemptions}
                onChange={(event) => setMaxRedemptions(event.target.value)}
                placeholder={t('vouchers.unlimited')}
                dir="ltr"
              />
            </Field>

            <Field label={t('vouchers.validFrom')}>
              <Input
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
              />
            </Field>

            <Field label={t('vouchers.validTo')}>
              <Input
                type="date"
                value={validTo}
                onChange={(event) => setValidTo(event.target.value)}
              />
            </Field>

            <Field label={t('vouchers.minNightsLabel')}>
              <Input
                type="number"
                min="1"
                max="365"
                value={minimumNights}
                onChange={(event) => setMinimumNights(event.target.value)}
                dir="ltr"
                required
              />
            </Field>

            <Field
              label={t('vouchers.minimumSpend')}
              hint={t('vouchers.minimumSpendHint')}
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                value={minimumSpend}
                onChange={(event) => setMinimumSpend(event.target.value)}
                placeholder={t('vouchers.noMinimum')}
                dir="ltr"
              />
            </Field>
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('vouchers.appliesTo')}</legend>
            <p className={styles.hint}>{t('vouchers.allRoomsHint')}</p>
            <div className={styles.checkOptions}>
              {roomTypes.map((roomType) => (
                <label key={roomType.code} className={styles.checkOption}>
                  <input
                    className={styles.checkbox}
                    type="checkbox"
                    checked={restricted.has(roomType.code)}
                    onChange={(event) => {
                      const next = new Set(restricted);
                      if (event.target.checked) next.add(roomType.code);
                      else next.delete(roomType.code);
                      setRestricted(next);
                    }}
                  />
                  <bdi>{roomType.name[locale]}</bdi>
                </label>
              ))}
            </div>
          </fieldset>

          <p className={styles.hint}>{t('vouchers.taxNote')}</p>

          <div className={styles.formActions}>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? t('saving') : t('save')}
            </Button>
            <Button onClick={onCancel} disabled={busy}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/**
 * The bookings that used one code, and what they saved between them.
 *
 * Cancelled bookings are listed too, with their status: cancelling does not
 * give a use back, so they still count against the code's limit, and the list
 * should add up to the "used" figure in the table above.
 */
function RedemptionReport({
  code,
  roomTypes,
  locale,
  onClose,
}: {
  code: string;
  roomTypes: AdminRoomType[];
  locale: Locale;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [report, setReport] = useState<{
    redemptions: VoucherRedemption[];
    totalDiscount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminApi
      .listVoucherRedemptions(code)
      .then((next) => {
        if (live) setReport(next);
      })
      .catch((caught: unknown) => {
        if (live) setError(describeError(caught));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <Card>
      <CardHeader
        title={t('vouchers.bookingsTitle', { code })}
        description={
          report
            ? t('vouchers.bookingsSummary', {
                count: report.redemptions.length,
                total: formatMoney(report.totalDiscount, 'AED', locale),
              })
            : undefined
        }
        actions={
          <Button size="small" onClick={onClose}>
            {t('vouchers.close')}
          </Button>
        }
        tight
      />

      <ErrorNote message={error} />
      {!report && !error ? <Loading /> : null}

      {report && report.redemptions.length === 0 ? (
        <CardBody>
          <p className={styles.hint}>{t('vouchers.noBookings')}</p>
        </CardBody>
      ) : null}

      {report && report.redemptions.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('vouchers.reference')}</th>
                <th scope="col">{t('vouchers.guest')}</th>
                <th scope="col">{t('vouchers.stay')}</th>
                <th scope="col">{t('reservations.status')}</th>
                <th scope="col">{t('vouchers.saving')}</th>
              </tr>
            </thead>
            <tbody>
              {report.redemptions.map((redemption) => (
                <tr key={redemption.reference}>
                  <td className={styles.mono}>
                    <Num>{redemption.reference}</Num>
                  </td>
                  <td>
                    <bdi>{redemption.guestName}</bdi>
                    <span className={styles.cellSub}>
                      <bdi>
                        {roomTypes.find(
                          (r) => r.code === redemption.roomTypeCode,
                        )?.name[locale] ?? redemption.roomTypeCode}
                      </bdi>
                    </span>
                  </td>
                  <td className={styles.numeric}>
                    <Num>
                      {formatStayDate(redemption.checkIn, locale)}
                      {' – '}
                      {formatStayDate(redemption.checkOut, locale)}
                    </Num>
                  </td>
                  <td>
                    <StatusPill status={redemption.status} />
                  </td>
                  <td className={styles.numeric}>
                    <Num>{formatMoney(redemption.discount, 'AED', locale)}</Num>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
