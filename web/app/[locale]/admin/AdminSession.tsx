'use client';

/**
 * The admin session gate.
 *
 * Wraps every admin screen. On mount it asks the API who is signed in; if
 * nobody is, it renders the login form instead of the screen.
 *
 * **This is a convenience, not the security boundary.** Anyone can render this
 * component with the API unreachable and see whatever it guards. The real
 * enforcement is `requireAdmin` on the server, which rejects every admin
 * request without a session — so the worst a bypass achieves is an empty
 * screen full of failed requests. Nothing sensitive is in the bundle.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';

import { ApiError } from '@/lib/api/client';
import { adminApi, type AdminIdentity } from '@/lib/api/admin-client';
import { Alert, Button, cx, Field, Input, Loading } from './ui';
import styles from './Admin.module.css';

interface SessionContextValue {
  admin: AdminIdentity;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** The signed-in admin. Only valid inside `AdminSessionProvider`. */
export function useAdminSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useAdminSession must be used inside AdminSessionProvider');
  }
  return value;
}

type State =
  | { phase: 'checking' }
  | { phase: 'anonymous' }
  | { phase: 'signed-in'; admin: AdminIdentity };

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: 'checking' });

  const check = useCallback(async () => {
    try {
      setState({ phase: 'signed-in', admin: await adminApi.getSession() });
    } catch {
      // Any failure here — no session, expired session, API unreachable —
      // lands on the login form, which is the one screen that can recover.
      setState({ phase: 'anonymous' });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const signOut = useCallback(async () => {
    try {
      await adminApi.logout();
    } finally {
      // Sign out locally even if the call failed; leaving someone looking at a
      // panel they asked to leave is the worse outcome.
      setState({ phase: 'anonymous' });
    }
  }, []);

  if (state.phase === 'checking') {
    return (
      <div className={styles.loginScreen}>
        <Loading />
      </div>
    );
  }

  if (state.phase === 'anonymous') {
    return (
      <LoginForm
        onSignedIn={(admin) => setState({ phase: 'signed-in', admin })}
      />
    );
  }

  return (
    <SessionContext.Provider value={{ admin: state.admin, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

function LoginForm({
  onSignedIn,
}: {
  onSignedIn: (admin: AdminIdentity) => void;
}) {
  const t = useTranslations('admin');
  const tErrors = useTranslations('errors');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      onSignedIn(await adminApi.login(email, password));
    } catch (caught) {
      // Branch on the code, not the server's prose, so the message is
      // translated and "wrong password" reads differently from "API down".
      if (caught instanceof ApiError && caught.code === 'NETWORK_ERROR') {
        setError(tErrors('network'));
      } else if (caught instanceof ApiError && caught.status === 429) {
        setError(t('login.rateLimited'));
      } else {
        setError(t('login.failed'));
      }
      setBusy(false);
    }
  }

  return (
    <div className={styles.loginScreen}>
      <form className={styles.loginCard} onSubmit={submit}>
        <div className={styles.loginBrand}>
          <span
            className={cx(styles.monogram, styles.monogramLarge)}
            aria-hidden="true"
          >
            C
          </span>
          <div>
            <h1 className={styles.loginTitle}>{t('brand')}</h1>
            <p className={styles.loginSub}>{t('title')}</p>
          </div>
        </div>

        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <Field label={t('login.email')}>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            // Email addresses are Latin text in both locales; without this they
            // reorder inside an Arabic form.
            dir="ltr"
          />
        </Field>

        <Field label={t('login.password')}>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            dir="ltr"
          />
        </Field>

        <Button variant="primary" type="submit" full disabled={busy}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </Button>
      </form>
    </div>
  );
}
