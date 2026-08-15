/**
 * Locale-aware navigation primitives.
 *
 * Use these `Link`, `redirect`, `usePathname` and `useRouter` exports rather
 * than the ones from `next/link` and `next/navigation`. They carry the active
 * locale automatically, so an internal link cannot silently drop a visitor from
 * `/ar` back into `/en`.
 */
import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
