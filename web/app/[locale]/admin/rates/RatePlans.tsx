'use client';

/**
 * Rates and offers — every rate plan, grouped by room type.
 *
 * A rate plan prices nights inside its date window and on its weekdays. Where
 * several cover the same night the highest priority wins, and a night no plan
 * covers is charged at the room type's base rate. An **offer** is not a
 * separate thing: it is a plan flagged to appear on the public offers page,
 * which is why it is edited here rather than on a screen of its own.
 *
 * The API does every bit of the pricing. This screen only edits the rows and
 * explains, in words, what each one will do (`pms-readiness`).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  adminApi,
  type AdminRatePlan,
  type AdminRoomType,
} from '@/lib/api/admin-client';
import type { Locale } from '@/lib/api/types';
import { formatMoney, formatNumber, formatStayDate, weekdayNames } from '@/lib/format';
import { AdminShell } from '../AdminShell';
import { useAdminSession } from '../AdminSession';
import {
  Alert,
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
  Textarea,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** What is open in the form, if anything. */
type Editing =
  | { mode: 'create' }
  | { mode: 'edit'; plan: AdminRatePlan };

export function RatePlans({ locale }: { locale: Locale }) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();
  const { admin } = useAdminSession();

  // Plans set prices, so the API restricts writes to ADMIN. Hiding the
  // controls matches that rather than letting staff discover it from a 403.
  const canEdit = admin.role === 'ADMIN';

  const [plans, setPlans] = useState<AdminRatePlan[] | null>(null);
  const [roomTypes, setRoomTypes] = useState<AdminRoomType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminRatePlan | null>(null);

  /** Plans and room types together: the table is grouped by one and lists the other. */
  const fetchAll = () =>
    Promise.all([adminApi.listRatePlans(), adminApi.listRoomTypes()]);

  async function load(): Promise<void> {
    try {
      const [nextPlans, nextRoomTypes] = await fetchAll();
      setPlans(nextPlans);
      setRoomTypes(nextRoomTypes);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  useEffect(() => {
    // Guarded so a response arriving after the screen is left is dropped
    // rather than set on an unmounted component.
    let live = true;
    fetchAll()
      .then(([nextPlans, nextRoomTypes]) => {
        if (!live) return;
        setPlans(nextPlans);
        setRoomTypes(nextRoomTypes);
      })
      .catch((caught: unknown) => {
        if (live) setError(describeError(caught));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(
    plan: AdminRatePlan,
    action: () => Promise<unknown>,
    message: string,
  ): Promise<void> {
    setBusyKey(keyOf(plan));
    setError(null);
    try {
      await action();
      await load();
      setNotice(message);
    } catch (caught) {
      setNotice(null);
      setError(describeError(caught));
    } finally {
      setBusyKey(null);
    }
  }

  const roomName = (code: string) =>
    roomTypes.find((roomType) => roomType.code === code)?.name[locale] ?? code;

  return (
    <AdminShell
      title={t('nav.rates')}
      meta={plans ? t('rates.count', { count: plans.length }) : null}
      actions={
        canEdit && !editing && roomTypes.length > 0 ? (
          <Button
            variant="primary"
            onClick={() => {
              setNotice(null);
              setEditing({ mode: 'create' });
            }}
          >
            {t('rates.add')}
          </Button>
        ) : undefined
      }
    >
      <ErrorNote message={error} />
      <SavedNote message={notice} />

      <Alert tone="info">{t('rates.howItWorks')}</Alert>

      {editing ? (
        <RatePlanForm
          // Remount per plan, so switching from one edit to another starts
          // from that plan's values rather than the last one's.
          key={editing.mode === 'edit' ? keyOf(editing.plan) : 'new'}
          plan={editing.mode === 'edit' ? editing.plan : null}
          roomTypes={roomTypes}
          locale={locale}
          onCancel={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            await load();
            setNotice(t('rates.saved', { name }));
          }}
          onError={setError}
        />
      ) : null}

      {!plans && !error ? <Loading /> : null}

      {plans
        ? roomTypes.map((roomType) => {
            const own = plans.filter((plan) => plan.roomTypeCode === roomType.code);

            return (
              <Card key={roomType.code}>
                <CardHeader
                  title={<bdi>{roomType.name[locale]}</bdi>}
                  description={t('rates.baseRate', {
                    rate: formatMoney(roomType.baseRate, 'AED', locale),
                  })}
                  actions={
                    !roomType.isActive ? (
                      <Badge tone="neutral">{t('rooms.onSaleNo')}</Badge>
                    ) : undefined
                  }
                  tight
                />

                {own.length === 0 ? (
                  <CardBody>
                    <p className={styles.hint}>{t('rates.noneOnRoom')}</p>
                  </CardBody>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">{t('rates.plan')}</th>
                          <th scope="col">{t('rates.nightlyRate')}</th>
                          <th scope="col">{t('rates.dates')}</th>
                          <th scope="col">{t('rates.nights')}</th>
                          <th scope="col">{t('rates.priority')}</th>
                          <th scope="col">{t('reservations.status')}</th>
                          {canEdit ? (
                            <th scope="col">{t('reservations.actions')}</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {own.map((plan) => (
                          <tr key={plan.code}>
                            <td>
                              <bdi>{plan.name[locale]}</bdi>
                              <span className={`${styles.cellSub} ${styles.mono}`}>
                                <Num>{plan.code}</Num>
                              </span>
                            </td>
                            <td className={styles.numeric}>
                              <Num>{formatMoney(plan.nightlyRate, 'AED', locale)}</Num>
                              {plan.minimumStayNights > 1 ? (
                                <span className={styles.cellSub}>
                                  {t('vouchers.minNights', {
                                    count: plan.minimumStayNights,
                                  })}
                                </span>
                              ) : null}
                            </td>
                            <td className={styles.numeric}>
                              {plan.validFrom && plan.validTo ? (
                                <Num>
                                  {formatStayDate(plan.validFrom, locale)}
                                  {' – '}
                                  {formatStayDate(plan.validTo, locale)}
                                </Num>
                              ) : (
                                <span className={styles.muted}>
                                  {t('rates.allDates')}
                                </span>
                              )}
                            </td>
                            <td>
                              {plan.daysOfWeek.length === 7 ? (
                                <span className={styles.muted}>
                                  {t('rates.everyNight')}
                                </span>
                              ) : (
                                weekdayList(plan.daysOfWeek, locale)
                              )}
                            </td>
                            <td className={styles.numeric}>
                              <Num>{formatNumber(plan.priority, locale)}</Num>
                            </td>
                            <td>
                              <div className={styles.row}>
                                <PlanState plan={plan} />
                                {plan.isPublicOffer ? (
                                  <Badge tone="accent">{t('rates.offer')}</Badge>
                                ) : null}
                              </div>
                            </td>
                            {canEdit ? (
                              <td>
                                <div className={styles.rowActions}>
                                  <Button
                                    size="small"
                                    disabled={busyKey === keyOf(plan)}
                                    onClick={() => {
                                      setNotice(null);
                                      setEditing({ mode: 'edit', plan });
                                    }}
                                  >
                                    {t('rates.edit')}
                                  </Button>
                                  <Button
                                    size="small"
                                    disabled={busyKey === keyOf(plan)}
                                    onClick={() =>
                                      void act(
                                        plan,
                                        () =>
                                          adminApi.updateRatePlan(
                                            plan.roomTypeCode,
                                            plan.code,
                                            { isActive: !plan.isActive },
                                          ),
                                        t('rates.saved', { name: plan.name[locale] }),
                                      )
                                    }
                                  >
                                    {plan.isActive
                                      ? t('vouchers.deactivate')
                                      : t('vouchers.activate')}
                                  </Button>
                                  <Button
                                    size="small"
                                    disabled={busyKey === keyOf(plan)}
                                    onClick={() => setPendingDelete(plan)}
                                  >
                                    {t('vouchers.delete')}
                                  </Button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })
        : null}

      {plans && roomTypes.length === 0 ? <Empty message={t('rates.noRooms')} /> : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('rates.confirmDeleteTitle')}
        description={t('rates.confirmDelete', {
          name: pendingDelete?.name[locale] ?? '',
          room: pendingDelete ? roomName(pendingDelete.roomTypeCode) : '',
        })}
        confirmLabel={t('vouchers.delete')}
        destructive
        busy={pendingDelete !== null && busyKey === keyOf(pendingDelete)}
        onConfirm={() => {
          const plan = pendingDelete;
          setPendingDelete(null);
          if (plan) {
            void act(
              plan,
              () => adminApi.deleteRatePlan(plan.roomTypeCode, plan.code),
              t('rates.deleted', { name: plan.name[locale] }),
            );
          }
        }}
        onDismiss={() => setPendingDelete(null)}
      />
    </AdminShell>
  );
}

/** Plans are unique by room type plus code, not by code alone. */
function keyOf(plan: AdminRatePlan): string {
  return `${plan.roomTypeCode}/${plan.code}`;
}

/** "Fri and Sat", with the locale's own weekday names and conjunction. */
function weekdayList(days: number[], locale: Locale): string {
  const names = weekdayNames(locale);
  return new Intl.ListFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    style: 'long',
    type: 'conjunction',
  }).format(days.map((day) => names[day] ?? String(day)));
}

/**
 * Whether a plan is pricing anything right now.
 *
 * More than `isActive`, for the same reason as on the voucher screen: an
 * active plan whose window has passed prices nothing, and the person reading
 * the table should not have to work that out from the dates column.
 */
function PlanState({ plan }: { plan: AdminRatePlan }) {
  const t = useTranslations('admin');
  const today = new Date().toISOString().slice(0, 10);

  if (!plan.isActive) {
    return <Badge tone="neutral">{t('vouchers.inactive')}</Badge>;
  }
  if (plan.validTo && plan.validTo < today) {
    return <Badge tone="warning">{t('vouchers.expired')}</Badge>;
  }
  if (plan.validFrom && plan.validFrom > today) {
    return <Badge tone="neutral">{t('vouchers.scheduled')}</Badge>;
  }
  return (
    <Badge tone="success" dot>
      {t('vouchers.live')}
    </Badge>
  );
}

/** A slug suggestion from the English name — editable, and only on create. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function RatePlanForm({
  plan,
  roomTypes,
  locale,
  onCancel,
  onSaved,
  onError,
}: {
  /** Null when adding a new plan. */
  plan: AdminRatePlan | null;
  roomTypes: AdminRoomType[];
  locale: Locale;
  onCancel: () => void;
  onSaved: (name: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();
  const days = weekdayNames(locale);

  const [roomTypeCode, setRoomTypeCode] = useState(
    plan?.roomTypeCode ?? roomTypes[0]?.code ?? '',
  );
  const [code, setCode] = useState(plan?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(plan !== null);
  const [nameEn, setNameEn] = useState(plan?.name.en ?? '');
  const [nameAr, setNameAr] = useState(plan?.name.ar ?? '');
  const [nightlyRate, setNightlyRate] = useState(
    plan ? String(plan.nightlyRate) : '',
  );
  const [validFrom, setValidFrom] = useState(plan?.validFrom ?? '');
  const [validTo, setValidTo] = useState(plan?.validTo ?? '');
  const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(
    () => new Set(plan?.daysOfWeek ?? ALL_DAYS),
  );
  const [minimumStay, setMinimumStay] = useState(
    String(plan?.minimumStayNights ?? 1),
  );
  // New plans default above zero, so a seasonal rate outranks a plain one
  // without the editor having to know priorities exist.
  const [priority, setPriority] = useState(String(plan?.priority ?? 10));
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [isPublicOffer, setIsPublicOffer] = useState(plan?.isPublicOffer ?? false);
  const [descriptionEn, setDescriptionEn] = useState(plan?.description?.en ?? '');
  const [descriptionAr, setDescriptionAr] = useState(plan?.description?.ar ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const alwaysOn = !validFrom && !validTo && daysOfWeek.size === 7;
  const roomType = roomTypes.find((room) => room.code === roomTypeCode);

  function toggleDay(day: number, on: boolean) {
    const next = new Set(daysOfWeek);
    if (on) next.add(day);
    else next.delete(day);
    setDaysOfWeek(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    // The API refuses both of these too. Saying so here, before the request,
    // keeps the editor's work on screen and the message in their language.
    if (!validFrom !== !validTo) {
      setProblem(t('rates.bothDates'));
      return;
    }
    if (daysOfWeek.size === 0) {
      setProblem(t('rates.pickADay'));
      return;
    }
    const hasDescription = descriptionEn.trim() !== '' || descriptionAr.trim() !== '';
    if (hasDescription && (descriptionEn.trim() === '' || descriptionAr.trim() === '')) {
      setProblem(t('rates.bothDescriptions'));
      return;
    }
    setProblem(null);
    setBusy(true);

    const fields = {
      name: { en: nameEn.trim(), ar: nameAr.trim() },
      description: hasDescription
        ? { en: descriptionEn.trim(), ar: descriptionAr.trim() }
        : null,
      nightlyRate: Number(nightlyRate),
      validFrom: validFrom || null,
      validTo: validTo || null,
      daysOfWeek: [...daysOfWeek].sort((a, b) => a - b),
      minimumStayNights: Number(minimumStay),
      priority: Number(priority),
      isActive,
      isPublicOffer,
    };

    try {
      if (plan) {
        await adminApi.updateRatePlan(plan.roomTypeCode, plan.code, fields);
      } else {
        await adminApi.createRatePlan(roomTypeCode, { code: code.trim(), ...fields });
      }
      await onSaved(fields.name[locale]);
    } catch (caught) {
      onError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={plan ? t('rates.editTitle') : t('rates.add')}
        description={t('rates.formHint')}
      />
      <CardBody>
        <form onSubmit={submit} className={styles.stack}>
          <div className={styles.formGrid}>
            <Field label={t('rates.roomType')}>
              <Select
                value={roomTypeCode}
                onChange={(event) => setRoomTypeCode(event.target.value)}
                // A plan's room type is part of its identity, so it is fixed
                // once created. Move it by adding a plan on the other room.
                disabled={plan !== null}
              >
                {roomTypes.map((room) => (
                  <option key={room.code} value={room.code}>
                    {room.name[locale]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('rooms.nameEn')}>
              <Input
                value={nameEn}
                onChange={(event) => {
                  setNameEn(event.target.value);
                  if (!codeTouched) setCode(slugify(event.target.value));
                }}
                lang="en"
                dir="ltr"
                maxLength={120}
                required
              />
            </Field>

            <Field label={t('rooms.nameAr')}>
              <Input
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                lang="ar"
                dir="rtl"
                maxLength={120}
                required
              />
            </Field>

            <Field label={t('rates.code')} hint={t('rates.codeHint')}>
              <Input
                value={code}
                onChange={(event) => {
                  setCodeTouched(true);
                  setCode(event.target.value.toLowerCase());
                }}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={2}
                maxLength={60}
                dir="ltr"
                disabled={plan !== null}
                required
              />
            </Field>

            <Field
              label={t('rates.nightlyRate')}
              hint={
                roomType
                  ? t('rates.baseRate', {
                      rate: formatMoney(roomType.baseRate, 'AED', locale),
                    })
                  : undefined
              }
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                value={nightlyRate}
                onChange={(event) => setNightlyRate(event.target.value)}
                dir="ltr"
                required
              />
            </Field>

            <Field label={t('rates.validFrom')} hint={t('rates.datesHint')}>
              <Input
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
                max={validTo || undefined}
              />
            </Field>

            <Field label={t('rates.validTo')}>
              <Input
                type="date"
                value={validTo}
                onChange={(event) => setValidTo(event.target.value)}
                min={validFrom || undefined}
              />
            </Field>

            <Field label={t('vouchers.minNightsLabel')}>
              <Input
                type="number"
                min="1"
                max="365"
                value={minimumStay}
                onChange={(event) => setMinimumStay(event.target.value)}
                dir="ltr"
                required
              />
            </Field>

            <Field label={t('rates.priority')} hint={t('rates.priorityHint')}>
              <Input
                type="number"
                min="-1000"
                max="1000"
                step="1"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                dir="ltr"
                required
              />
            </Field>
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('rates.nights')}</legend>
            <div className={styles.checkOptions}>
              {ALL_DAYS.map((day) => (
                <label key={day} className={styles.checkOption}>
                  <input
                    className={styles.checkbox}
                    type="checkbox"
                    checked={daysOfWeek.has(day)}
                    onChange={(event) => toggleDay(day, event.target.checked)}
                  />
                  {days[day]}
                </label>
              ))}
            </div>
            <p className={styles.hint}>{t('rates.nightsHint')}</p>
          </fieldset>

          {alwaysOn ? <Alert tone="info">{t('rates.alwaysOnWarning')}</Alert> : null}

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('rates.visibility')}</legend>
            <div className={styles.checkOptions}>
              <label className={styles.checkOption}>
                <input
                  className={styles.checkbox}
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                {t('rates.activeLabel')}
              </label>
              <label className={styles.checkOption}>
                <input
                  className={styles.checkbox}
                  type="checkbox"
                  checked={isPublicOffer}
                  onChange={(event) => setIsPublicOffer(event.target.checked)}
                />
                {t('rates.offerLabel')}
              </label>
            </div>
            <p className={styles.hint}>{t('rates.offerHint')}</p>
          </fieldset>

          {isPublicOffer || descriptionEn || descriptionAr ? (
            <div className={styles.formGrid}>
              <Field label={t('rates.descriptionEn')}>
                <Textarea
                  value={descriptionEn}
                  onChange={(event) => setDescriptionEn(event.target.value)}
                  lang="en"
                  dir="ltr"
                  rows={3}
                  maxLength={2000}
                />
              </Field>
              <Field label={t('rates.descriptionAr')}>
                <Textarea
                  value={descriptionAr}
                  onChange={(event) => setDescriptionAr(event.target.value)}
                  lang="ar"
                  dir="rtl"
                  rows={3}
                  maxLength={2000}
                />
              </Field>
            </div>
          ) : null}

          {problem ? <Alert tone="error">{problem}</Alert> : null}

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
