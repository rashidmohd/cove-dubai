'use client';

/**
 * Spa and dining requests — one screen per kind, the same screen for both.
 *
 * Guests send requests, not bookings: nothing is held until someone here
 * answers. So the screen is built around the answer — the unanswered requests
 * first, a panel to confirm (at the time asked for, or another), decline or
 * cancel, and a note that goes to the guest in the email the API sends.
 *
 * Below it, the menu guests choose from. Answering is open to staff; changing
 * the menu — names, prices, hours — is for admins, as the API enforces.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  adminApi,
  type AdminServiceOffering,
} from '@/lib/api/admin-client';
import type {
  Locale,
  ServiceKind,
  ServiceRequest,
  ServiceRequestStatus,
} from '@/lib/api/types';
import { formatMoney, formatNumber, formatStayDate, formatTimeOfDay } from '@/lib/format';
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
  Textarea,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

const FILTERS: Array<ServiceRequestStatus | 'all'> = [
  'new',
  'confirmed',
  'declined',
  'cancelled',
  'all',
];

const STATUS_TONES: Record<ServiceRequestStatus, 'warning' | 'success' | 'neutral' | 'danger'> = {
  new: 'warning',
  confirmed: 'success',
  declined: 'neutral',
  cancelled: 'danger',
};

export function ServiceDesk({ kind, locale }: { kind: ServiceKind; locale: Locale }) {
  const t = useTranslations('admin.services');
  const tNav = useTranslations('admin.nav');
  const describeError = useApiErrorMessage();
  const { admin } = useAdminSession();
  const canEditMenu = admin.role === 'ADMIN';

  const [filter, setFilter] = useState<ServiceRequestStatus | 'all'>('new');
  const [requests, setRequests] = useState<ServiceRequest[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offerings, setOfferings] = useState<AdminServiceOffering[] | null>(null);
  const [answering, setAnswering] = useState<ServiceRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchRequests = () =>
    adminApi.listServiceRequests(kind, {
      ...(filter === 'all' ? {} : { status: filter }),
      limit: 200,
    });

  async function reload(): Promise<void> {
    try {
      const [list, menu] = await Promise.all([
        fetchRequests(),
        adminApi.listServiceOfferings(kind),
      ]);
      setRequests(list.requests);
      setTotal(list.total);
      setOfferings(menu);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  useEffect(() => {
    let live = true;
    Promise.all([fetchRequests(), adminApi.listServiceOfferings(kind)])
      .then(([list, menu]) => {
        if (!live) return;
        setRequests(list.requests);
        setTotal(list.total);
        setOfferings(menu);
      })
      .catch((caught: unknown) => {
        if (live) setError(describeError(caught));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, filter]);

  return (
    <AdminShell
      title={tNav(kind)}
      meta={requests ? t('count', { count: total }) : null}
    >
      <ErrorNote message={error} />
      <SavedNote message={notice} />

      <div className={styles.row} role="group" aria-label={t('filterLabel')}>
        {FILTERS.map((value) => (
          <Button
            key={value}
            size="small"
            variant={filter === value ? 'primary' : undefined}
            aria-pressed={filter === value}
            onClick={() => {
              // The current filter again changes nothing — clearing the list
              // here would wait for a reload that never comes.
              if (value === filter) return;
              setRequests(null);
              setAnswering(null);
              setFilter(value);
            }}
          >
            {t(`filters.${value}`)}
          </Button>
        ))}
      </div>

      {answering ? (
        <AnswerPanel
          key={answering.reference}
          kind={kind}
          request={answering}
          locale={locale}
          onCancel={() => setAnswering(null)}
          onAnswered={async (message) => {
            setAnswering(null);
            setNotice(message);
            await reload();
          }}
          onError={setError}
        />
      ) : null}

      {!requests && !error ? <Loading /> : null}

      {requests && requests.length === 0 ? (
        <Empty message={t(`empty.${filter}`)} />
      ) : null}

      {requests && requests.length > 0 ? (
        <Card>
          <CardHeader title={t('requestsTitle')} description={t(`intro.${kind}`)} tight />
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('reference')}</th>
                  <th scope="col">{t('guest')}</th>
                  <th scope="col">{t(`item.${kind}`)}</th>
                  <th scope="col">{t('when')}</th>
                  <th scope="col">{t('status')}</th>
                  <th scope="col">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.reference}>
                    <td className={styles.mono}>
                      <Num>{request.reference}</Num>
                    </td>
                    <td>
                      <bdi>
                        {request.guest.firstName} {request.guest.lastName}
                      </bdi>
                      <span className={styles.cellSub}>
                        <bdi>{request.guest.email}</bdi> · <bdi>{request.guest.phone}</bdi>
                      </span>
                    </td>
                    <td>
                      <bdi>{request.offering.name[locale]}</bdi>
                      <span className={styles.cellSub}>
                        {t('guests', { count: request.guests })}
                      </span>
                    </td>
                    <td className={styles.numeric}>
                      <Num>{formatStayDate(request.preferredDate, locale)}</Num>
                      <span className={styles.cellSub}>
                        {request.confirmedTime && request.confirmedTime !== request.preferredTime
                          ? t('timeMoved', {
                              asked: formatTimeOfDay(request.preferredTime, locale),
                              confirmed: formatTimeOfDay(request.confirmedTime, locale),
                            })
                          : formatTimeOfDay(request.confirmedTime ?? request.preferredTime, locale)}
                      </span>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONES[request.status]} dot>
                        {t(`statuses.${request.status}`)}
                      </Badge>
                    </td>
                    <td>
                      {request.status === 'new' || request.status === 'confirmed' ? (
                        <Button
                          size="small"
                          variant={request.status === 'new' ? 'primary' : undefined}
                          onClick={() => {
                            setNotice(null);
                            setAnswering(request);
                          }}
                        >
                          {request.status === 'new' ? t('answer') : t('change')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {offerings ? (
        <MenuEditor
          kind={kind}
          offerings={offerings}
          locale={locale}
          canEdit={canEditMenu}
          onChanged={async (message) => {
            setNotice(message);
            await reload();
          }}
          onError={setError}
        />
      ) : null}
    </AdminShell>
  );
}

/**
 * The answer to one request. A new request is confirmed or declined; a
 * confirmed one can be moved to another time or called off. Whatever is
 * chosen, the guest is emailed — the panel says so, so nobody is surprised.
 */
