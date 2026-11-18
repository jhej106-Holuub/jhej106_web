# localhost diaries

A retro developer blog, projects archive, and changelog. The site ships with six pixel-art trophies and zero posts, projects, or changelog entries. Supabase handles the Owner dashboard, authentication, media, moderation, account history, and release jobs. Resend handles newsletters and comment alerts.

## Rychlý start

- Prohlížeč otevře nasazený web přímo. Ve složce `dist/` jsou skutečné soubory HTML včetně `index.html` a samostatných archivů.
- Pro GitHub nahraj do nového repozitáře zdrojové soubory včetně skryté složky `.github/`. Vynech vygenerovanou složku `dist/`.
- Na GitHubu zvol **Settings → Pages → Source → GitHub Actions**. GitHub spustí `npm ci` sám. Přihlášení a e-maily se zapojí podle kroků níže.

## Run it locally

Install [Node.js 22 or newer](https://nodejs.org/). Open a terminal in the folder with `package.json`.

```sh
npm ci
npm run build
npm run dev
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). The prebuilt `dist/` in the source ZIP can also be served with `node scripts/serve.mjs` immediately after extraction. Use an HTTP preview or static hosting so nested routes, assets, and JavaScript load from the same origin. The public pages show all published writing with JavaScript disabled. Search, preferences, the trophy effects, and account tools use JavaScript.

| Component | Where it runs |
| --- | --- |
| Static HTML and RSS | GitHub Pages |
| Release export, build, and acknowledgment | GitHub Actions |
| Auth, account data, publishing jobs, and media originals | Supabase |
| Signup and sign-in codes | Supabase Auth and your SMTP provider |
| Newsletters and comment alerts | Resend and the Supabase worker |

## 1. Set up GitHub Pages

1. Create a GitHub repository, put the contents of this directory at its root, and push to the default branch. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
2. Restrict the Pages environment to the default branch. If you use the default Pages URL, set your public address to `https://USERNAME.github.io/REPOSITORY/`. For a custom domain, set it in **Settings → Pages → Custom domain**, configure the DNS records GitHub shows, and enable **Enforce HTTPS**. Use the final HTTPS address with a trailing slash.
3. In **Settings → Secrets and variables → Actions**, add the repository variables and secret below. For a single deployment leave `ACCOUNT_URL` unset, so `/account/` and `/admin/` are under the public base path. For a separate origin follow section 7.

| GitHub value | Where to get it |
| --- | --- |
| Variable `BASE_PATH` | Exact public path with both slashes, such as `/REPOSITORY/` or `/` |
| Variable `PUBLIC_URL` | Final GitHub Pages or custom public URL, with a trailing slash |
| Variable `ACCOUNT_URL` | Optional, final separate account URL with a trailing slash |
| Variable `SUPABASE_URL` | Supabase project HTTPS URL, without a trailing slash |
| Variable `SUPABASE_PUBLISHABLE_KEY` | Supabase project publishable key from **Project Settings → API Keys** |
| Variable `DIARIES_RELEASE_URL` | `https://PROJECT.supabase.co/functions/v1/diaries/release` |
| Secret `DIARIES_BUILD_SECRET` | A randomly generated key shared only with the release endpoint |
| Ad variables | Leave unset during initial setup. See [the AdSense report](docs/AdSense.md). |

Create a fine-grained GitHub token for the specific public Pages repository with **Contents: Read and write**, as required by the [Create a repository dispatch event](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event) endpoint. Keep that token in Supabase secrets. A repository-scoped GitHub App token is also suitable if you arrange renewal. GitHub's Actions token handles the Pages deployment separately.

## 2. Create the Supabase backend

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), create or choose a Supabase project, then run:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy diaries --no-verify-jwt
```

The migrations create a private database schema with RLS enabled and no direct browser policies granting table access. Supabase Auth, grants, session-based RPCs, and server-side checks guard operations. The private Storage bucket is used via the Edge Function. The deployment workflow receives an allowlisted snapshot and only its referenced image variants. Original images and preview URLs stay private.

Copy [the Supabase secrets example](docs/supabase-secrets.env.example) to an ignored file, fill in its values, and run:

```sh
supabase secrets set --env-file .env.supabase
```

Use different random values of at least 32 characters for `DIARIES_BUILD_SECRET`, `DIARIES_WORKER_SECRET`, and `DIARIES_RATE_SECRET`. Generate each with `openssl rand -hex 32`. Keep the service-role key within Supabase. The function uses the service-role key provided by the runtime. Browser config receives only the publishable key.

## 3. Turn on the release worker

In Supabase enable **Cron** and the **pg_net** database extension as required by your project. In **SQL Editor → New query**, place the worker URL and worker secret in Vault. Replace the placeholders in the following SQL in the protected console:

```sql
select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/diaries/worker',
  'diaries_worker_url'
);
select vault.create_secret('YOUR_DIARIES_WORKER_SECRET', 'diaries_worker_key');

