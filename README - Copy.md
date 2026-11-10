## Run the Figma plugin

From this directory, install the plugin build dependencies and bundle the
TypeScript entry point:

```bash
npm install
npm run build
```

In Figma, import `backend-files/manifest.json` (not the ZIP file). The build
creates the `backend-files/code.js` entry point referenced by that manifest.
Rebuild after changing plugin source files.

Scan results, usage maps, component selection, unused-component deletion, and
CSV export run against the open Figma file. Users must sign in or create an
email/password account in the plugin before scanning. Email confirmation must
be completed when enabled in Supabase Auth. The plugin checks the account's
trial balance with Supabase and enforces three free scans of up to 100
components each. Apply the database migrations and deploy the `scan-gate`
function for trial enforcement:

```bash
supabase db push
supabase functions deploy scan-gate
```

Pro monthly, Pro yearly, Agency monthly, and Agency yearly options open their respective
$29, $299, $69, and $699 Dodo Payments checkouts. One-Time Usage opens the
separate $9 Dodo Payments checkout.
Checkout is not connected to subscription verification or automatic feature
activation in this version. Help and feedback are sent by the
`send-support` Supabase Edge Function through Resend; configure
`RESEND_API_KEY` and a verified `SUPPORT_FROM_EMAIL` with Supabase secrets:

```bash
supabase secrets set RESEND_API_KEY=re_... SUPPORT_FROM_EMAIL="Figma Auditor <support@yourdomain.com>" SUPPORT_TO_EMAIL=figmaauditor@gmail.com
supabase functions deploy send-support
```

Set the Supabase project URL and publishable/anon key in `src/config.ts`, then
rebuild the plugin. Replies use the email saved by the user in plugin Settings;
Figma's plugin API does not expose the signed-in user's email address.
