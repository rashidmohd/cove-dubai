'use client';

/**
 * Operational settings.
 *
 * This is where the **Tourism Dirham** is corrected once the client confirms
 * the property's DET classification. The seeded AED 20 is a placeholder —
 * the top-tier rate, chosen as the safe assumption — and it must be confirmed
 * before launch.
 *
 * Changing it here takes effect on the next quote: pricing reads these values
 * from the database on every request, so there is no deploy and no restart.
 * Reservations already taken keep the price they were quoted; each one carries
 * its own snapshot and is never repriced (`booking-engine`).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { adminApi, type OperationalSetting } from '@/lib/api/admin-client';
import { AdminShell } from '../AdminShell';
import { useAdminSession } from '../AdminSession';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Input,
  Loading,
  Num,
  SavedNote,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

export function Settings() {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();
  const { admin } = useAdminSession();

  const canEdit = admin.role === 'ADMIN';

  const [settings, setSettings] = useState<OperationalSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .listSettings()
      .then(setSettings)
      .catch((caught: unknown) => setError(describeError(caught)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminShell
      title={t('nav.settings')}
      actions={
        canEdit ? undefined : (
          <Badge tone="neutral">{t('settings.readOnly')}</Badge>
        )
      }
    >
      <ErrorNote message={error} />
      <SavedNote message={notice} />

      <Card>
        <CardHeader
          title={t('nav.settings')}
          description={t('settings.intro')}
          tight
        />

        {!settings && !error ? <Loading /> : null}

        {settings?.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            canEdit={canEdit}
            onSaved={(updated) => {
              setSettings((current) =>
                (current ?? []).map((item) =>
                  item.key === updated.key ? updated : item,
                ),
              );
              setError(null);
              setNotice(t('settings.saved', { key: updated.key }));
            }}
            onError={(message) => {
              setNotice(null);
              setError(message);
            }}
          />
        ))}
      </Card>
    </AdminShell>
  );
}

function SettingRow({
  setting,
  canEdit,
  onSaved,
  onError,
}: {
  setting: OperationalSetting;
  canEdit: boolean;
  onSaved: (setting: OperationalSetting) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [value, setValue] = useState(setting.value);
  const [busy, setBusy] = useState(false);

  // Reset if the row is replaced by a reload from the server.
  useEffect(() => {
    setValue(setting.value);
  }, [setting.value]);

  const dirty = value.trim() !== setting.value;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      onSaved(await adminApi.updateSetting(setting.key, value.trim()));
    } catch (caught) {
      onError(describeError(caught));
      setValue(setting.value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.settingRow}>
      <div>
        <p className={styles.settingKey}>
          <Num>{setting.key}</Num>
        </p>
        <p className={styles.settingDescription}>{setting.description}</p>
      </div>

      {/*
        No visible label: the key and its description immediately beside the
        field already name it, and repeating "Value" nine times down the column
        adds nothing but height. The accessible name is supplied directly.
      */}
      <Input
        aria-label={t('settings.value')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={!canEdit || busy}
        // Values here are numbers and codes, never prose.
        dir="ltr"
      />

      {canEdit ? (
        <Button
          variant={dirty ? 'primary' : 'outline'}
          size="small"
          onClick={() => void save()}
          disabled={!dirty || busy}
        >
          {busy ? t('saving') : t('save')}
        </Button>
      ) : (
        <span className={styles.muted}>—</span>
      )}
    </div>
  );
}
