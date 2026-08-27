# Inventory sync server

The backend for the Inventory app: a Cloudflare Worker in front of Neon
Postgres and an S3 bucket.

## Why the app does not talk to Postgres and S3 directly

Two reasons, both hard:

1. **React Native cannot open a TCP socket**, so the Postgres wire protocol is
   not available to the app at all.
2. **An APK is a zip file.** Anything embedded in it — a database connection
   string, an AWS access key — can be read by anyone who downloads it. A leaked
   database URL is full read/write on the shop's data; a leaked AWS key is
   somebody else's bill.

The Worker holds those credentials and exposes only the endpoints below. It is
about 250 lines and runs on Cloudflare's free tier.

```
 Android app  ──HTTPS──▶  Worker  ──HTTP──▶  Neon Postgres   (rows)
                            │
                            └─────presigned URL─────▶  S3    (photos)
```

## What it costs

| | Free tier | After that |
|---|---|---|
| Neon Postgres | 0.5 GB storage, autosuspends when idle and wakes in under a second | from ~$5/month |
| Cloudflare Workers | 100,000 requests/day | $5/month for 10M |
| Cloudflare R2 | 10 GB storage, **no time limit**, and no egress charge | ~$0.015/GB/month |
| AWS S3 (alternative) | 5 GB, **first 12 months of a new account only** | ~$0.023/GB/month, plus egress per download |

At roughly 150 KB per product photo, 10 GB is about 65,000 images — far beyond
this app's design target. The reason to prefer R2 over S3 is not the storage
allowance but egress: S3 bills for every photo a device downloads, and a shop
adding a second or third till downloads the whole catalogue again each time.

## Setup

### 1. Database (Neon)

Neon is hosted Postgres with a free tier. Nothing to install — the whole setup
happens in the browser.

**a. Create the project.** Sign up at [neon.tech](https://neon.tech) (GitHub or
Google login is quickest), then create a project:

| Field | What to put |
|---|---|
| Project name | `inventory` |
| Postgres version | whatever is offered as the default |
| Region | the one physically closest to your shop — for India that is usually Singapore (`ap-southeast-1`), unless a Mumbai region is offered |

Region matters more than it looks: every sync is a round trip, and picking a
region on another continent adds a few hundred milliseconds to each one. It
cannot be changed later without recreating the project, so choose it now.

**b. Create the tables.** Open **SQL Editor** in the left-hand menu, paste the
entire contents of `schema.sql`, and run it. On macOS you can copy the file
straight to the clipboard:

```bash
pbcopy < server/schema.sql
```

It should report success for all 19 statements. Every statement is written
`IF NOT EXISTS`, so running it twice is harmless — if you are unsure whether it
worked, just run it again.

If you happen to have `psql` installed, this does the same thing:

```bash
psql "$DATABASE_URL" -f schema.sql
```

**c. Check it worked.** Still in the SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' ORDER BY table_name;
```

You want six tables — `app_settings`, `inventory_transactions`, `product_images`,
`products`, `sale_items`, `sales` — plus the `product_stock` view.

**d. Copy the connection string.** Click **Connect** on the project dashboard
and copy the string labelled **Pooled connection**. It looks like:

```
postgresql://USER:PASSWORD@ep-something-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require
```

Take the *pooled* one — the host contains `-pooler`. It is the form meant for
serverless callers like this Worker, which open a new connection per request.

That string contains the database password in plain text. It goes into
`wrangler secret put DATABASE_URL` in step 3 and nowhere else — never into
`wrangler.toml`, the app, or a commit.

**What the free tier gives you.** 0.5 GB of storage, which is far more than this
app will use — the rows are small and the photos live in S3, not Postgres. The
database also suspends itself after a few minutes of inactivity and wakes on the
next query; the first sync after a quiet spell may take an extra moment, and
that is normal rather than a fault. Check Neon's pricing page for current limits,
as free-tier details change.

### 2. Bucket (Cloudflare R2)

R2 is Cloudflare's object storage. It speaks the S3 API, so the Worker code is
the same either way — but it is on the account you are already using for the
Worker, gives **10 GB free with no time limit**, and charges nothing for egress.
AWS S3's free tier lasts only the first 12 months of a new account, and then
every photo a device downloads is billable.

If you would rather use S3, skip to [Using AWS S3 instead](#using-aws-s3-instead).

**a. Create the bucket.** Cloudflare dashboard → **R2** → *Create bucket*.
Name it `inventory-images` and pick the location hint closest to your shop
(*Asia-Pacific* for India). You may be asked for a card to activate R2 even on
the free tier; nothing is charged below the free allowance.

Leave public access **disabled**. The app reaches every object through a
presigned URL, so the bucket never needs to be readable by the world.

**b. Note your account id.** It is in the dashboard URL
(`dash.cloudflare.com/<account-id>/...`), and the R2 page shows the S3 endpoint
directly: `https://<account-id>.r2.cloudflarestorage.com`.

