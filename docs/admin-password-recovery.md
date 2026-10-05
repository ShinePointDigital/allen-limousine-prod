# Administrator password recovery

The login page offers **Forgot password?**. A signed-in super-admin can also send a reset link from **Admin users**. Links expire after 30 minutes, are stored only as hashes, and can be used once. A successful reset revokes all account sessions without changing its role or enabling a disabled account.

## Vercel production requirements

Configure these values in the existing Vercel project's production environment:

- `SENDGRID_FROM_EMAIL`: a sender verified in the same SendGrid account.
- `SENDGRID_API_KEY`: a SendGrid API key with Mail Send permission. Enter it securely in Vercel, never in chat or source control.
- `PUBLIC_APP_ORIGIN`: the actual HTTPS website origin, without a path, query, or credentials. It is used for reset links, not an untrusted incoming host.

A connected Replit SendGrid account does not supply credentials to an external Vercel runtime. In Replit, the app can use that connection instead of a direct API key.

Verify a Gmail sender using SendGrid's Single Sender Verification process and confirm the verification email. For longer-term delivery, a domain-authenticated business sender is preferable.

The existing Vercel build runs versioned Prisma migrations. The password-recovery migration only adds a table and does not alter existing administrators. Do not run account creation against development and assume it created a production account.

## Adding the new super-admin

Sign in to the live site as an existing super-admin. Go to **Admin users → Add administrator**, enter the new administrator's name and email, set a private password of at least 12 characters, and select **Super admin**. This preserves the existing administrator accounts.

## Verification

- `npm run test:admin-recovery` checks API privacy, authorization, and mail-provider responses with simulated delivery.
- `RUN_RECOVERY_DB_TESTS=1 npm run test:admin-recovery` additionally checks the configured development/test database using a temporary account that is deleted afterward. Never run this against production.