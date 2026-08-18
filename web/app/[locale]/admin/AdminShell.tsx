'use client';

/**
 * The panel chrome: sidebar, navigation, page header, and who is signed in.
 *
 * The sidebar sits on the inline-start edge, so it is on the left in English
 * and on the right in Arabic with no direction-specific CSS — that comes from
 * using logical properties throughout (`arabic-rtl`).
 *
 * The header is sticky. On a reservations list two hundred rows long, the
 * screen you are on and the actions available on it should not scroll away.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { useAdminSession } from './AdminSession';
import {
  AmenitiesIcon,
  CloseIcon,
  DashboardIcon,
  InventoryIcon,
  MenuIcon,
  ReservationsIcon,
  RoomsIcon,
  SettingsIcon,
  VouchersIcon,
  SignOutIcon,
} from './icons';
import { Button, cx } from './ui';
import styles from './Admin.module.css';

/**
 * The nav, grouped by what the section is for.
 *
 * Six flat links is where a sidebar stops being scannable — the front desk
 * lives in the first group all day and only visits the second to change how the
 * hotel is set up, and the grouping says so.
 */
const NAV_GROUPS = [
  {
    key: 'overview',
    items: [
      { href: '/admin', key: 'dashboard', Icon: DashboardIcon },
      { href: '/admin/reservations', key: 'reservations', Icon: ReservationsIcon },
    ],
  },
  {
    key: 'property',
    items: [
      { href: '/admin/rooms', key: 'rooms', Icon: RoomsIcon },
      { href: '/admin/amenities', key: 'amenities', Icon: AmenitiesIcon },
      { href: '/admin/inventory', key: 'inventory', Icon: InventoryIcon },
      { href: '/admin/vouchers', key: 'vouchers', Icon: VouchersIcon },
    ],
  },
  {
    key: 'system',
    items: [{ href: '/admin/settings', key: 'settings', Icon: SettingsIcon }],
  },
] as const;

export function AdminShell({
  title,
  meta,
  actions,
  children,
}: {
  title: string;
  meta?: ReactNode;
  /** Buttons for the screen as a whole, shown at the end of the header. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('admin');
  const { admin, signOut } = useAdminSession();
  const pathname = usePathname();

  const [navOpen, setNavOpen] = useState(false);
  const navId = useId();

  // Escape closes it, matching every other overlay on the platform.
  useEffect(() => {
    if (!navOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  return (
    <div className={styles.shell}>
      {navOpen ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label={t('closeMenu')}
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        id={navId}
        className={cx(styles.sidebar, navOpen && styles.sidebarOpen)}
      >
        <div className={styles.sidebarHead}>
          <span className={styles.monogram} aria-hidden="true">
            C
          </span>
          <p className={styles.brand}>
            <span className={styles.brandName}>{t('brand')}</span>
            <span className={styles.brandRole}>{t('title')}</span>
          </p>
        </div>

        <nav className={styles.nav} aria-label={t('title')}>
          {NAV_GROUPS.map((group) => (
            <div key={group.key} className={styles.navGroup}>
              <p className={styles.navGroupLabel}>
                {t(`nav.groups.${group.key}`)}
              </p>

              {group.items.map(({ href, key, Icon }) => {
                // Exact match for the dashboard, prefix match for the rest, so
                // /admin does not light up on every child route.
                const active =
                  href === '/admin'
                    ? pathname === '/admin'
                    : pathname.startsWith(href);

                return (
                  <Link
                    key={href}
                    href={href}
                    className={cx(
                      styles.navLink,
                      active && styles.navLinkActive,
                    )}
                    aria-current={active ? 'page' : undefined}
                    // Closed here rather than in an effect watching `pathname`.
                    // On a phone the menu covers the screen it navigated to, so
                    // it has to go — but a setState in a route-change effect is
                    // a cascading render for a thing the click already knows.
                    onClick={() => setNavOpen(false)}
                  >
                    <Icon className={styles.icon} />
                    {t(`nav.${key}`)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFoot}>
          <div className={styles.who}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(admin.name)}
            </span>
            <p className={styles.whoText}>
              {/* A staff name is database text in an unknown script. */}
              <bdi className={styles.whoName}>{admin.name}</bdi>
              <span className={styles.whoRole}>
                {t(`roles.${admin.role === 'ADMIN' ? 'admin' : 'staff'}`)}
              </span>
            </p>
          </div>

          <Button variant="ghost" size="small" full onClick={() => void signOut()}>
            <SignOutIcon className={styles.icon} size="0.875rem" />
            {t('signOut')}
          </Button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <Button
            variant="ghost"
            size="icon"
            className={styles.menuButton}
            aria-expanded={navOpen}
            aria-controls={navId}
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? (
              <CloseIcon className={styles.icon} size="1.125rem" />
            ) : (
              <MenuIcon className={styles.icon} size="1.125rem" />
            )}
            <span className="visually-hidden">{t('menu')}</span>
          </Button>

          <h1 className={styles.pageTitle}>{title}</h1>

          {meta ? (
            <>
              <span className={styles.headerDivider} aria-hidden="true" />
              <p className={styles.pageMeta}>{meta}</p>
            </>
          ) : null}

          {actions ? (
            <div className={styles.headerActions}>{actions}</div>
          ) : null}
        </header>

        <main className={styles.content} id="main">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Up to two initials for the avatar.
 *
 * `Array.from` rather than `[0]`, because indexing a string returns a UTF-16
 * code unit and would split an astral character — or, more likely here, take
 * half of a combining Arabic sequence.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
}
