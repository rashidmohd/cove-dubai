'use client';

/**
 * The admin panel's component layer.
 *
 * Hand-built on CSS Modules rather than installed from a component library.
 * The conventions are borrowed from modern dashboard UI — the variant names
 * below will look familiar to anyone who has used shadcn/ui — but the
 * implementation is this project's own, because pulling in a kit would mean
 * pulling in Tailwind and running two styling systems in one application.
 *
 * Everything here is presentational and knows nothing about reservations. The
 * pieces that do — status badges, API error messages — live in `pieces.tsx`.
 */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslations } from 'next-intl';

import {
  AlertIcon,
  EmptyIcon,
  InfoIcon,
  NextIcon,
  PreviousIcon,
  SuccessIcon,
} from './icons';
import styles from './Admin.module.css';

/**
 * Join class names, dropping anything absent.
 *
 * `noUncheckedIndexedAccess` types every `styles.x` as possibly undefined, so
 * this exists to keep the call sites free of non-null assertions.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* --------------------------------------------------------------------------
 * Button
 * -------------------------------------------------------------------------- */

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger';

type ButtonSize = 'default' | 'small' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string | undefined> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  outline: styles.buttonOutline,
  ghost: styles.buttonGhost,
  danger: styles.buttonDanger,
};

const BUTTON_SIZES: Record<ButtonSize, string | undefined> = {
  default: undefined,
  small: styles.buttonSmall,
  icon: styles.buttonIcon,
};

/**
 * A button.
 *
 * `type` defaults to `button`, not `submit`. The old markup spelt `type` out on
 * every call and a single omission inside a form would have silently submitted
 * it — the submit buttons here say so explicitly.
 */
export function Button({
  variant = 'outline',
  size = 'default',
  full,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
}) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        full && styles.buttonFull,
        className,
      )}
      {...rest}
    />
  );
}

/* --------------------------------------------------------------------------
 * Surfaces
 * -------------------------------------------------------------------------- */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cx(styles.card, className)}>{children}</section>;
}

/**
 * A card's heading strip.
 *
 * `tight` draws a rule underneath, for the case where the body is a table and
 * needs a hard separation rather than whitespace.
 */
export function CardHeader({
  title,
  description,
  actions,
  tight,
  headingLevel = 2,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tight?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';

  return (
    <div className={cx(styles.cardHeader, tight && styles.cardHeaderTight)}>
      <div>
        <Heading className={styles.cardTitle}>{title}</Heading>
        {description ? (
          <p className={styles.cardDescription}>{description}</p>
        ) : null}
      </div>
      {actions ? <div className={styles.cardActions}>{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx(styles.cardBody, className)}>{children}</div>;
}

/** A headline figure with its label and an optional supporting line. */
export function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card>
      <div className={styles.stat}>
        <p className={styles.statLabel}>
          <span>{label}</span>
          {icon}
        </p>
        <p className={styles.statValue}>{value}</p>
        {note ? <p className={styles.statNote}>{note}</p> : null}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------------
 * Form controls
 * -------------------------------------------------------------------------- */

/**
 * A labelled control.
 *
 * The control is a child of the `<label>`, so the label association is implicit
 * and needs no matching `id`/`htmlFor` pair to be kept in sync.
 *
 * **The hint is deliberately not inside the `<label>`.** Everything inside a
 * label contributes to the control's accessible *name*, so a hint placed there
 * is announced as part of the name on every focus — "Code, letters, numbers and
 * hyphens, for example SPRING25, edit text" — rather than as the description it
 * is. It is rendered as a sibling and wired with `aria-describedby`, which is
 * what screen readers and voice control expect.
 */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const hintId = useId();

  // The id is injected rather than demanded from every call site, so adding a
  // hint to a field never becomes a two-part change someone can half-do.
  const control =
    hint && isValidElement(children)
      ? cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': hintId,
        })
      : children;

  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.fieldLabel}>
        <span className={styles.label}>{label}</span>
        {control}
      </label>
      {hint ? (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(styles.input, className)} {...rest} />;
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(styles.select, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(styles.textarea, className)} {...rest} />;
}

/* --------------------------------------------------------------------------
 * Badges
 * -------------------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const BADGE_TONES: Record<BadgeTone, string | undefined> = {
  neutral: styles.badgeNeutral,
  success: styles.badgeSuccess,
  warning: styles.badgeWarning,
  danger: styles.badgeDanger,
  accent: styles.badgeAccent,
};

/**
 * A small status marker.
 *
 * The dot is reinforcement, never the message: `children` always states the
 * meaning in words, so the badge survives for anyone who cannot separate the
 * tints.
 */
