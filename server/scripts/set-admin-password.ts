/**
 * Set an admin's password from the command line.
 *
 * The seed creates the first admin account but only when `SEED_ADMIN_PASSWORD`
 * is set, and it never touches an existing account's password. That leaves no
 * way to recover an account whose password has been lost, and no way to hand a
 * new member of staff their first one — hence this.
 *
 * Deliberately not an API endpoint. Password reset by email is a Phase 1
 * feature we have not built, and an admin-facing "reset anyone's password"
 * route is a privilege-escalation path that has to be designed rather than
 * bolted on. A command run by whoever holds the database URL is the honest
 * version of this.
 *
 *   npm run admin:password -- admin@covedubai.local 'a strong password'
 *
 * Quote the password so the shell does not interpret it, and be aware it will
 * land in your shell history.
 */
import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/auth/password.js';

/** Long enough that scrypt is the only barrier that matters. */
const MINIMUM_LENGTH = 12;

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error(
      "Usage: npm run admin:password -- <email> '<password>'\n" +
        '\nSets the password for an existing admin account.',
    );
    process.exitCode = 1;
    return;
  }

  if (password.length < MINIMUM_LENGTH) {
    console.error(
      `The password must be at least ${MINIMUM_LENGTH} characters.`,
    );
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();

  try {
    const admin = await prisma.adminUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!admin) {
      const known = await prisma.adminUser.findMany({
        select: { email: true },
      });
      console.error(
        `No admin account with email "${email}".\n` +
          `Existing accounts: ${known.map((a) => a.email).join(', ') || 'none'}`,
      );
      process.exitCode = 1;
      return;
    }

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(password) },
    });

    // Changing a password is an administrative action, so it is audited like
    // any other — with no admin id, because nobody was signed in to do it.
    await prisma.auditLog.create({
      data: {
        adminUserId: null,
        action: 'admin.password_set',
        entityType: 'admin_user',
        entityId: admin.email,
        details: { via: 'set-admin-password script' },
      },
    });

    console.log(`Password updated for ${admin.email} (${admin.role}).`);
    console.log(
      'Existing sessions are left alone — run this again after revoking them ' +
        'if the old password was compromised.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