**c. Create an API token.** R2 → **Manage R2 API Tokens** → *Create API token*:

| Field | What to choose |
|---|---|
| Permissions | **Object Read & Write** |
| Specify bucket | apply to **`inventory-images` only**, not all buckets |
| TTL | forever, unless you want to rotate it on a schedule |

Take *Object Read & Write* rather than Admin: it cannot create or delete
buckets, so a leaked token cannot destroy your storage.

You get an **Access Key ID** and a **Secret Access Key**. The secret is shown
once — copy both now. They go into `wrangler secret put` in step 3 as
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (the names are S3's, and R2
reuses them).

**d. Fill in `wrangler.toml`:**

```toml
[vars]
S3_ENDPOINT = "https://your-account-id.r2.cloudflarestorage.com"
S3_BUCKET   = "inventory-images"
AWS_REGION  = "auto"
```

`AWS_REGION` really is the literal string `auto` for R2 — not a real region.
It is what R2 expects in the signature scope, and a real region name there makes
every transfer fail with `SignatureDoesNotMatch`.

**e. You do not need CORS.** Most object-storage upload guides tell you to
configure it. Those are written for browsers, which send a preflight request;
React Native is not a browser and does not. Setting it is harmless but pointless.

#### Using AWS S3 instead

The Worker supports S3 unchanged — set `S3_ENDPOINT = ""` and put the bucket's
real region in `AWS_REGION`.

Create the bucket with **Block Public Access left fully on**, a name in
lowercase with hyphens and **no dots** (the Worker addresses S3 buckets as
`bucket.s3.region.amazonaws.com`, and the wildcard certificate covers only one
label — a dotted name fails with an unrelated-looking TLS error), and a region
close to your shop.