select cron.schedule('diaries-worker', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'diaries_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-diaries-worker', (select decrypted_secret from vault.decrypted_secrets where name = 'diaries_worker_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 95000
  );
$job$);
```

Check that a run appears in **Integrations → Cron**. In GitHub, open **Actions → Deploy Localhost Diaries → Run workflow** for an initial deploy. Allow several minutes for Pages to serve the release marker. GitHub Actions serializes production deploys. The worker checks the live marker and reconciles a successful deploy if the acknowledgement is interrupted. Review and retry failures in the Owner dashboard and GitHub Actions. A publish request queues work. Readers continue to see the previously deployed version until a new version succeeds.

## 4. Configure sign-in and claim the Owner account

1. In Supabase open **Authentication → URL Configuration**. Set **Site URL** to the actual account URL and add the exact `account/` callback URL under **Redirect URLs**. Keep email authentication, email verification, and secure email changes enabled.
2. Set up [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) under **Authentication → Email → SMTP Settings**. With Resend use its [SMTP settings](https://resend.com/docs/send-with-smtp). Verify the sending domain in Resend first. Under **Authentication → Email → Templates**, edit the **Magic Link** and **Confirm signup** templates to show the token `{{ .Token }}` in the body. Keep the **Change Email Address** confirmation links intact. Enable the TOTP authenticator factor.
3. Open the deployed `account/` page. Enter the email you want to use as the Owner, select **Create a reader account if needed**, and enter the code from your inbox.
4. In Supabase **SQL Editor**, run the following with your verified email. The result must return one row. The database protects this single Owner identity from ordinary suspension or deletion.

```sql
insert into diary.roles (user_id, role)
select id, 'owner'
from auth.users
where lower(email) = lower('YOUR_VERIFIED_EMAIL')
  and email_confirmed_at is not null
returning user_id;
```

5. Visit `admin/`. Use the same email sign-in and enroll an authenticator app. Every protected Owner operation requires an authenticated MFA-level session. Preserve your authenticator backup and cloud-console access. During an account recovery, verify identity out of band and use Supabase's administrative MFA reset process.

## 5. Enable comment alerts and newsletters

Verify your domain in **Resend → Domains** and create a sending API key. In **Resend → Webhooks**, add `https://YOUR_PROJECT_REF.supabase.co/functions/v1/diaries/webhook` and subscribe to sent, delivered, bounced, failed, and complained events. Put the signing secret and API key in Supabase secrets. Choose a verified sender address under `DIARIES_FROM_EMAIL`. When ready, set `DIARIES_MAIL_ENABLED=true` and test with addresses you control. Auth SMTP and the content mail queue have separate configuration. Disable link and open tracking for this mail stream in Resend.

In **Owner dashboard → Settings → Comment alerts**, add a recipient, save, then choose **Send verification**. The recipient opens and confirms the verification link. Choose **Send test** to verify delivery. Then select all posts or specific posts and whether to notify immediately or in a digest. The default trigger is a new comment entering moderation. A reader's email stays out of alert bodies.

Newsletter signup and reader signup are independent. Newsletter options are every new post or a weekly digest. A confirmation is required before sending post emails. An unsubscribe link works without a reader login. Monday at 09:00 in the site time zone is the default weekly digest schedule.

## 6. Publish, moderate, and operate the site

