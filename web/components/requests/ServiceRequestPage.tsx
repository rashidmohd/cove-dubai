/**
 * A spa or dining request page: the menu, and the form to ask for something
 * on it.
 *
 * One component for both, because they are the same decision — this thing, on
 * this day, at about this time, for this many people — and two pages built
 * separately would drift apart. The words differ by `kind`; the shape does not.
 *
 * A Server Component: the menu is rendered into the HTML, in both languages,
 * and only the form ships JavaScript.
 */
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';

import { Glow, Weave } from '@/components/BrandEffects';
import {
  BodyText,
  Reveal,
  Section,
  SectionHeading,
  SectionLabel,
} from '@/components/marketing';
import { bookingApi } from '@/lib/api/client';
import type { Locale, ServiceKind, ServiceOffering } from '@/lib/api/types';
import { formatMoney, formatTimeOfDay } from '@/lib/format';
import { ServiceRequestForm } from './ServiceRequestForm';
import styles from './ServiceRequest.module.css';

export async function ServiceRequestPage({
  kind,
  locale,
}: {
  kind: ServiceKind;
  locale: Locale;
}) {
  const t = await getTranslations('requests');

  // An unreachable API must not take the page down: the copy stands on its
  // own, and the form says requests are unavailable rather than breaking.
  let offerings: ServiceOffering[] = [];
  try {
    offerings = await bookingApi.getServiceOfferings(kind);
  } catch {
    offerings = [];
  }

  return (
    <>
      <Section className={styles.hero}>
        <Glow />
        <Weave />
        <Reveal>
          <SectionLabel>{t(`${kind}.label`)}</SectionLabel>
          <SectionHeading as="h1" accent={t(`${kind}.titleAccent`)}>
            {t(`${kind}.title`)}
          </SectionHeading>
          <BodyText className={styles.intro}>{t(`${kind}.intro`)}</BodyText>
        </Reveal>
      </Section>

      {/* The grid is on a wrapper, not the Section: Section puts its children
          in an inner container, so a grid on the Section has one child. */}
      <Section className={styles.layoutSection}>
        <div className={styles.layout}>
          <div className={styles.menu}>
            <h2 className={styles.menuTitle}>{t(`${kind}.menuTitle`)}</h2>
            {offerings.length === 0 ? (
              <p className={styles.body}>{t(`${kind}.unavailable`)}</p>
            ) : (
              <ul className={styles.menuList}>
                {offerings.map((offering) => (
                  <li key={offering.code} className={styles.menuItem}>
                    <div className={styles.menuHead}>
                      <h3 className={styles.itemName}>
                        {offering.name[locale]}
                      </h3>
                      {offering.price !== null ? (
                        <span className={styles.price}>
                          <bdi>
                            {formatMoney(
                              offering.price,
                              offering.currency,
                              locale,
                            )}
                          </bdi>
                        </span>
                      ) : null}
                    </div>
                    <p className={styles.meta}>
                      {offering.durationMinutes !== null
                        ? t('duration', { minutes: offering.durationMinutes })
                        : t('hours', {
                            from: formatTimeOfDay(
                              offering.slots[0] ?? '00:00',
                              locale,
                            ),
                            to: formatTimeOfDay(
                              offering.slots.at(-1) ?? '00:00',
                              locale,
                            ),
                          })}
                    </p>
                    {offering.description ? (
                      <p className={styles.body}>
                        {offering.description[locale]}
                      </p>
                    ) : null}
                    {/* A plain link, so it works before JavaScript: the form
                      reads `?item=` and preselects it. */}
                    <a
                      className={styles.itemLink}
                      href={`?item=${offering.code}#request`}
                    >
                      {t(`${kind}.requestThis`)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div id="request" className={styles.formColumn}>
            {/* The form reads `?item=` with `useSearchParams`, which cannot be
              known at build time; without the boundary the build fails rather
              than quietly making the page dynamic. */}
            <Suspense fallback={null}>
              <ServiceRequestForm
                kind={kind}
                offerings={offerings}
                locale={locale}
              />
            </Suspense>
          </div>
        </div>
      </Section>
    </>
  );
}