export function Badge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx(styles.badge, BADGE_TONES[tone])}>
      {dot ? <span className={styles.badgeDot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Messages
 * -------------------------------------------------------------------------- */

type AlertTone = 'info' | 'success' | 'error';

const ALERT_TONES: Record<AlertTone, string | undefined> = {
  info: styles.alertInfo,
  success: styles.alertSuccess,
  error: styles.alertError,
};

const ALERT_ICONS: Record<AlertTone, ReactNode> = {
  info: <InfoIcon className={styles.icon} />,
  success: <SuccessIcon className={styles.icon} />,
  error: <AlertIcon className={styles.icon} />,
};

/**
 * An inline message.
 *
 * `role` is left to the caller. An error announces itself as an `alert`; a
 * saved-successfully line is a `status`; a standing explanatory note is neither
 * and must not be announced at all, or every screen would interrupt a screen
 * reader on arrival.
 */
export function Alert({
  tone = 'info',
  role,
  children,
}: {
  tone?: AlertTone;
  role?: 'alert' | 'status';
  children: ReactNode;
}) {
  return (
    <div className={cx(styles.alert, ALERT_TONES[tone])} role={role}>
      {ALERT_ICONS[tone]}
      <div>{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Loading and empty states
 * -------------------------------------------------------------------------- */

export function Loading() {
  const t = useTranslations('admin');

  return (
    <p className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {t('loading')}
    </p>
  );
}

/** A grey block standing in for content that has not arrived yet. */
export function Skeleton({
  width = '100%',
  height = '1rem',
}: {
  width?: string;
  height?: string;
}) {
  return (
    <span
      className={styles.skeleton}
      style={{ width, height, display: 'block' }}
      aria-hidden="true"
    />
  );
}

/**
 * The dashboard's four stat cards, before the figures arrive.
 *
 * Worth the extra markup on this screen specifically: it is the landing screen,
 * it is the one people open dozens of times a day, and a layout that settles
 * into place beats one that pops in from a centred spinner.
 */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  const t = useTranslations('admin');

  return (
    <>
      <p className="visually-hidden" role="status">
        {t('loading')}
      </p>
      <div className={styles.statGrid}>
        {Array.from({ length: count }, (_, index) => (
          <Card key={index}>
            <div className={styles.stat}>
              <Skeleton width="6rem" height="0.8125rem" />
              <div className={styles.statSkeletonValue}>
                <Skeleton width="4rem" height="1.5rem" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/**
 * An empty state.
 *
 * Isolated with `<bdi>` because most Arabic keys are still English
 * placeholders awaiting the client's copy, and an English sentence dropped
 * into an RTL paragraph has its full stop thrown to the front. Once the real
 * Arabic arrives, `auto` resolves it to RTL and this stays correct.
 */
export function Empty({ message }: { message: string }) {
  return (
    <div className={styles.empty}>
      <EmptyIcon className={styles.icon} size="1.5rem" />
      <p className={styles.emptyText}>
        <bdi>{message}</bdi>
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Pagination
 * -------------------------------------------------------------------------- */

/**
 * Previous / next across a result set.
 *
 * States the range rather than only the page number — "showing 26–50 of 132"
 * answers "have I seen everything?" in a way "page 2 of 6" does not.
 */
export function Pagination({
  from,
  to,
  total,
  onPrevious,
  onNext,
  canGoBack,
  canGoForward,
}: {
  from: number;
  to: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const t = useTranslations('admin');

  return (
    <nav className={styles.pagination} aria-label={t('pagination.label')}>
      <p className={styles.paginationInfo}>
        <bdi>{t('pagination.showing', { from, to, total })}</bdi>
      </p>
      <div className={styles.toolbarActions}>
        <Button size="small" disabled={!canGoBack} onClick={onPrevious}>
          <PreviousIcon
            className={cx(styles.icon, styles.iconDirectional)}
            size="0.875rem"
          />
          {t('pagination.previous')}
        </Button>
        <Button size="small" disabled={!canGoForward} onClick={onNext}>
          {t('pagination.next')}
          <NextIcon
            className={cx(styles.icon, styles.iconDirectional)}
            size="0.875rem"
          />
        </Button>
      </div>
    </nav>
  );
}

/* --------------------------------------------------------------------------
 * Confirmation dialog
 * -------------------------------------------------------------------------- */

/**
 * Ask before something irreversible.
 *
 * A native `<dialog>`, which brings the focus trap, the Escape key and
 * top-layer stacking without a library. It replaces `window.confirm`, which
 * could not be translated, could not mirror in Arabic, and rendered the
 * hotel's carefully worded warning in the browser's chrome font.
 *
 * `open` is driven by the caller so one dialog can serve a whole table of rows.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('admin');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      // The `cancel` event is Escape. Prevented so the close goes through the
      // caller's state, which is what the effect above reads.
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <div className={styles.dialogCard}>
        {/* Isolated for the same reason as the description: while the Arabic
            keys are still English placeholders, "Delete this amenity?" dropped
            into an RTL heading has its question mark thrown to the front. */}
        <h2 id={titleId} className={styles.dialogTitle}>
          <bdi>{title}</bdi>
        </h2>
        <p className={styles.dialogText}>
          <bdi>{description}</bdi>
        </p>
        <div className={styles.dialogActions}>
          <Button onClick={onDismiss} disabled={busy}>
            {t('dialog.goBack')}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('saving') : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