- **Posts → New post** opens the Markdown editor. Use the toolbar for emphasis, handwriting, tables, quotes and fenced code. Raw HTML is escaped. For handwriting, start a line with `:::handwriting ` and add the note. Use `![Alt text](IMAGE_UUID#wide)` for an inline asset whose layout is wide. Cover images use the Media ID and dedicated alt text. Use **Image up/down** to move a Markdown image relative to surrounding lines. Caption links and credits are editable in Media.
- Choose **Publish now** or set a schedule. Check the URL and time before confirming. Time is stored in UTC and displayed in the configured site timezone. During a skipped or repeated daylight-saving hour, select another time. Published revisions stay available while edits are private. A new slug preserves previous published URLs via a static redirect page. After successful removal, external caches and copies can remain.
- **Overview** and **Analytics** show counted public article displays. A visible display can count once, repeat openings can count again, and some automated traffic may get through. Dates are UTC. Readers can opt in through **Cookies & theme**. The dashboard does not join opens to account history. **Accounts** shows explicit reader actions and identity metadata after Owner MFA.
- **Comments** approves, hides, marks spam, or deletes. Approved comments appear through the public API without a Pages rebuild. **Collectibles** edits artwork, metadata, order, and the supported discovery action. All six built-in discoveries work with an empty archive.
- Use media smaller than 8 MiB and up to 18 megapixels in JPEG, PNG, or WebP. The function validates the decoded image and strips metadata from derived images. The renderer uses responsive PNGs packaged into the public Pages release. A private original is retained for recovery. A saved revision prevents image deletion. Seed illustrations use WebP.
- Readers can request account deletion from **Privacy**. Review the request in **Accounts** and check the identity before processing. In the authorized Supabase admin console, clear or anonymize public comments and content references per your retention policy, remove any associated subscription where appropriate, and use **Authentication → Users** to delete the account. Private bookmarks, collectible claims, profile, and account activity cascade from the user record. The audit record preserves the action and the previously assigned UUID. Adjust this procedure for your privacy commitments.
- Keep encrypted backups of Postgres and the private storage bucket in a location accessible only to the operator. For a self-managed backup use `supabase db dump --linked --data-only` and also export the relevant Storage objects, with credentials kept outside the repository. If relying on Supabase backups, confirm the plan's coverage and keep a separate copy of objects. Test restoring a backup in a nonproduction project with outbound mail and GitHub dispatch disabled. Restore data into an equivalent migrated schema, restore the media objects under their existing keys, configure new secrets, and verify that the release marker points to the correct production version before resuming automation.

## Themes and trophies

The first visit opens one dialog with Classic, Terminal, Midnight, Warm Paper and separate cookie choices. Reopen it from **Cookies & theme** on every page. All six original 16×16 sprites are bundled. **Dashboard → Collectibles** supports keyboard and pointer drawing, PNG replacement, a transparent eraser, undo, a 1× preview, and stable trophy IDs.

Guest collection storage is optional. Signed-in Readers can import discoveries from the same origin; split origins support an explicit copy-and-paste collection code. Disabling trophy awards leaves the playful effects and earned records available.

## 7. Add a separate account origin for ads

A separate origin requires a different hostname. Two paths on the same `USERNAME.github.io` hostname share an origin. Set up the second GitHub Pages repository with the same source and copy [docs/account-pages.yml](docs/account-pages.yml) to its `.github/workflows/pages.yml`. Use either a distinct domain or a subdomain such as `accounts.example.com`. Set matching account and public URLs in both repositories and the Edge Function's secrets. Update Supabase Auth callback URLs. Deploy and test the account site before switching the public site. It contains only the account and admin entry points. Sessions stay in account-origin browser storage. The public site links users there with the post ID and a checked local return route.

Read [the AdSense report](docs/AdSense.md) before activating the ad adapter. Live ads are off by default.

## Verify and troubleshoot

```sh
npm run check
npm run check:sql
npm run build
node scripts/check-links.mjs
```

`check:sql` executes the real migrations and a role and release test in an embedded PostgreSQL runtime with minimal Auth and Storage fixtures. It cannot verify Supabase Auth email, hosted Edge limits, GitHub deployment, or Resend delivery. The [test record](docs/verification.md) lists production checks to run against configured services.

| Symptom | What to check |
| --- | --- |
| Pages CSS or deep links return 404 | Set the full canonical URL including its repository base path and trailing slash. Check Pages source is GitHub Actions. |
| Sign-in email never arrives | Check custom SMTP, sending domain, Auth rate limits, and the OTP template. |
| Owner access is denied | Confirm that the verified email matches the role row and that the session has completed TOTP challenge. |
| Publish stays queued | Check Cron, Vault, the dispatch token and repository, then inspect Actions. A first deploy can be started manually. |
| Deploy failed, or a release cannot be confirmed | Check the workflow logs, canonical URL and `release.json`. Use **Retry failed deployment** after resolving the underlying error. |
| Email appears queued | Check the worker is running and `DIARIES_MAIL_ENABLED` is true. Verify sender domain, recipient, and webhook secret. |
| Email appears as **review** | Compare the job and time against Resend before recording a resolution. Reuse the job retry only when the provider has not accepted the original send. |
| Ads remain off | Check the approved root domain, independent account origin, build variables, eligibility, runtime kill switch, and CMP consent. |