Then create an IAM policy granting the least that works:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::YOUR-BUCKET/product-images/*"
  }]
}
```

No `ListBucket`, so the credentials cannot enumerate your storage; no
`DeleteObject`, so they cannot destroy it; and the prefix confines them to one
folder. Attach it to a new IAM user (never your root account), then create an
access key under *Application running outside AWS*.

Whichever you choose, `AWS_REGION` must match how the service expects to be
signed — `auto` for R2, the bucket's real region for S3. It is baked into every
signature, so a mismatch fails each transfer with `SignatureDoesNotMatch`, an
error that points at your credentials rather than the real cause.

### 3. Worker (Cloudflare)

**a. Edit `wrangler.toml`.** Non-secret, and committed — you did this in step 2d:

```toml
[vars]
S3_ENDPOINT = "https://your-account-id.r2.cloudflarestorage.com"
S3_BUCKET   = "inventory-images"
AWS_REGION  = "auto"
```

**b. Invent an API key.** This is what the app uses to authenticate to the
Worker. Generate one and keep it — you need the same string again in step 4:

```bash
openssl rand -base64 32
```

**c. Log in and set the secrets.** Each `secret put` prompts for the value;
paste it and press enter. Unlike `[vars]`, secrets are stored by Cloudflare and
never written to a file, so nothing here reaches the repository:

```bash
npm install
npx wrangler login
npx wrangler secret put DATABASE_URL            # the pooled Neon string, step 1d
npx wrangler secret put SYNC_API_KEY            # the key from 3b
npx wrangler secret put AWS_ACCESS_KEY_ID       # R2 (or S3) access key, step 2c
npx wrangler secret put AWS_SECRET_ACCESS_KEY   # R2 (or S3) secret, step 2c
```

**d. Deploy.**

```bash
npx wrangler deploy
```

It prints the URL it deployed to, something like
`https://inventory-sync.your-subdomain.workers.dev`. Note it down — step 4 needs
it. Check it is alive:

```bash
curl https://inventory-sync.your-subdomain.workers.dev/v1/health
```

That should return `{"ok":true}`. It is the one endpoint that needs no key, so
it tells you the Worker is running without proving anything about the database.

### 4. Point the app at it

In the app's `src/constants/config.ts`, fill in the `SYNC` block:

```ts
export const SYNC = {
  baseUrl: 'https://inventory-sync.your-subdomain.workers.dev',  // no trailing slash
  apiKey: 'the same key you generated in step 3b',
  ...
```

Then rebuild the app (`npm run android`). Sync is inert until both are set — up
to that point the app runs exactly as it did before, fully offline.

Install the same build on every device that should share the inventory. Each one
mints its own device id on first run, so sale numbers stay distinct without any
further setup.

### 5. Verify

```bash
SYNC_URL=https://inventory-sync.<subdomain>.workers.dev SYNC_API_KEY=... node verify.mjs
```

This exercises authentication, push, pull, the append-only and last-write-wins
merge rules, presigning and path validation against the real database. Run it
after deploying and after any change to `schema.sql` or `src/sync.ts` — the
app's Jest suite covers the client merge rules but cannot execute this SQL.

## Endpoints

All except `/v1/health` require `Authorization: Bearer <SYNC_API_KEY>`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/health` | Liveness. No auth. |
| `POST` | `/v1/sync/push` | `{deviceId, changes[]}` → `{accepted[], rejected[]}` |
| `GET` | `/v1/sync/pull?cursor=&limit=` | `{changes[], cursor, hasMore}` |
| `POST` | `/v1/images/upload-url` | `{path}` → `{url}`, a 15-minute presigned PUT |
| `POST` | `/v1/images/download-url` | `{path}` → `{url}`, a 15-minute presigned GET |

Only rows listed in `accepted` are cleared from the device's outbox, so a
rejected row is retried on the next sync rather than lost.

## How merging works

Stock is never sent as a number. It is the sum of an append-only ledger
(`inventory_transactions`), which is what makes two offline tills safe: merging
their ledgers is a set union, so no movement can be lost or double-counted. A
`current_quantity` column synced as a value would silently discard one of two
concurrent sales.

| Table | Rule |
|---|---|
| `inventory_transactions`, `sales`, `sale_items` | Append-only. Recorded once, never rewritten — they are facts about things that already happened. |
| `products`, `product_images`, `app_settings` | Last-write-wins on a timestamp. Two people renaming one product is a genuine conflict with no correct answer; the later edit wins. |
| `products.current_quantity`, `products.status` | Not stored. Derived from the ledger — see the `product_stock` view. |

Deletes are soft. A hard delete is invisible to a device that was offline when
it happened, which would simply re-upload its own copy and resurrect the row.

## Security notes

- The `SYNC_API_KEY` is embedded in the app and **is extractable from a release
  APK**. It is revocable and scoped to these endpoints, which a database
  password would not be — but this design assumes the APK is not distributed
  publicly. Adding real per-user accounts is the fix; see the app's
  `KNOWN_LIMITATIONS.md`.
- Table and column names in the generated SQL come only from the whitelist in
  `src/tables.ts`, never from request data. Values are always bound parameters.
- Image keys are validated against a strict pattern before presigning, so a
  crafted path cannot reach outside `product-images/`.
- The Worker returns a generic message on internal errors; details go to the
  Cloudflare log rather than to the client, which would otherwise leak table
  and connection detail.