function AnswerPanel({
  kind,
  request,
  locale,
  onCancel,
  onAnswered,
  onError,
}: {
  kind: ServiceKind;
  request: ServiceRequest;
  locale: Locale;
  onCancel: () => void;
  onAnswered: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin.services');
  const describeError = useApiErrorMessage();

  const [time, setTime] = useState(request.confirmedTime ?? request.preferredTime);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(status: 'confirmed' | 'declined' | 'cancelled') {
    setBusy(true);
    try {
      await adminApi.respondToServiceRequest(kind, request.reference, {
        status,
        ...(status === 'confirmed' ? { confirmedTime: time } : {}),
        ...(note.trim() ? { responseNote: note.trim() } : {}),
      });
      await onAnswered(t(`answered.${status}`, { reference: request.reference }));
    } catch (caught) {
      onError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('answerTitle', { reference: request.reference })}
        description={t('answerHint')}
      />
      <CardBody>
        <div className={styles.stack}>
          <dl className={styles.defGrid}>
            <Fact label={t('guest')} value={`${request.guest.firstName} ${request.guest.lastName}`} />
            <Fact label={t(`item.${kind}`)} value={request.offering.name[locale]} />
            <Fact label={t('date')} value={formatStayDate(request.preferredDate, locale)} />
            <Fact label={t('askedFor')} value={formatTimeOfDay(request.preferredTime, locale)} />
            <Fact label={t('guestsLabel')} value={formatNumber(request.guests, locale)} />
            <Fact
              label={t('language')}
              value={request.locale === 'ar' ? t('arabic') : t('english')}
            />
          </dl>

          {request.notes ? (
            <Alert tone="info">
              <strong>{t('guestNote')}</strong> <span dir="auto">{request.notes}</span>
            </Alert>
          ) : null}

          <div className={styles.formGrid}>
            <Field label={t('confirmAt')} hint={t('confirmAtHint')}>
              <Input
                type="time"
                step={300}
                value={time}
                onChange={(event) => setTime(event.target.value)}
                dir="ltr"
                required
              />
            </Field>
            <Field label={t('noteToGuest')} hint={t('noteHint')}>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                rows={3}
                dir="auto"
              />
            </Field>
          </div>

          <div className={styles.formActions}>
            <Button variant="primary" disabled={busy || !time} onClick={() => void send('confirmed')}>
              {request.status === 'new' ? t('confirm') : t('moveTime')}
            </Button>
            {request.status === 'new' ? (
              <Button disabled={busy} onClick={() => void send('declined')}>
                {t('decline')}
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void send('cancelled')}>
                {t('cancelBooking')}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              {t('close')}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={styles.defLabel}>{label}</dt>
      <dd className={styles.defValue}>
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

/** The menu guests choose from — treatments, or restaurants. */
function MenuEditor({
  kind,
  offerings,
  locale,
  canEdit,
  onChanged,
  onError,
}: {
  kind: ServiceKind;
  offerings: AdminServiceOffering[];
  locale: Locale;
  canEdit: boolean;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin.services');
  const describeError = useApiErrorMessage();
  const [editing, setEditing] = useState<AdminServiceOffering | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminServiceOffering | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      await onChanged(message);
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title={t(`menuTitle.${kind}`)}
          description={t(`menuHint.${kind}`)}
          actions={
            canEdit && !editing ? (
              <Button size="small" onClick={() => setEditing('new')}>
                {t(`add.${kind}`)}
              </Button>
            ) : undefined
          }
          tight
        />
        {offerings.length === 0 ? (
          <CardBody>
            <p className={styles.hint}>{t('menuEmpty')}</p>
          </CardBody>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('name')}</th>
                  <th scope="col">{kind === 'spa' ? t('lengthAndPrice') : t('maxParty')}</th>
                  <th scope="col">{t('times')}</th>
                  <th scope="col">{t('status')}</th>
                  {canEdit ? <th scope="col">{t('actions')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {offerings.map((offering) => (
                  <tr key={offering.code}>
                    <td>
                      <bdi>{offering.name[locale]}</bdi>
                      <span className={`${styles.cellSub} ${styles.mono}`}>
                        <Num>{offering.code}</Num>
                      </span>
                    </td>
                    <td className={styles.numeric}>
                      {kind === 'spa' ? (
                        <Num>
                          {offering.durationMinutes !== null
                            ? t('minutes', { count: offering.durationMinutes })
                            : '—'}
                          {' · '}
                          {offering.price !== null
                            ? formatMoney(offering.price, 'AED', locale)
                            : '—'}
                        </Num>
                      ) : (
                        <Num>{formatNumber(offering.maxGuests, locale)}</Num>
                      )}
                    </td>
                    <td className={styles.numeric}>
                      <Num>
                        {formatTimeOfDay(offering.firstSlot, locale)} –{' '}
                        {formatTimeOfDay(offering.lastSlot, locale)}
                      </Num>
                    </td>
                    <td>
                      <Badge tone={offering.isActive ? 'success' : 'neutral'} dot>
                        {offering.isActive ? t('onMenu') : t('offMenu')}
                      </Badge>
                    </td>
                    {canEdit ? (
                      <td>
                        <div className={styles.rowActions}>
                          <Button size="small" disabled={busy} onClick={() => setEditing(offering)}>
                            {t('edit')}
                          </Button>
                          <Button
                            size="small"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () =>
                                  adminApi.updateServiceOffering(kind, offering.code, {
                                    isActive: !offering.isActive,
                                  }),
                                t('saved', { name: offering.name[locale] }),
                              )
                            }
                          >
                            {offering.isActive ? t('hide') : t('show')}
                          </Button>
                          {/* Only offered when nobody has asked for it — the
                              API refuses otherwise, to keep the record. */}
                          {offering.requestCount === 0 ? (
                            <Button size="small" disabled={busy} onClick={() => setPendingDelete(offering)}>
                              {t('delete')}
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
        )}
      </Card>

      {editing ? (
        <OfferingForm
          key={editing === 'new' ? 'new' : editing.code}
          kind={kind}
          offering={editing === 'new' ? null : editing}
          locale={locale}
          onCancel={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            await onChanged(t('saved', { name }));
          }}
          onError={onError}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('confirmDeleteTitle')}
        description={t('confirmDelete', { name: pendingDelete?.name[locale] ?? '' })}
        confirmLabel={t('delete')}
        destructive
        busy={busy}
        onConfirm={() => {
          const offering = pendingDelete;
          setPendingDelete(null);
          if (offering) {
            void act(
              () => adminApi.deleteServiceOffering(kind, offering.code),
              t('deleted', { name: offering.name[locale] }),
            );
          }
        }}
        onDismiss={() => setPendingDelete(null)}
      />
    </>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function OfferingForm({
  kind,
  offering,
  locale,
  onCancel,
  onSaved,
  onError,
}: {
  kind: ServiceKind;
  offering: AdminServiceOffering | null;
  locale: Locale;
  onCancel: () => void;
  onSaved: (name: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin.services');
  const describeError = useApiErrorMessage();

  const [code, setCode] = useState(offering?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(offering !== null);
  const [nameEn, setNameEn] = useState(offering?.name.en ?? '');
  const [nameAr, setNameAr] = useState(offering?.name.ar ?? '');
  const [descriptionEn, setDescriptionEn] = useState(offering?.description?.en ?? '');
  const [descriptionAr, setDescriptionAr] = useState(offering?.description?.ar ?? '');
  const [duration, setDuration] = useState(
    offering?.durationMinutes != null ? String(offering.durationMinutes) : kind === 'spa' ? '60' : '',
  );
  const [price, setPrice] = useState(offering?.price != null ? String(offering.price) : '');
  const [firstSlot, setFirstSlot] = useState(offering?.firstSlot ?? (kind === 'spa' ? '10:00' : '12:00'));
  const [lastSlot, setLastSlot] = useState(offering?.lastSlot ?? (kind === 'spa' ? '20:00' : '22:00'));
  const [maxGuests, setMaxGuests] = useState(String(offering?.maxGuests ?? (kind === 'spa' ? 2 : 8)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const halfHour = /^([01]\d|2[0-3]):[03]0$/;
    if (!halfHour.test(firstSlot) || !halfHour.test(lastSlot)) {
      setProblem(t('halfHours'));
      return;
    }
    if (lastSlot < firstSlot) {
      setProblem(t('slotOrder'));
      return;
    }
    const hasDescription = descriptionEn.trim() !== '' || descriptionAr.trim() !== '';
    if (hasDescription && (!descriptionEn.trim() || !descriptionAr.trim())) {
      setProblem(t('bothDescriptions'));
      return;
    }
    setProblem(null);
    setBusy(true);

    const fields = {
      name: { en: nameEn.trim(), ar: nameAr.trim() },
      description: hasDescription ? { en: descriptionEn.trim(), ar: descriptionAr.trim() } : null,
      durationMinutes: duration.trim() === '' ? null : Number(duration),
      price: price.trim() === '' ? null : Number(price),
      firstSlot,
      lastSlot,
      maxGuests: Number(maxGuests),
    };

    try {
      if (offering) {
        await adminApi.updateServiceOffering(kind, offering.code, fields);
      } else {
        await adminApi.createServiceOffering(kind, { code: code.trim(), ...fields });
      }
      await onSaved(fields.name[locale]);
    } catch (caught) {
      onError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={offering ? t('editTitle') : t(`add.${kind}`)} description={t('formHint')} />
      <CardBody>
        <form onSubmit={submit} className={styles.stack}>
          <div className={styles.formGrid}>
            <Field label={t('nameEn')}>
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
            <Field label={t('nameAr')}>
              <Input
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                lang="ar"
                dir="rtl"
                maxLength={120}
                required
              />
            </Field>
            <Field label={t('code')} hint={t('codeHint')}>
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
                disabled={offering !== null}
                required
              />
            </Field>
            {kind === 'spa' ? (
              <>
                <Field label={t('duration')}>
                  <Input
                    type="number"
                    min="5"
                    max="600"
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                    dir="ltr"
                  />
                </Field>
                <Field label={t('price')} hint={t('priceHint')}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    dir="ltr"
                  />
                </Field>
              </>
            ) : null}
            <Field label={t('firstSlot')} hint={t('slotHint')}>
              <Input
                type="time"
                step={1800}
                value={firstSlot}
                onChange={(event) => setFirstSlot(event.target.value)}
                dir="ltr"
                required
              />
            </Field>
            <Field label={t('lastSlot')}>
              <Input
                type="time"
                step={1800}
                value={lastSlot}
                onChange={(event) => setLastSlot(event.target.value)}
                dir="ltr"
                required
              />
            </Field>
            <Field label={t('maxGuests')}>
              <Input
                type="number"
                min="1"
                max="50"
                value={maxGuests}
                onChange={(event) => setMaxGuests(event.target.value)}
                dir="ltr"
                required
              />
            </Field>
          </div>

          <div className={styles.formGrid}>
            <Field label={t('descriptionEn')}>
              <Textarea
                value={descriptionEn}
                onChange={(event) => setDescriptionEn(event.target.value)}
                lang="en"
                dir="ltr"
                rows={2}
                maxLength={2000}
              />
            </Field>
            <Field label={t('descriptionAr')}>
              <Textarea
                value={descriptionAr}
                onChange={(event) => setDescriptionAr(event.target.value)}
                lang="ar"
                dir="rtl"
                rows={2}
                maxLength={2000}
              />
            </Field>
          </div>

          {problem ? <Alert tone="error">{problem}</Alert> : null}

          <div className={styles.formActions}>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? t('saving') : t('save')}
            </Button>
            <Button onClick={onCancel} disabled={busy}>
              {t('close')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
