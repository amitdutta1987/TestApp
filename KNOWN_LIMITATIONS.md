# Known limitations

Written down rather than papered over. Nothing in this app fakes a success it
did not achieve — where something cannot work, it says so and offers the next
option.

## Reading a barcode from a photograph

The app tries four strategies before giving up (original, enlarged, a 3×3
overlapping tile grid, rotated 90°). The barcode does not need to be centred, and
one covering 5–10% of the frame is normally recovered by the tiling pass.

These cases genuinely cannot be decoded, and no amount of rescaling changes that:

- **Motion blur or smeared bars.** The bar edges no longer exist in the pixel
  data; enlarging blur produces larger blur.
- **A barcode smaller than roughly 2% of the frame.** Below that there are fewer
  pixels than the narrowest bar needs, so there is nothing to resolve.
- **Severe perspective skew.** A label photographed at a sharp angle compresses
  the bars unevenly; 1D decoding assumes a roughly linear scan line.
- **Glare or heavy shadow across the bars.** Decoding depends on black/white
  contrast, and a blown-out or crushed region carries none.

When all four strategies fail the app offers an interactive crop tool — you point
at the barcode yourself — and then manual entry. It never invents a value.

**Recommendation for the user:** live camera scanning is more reliable than
photographing a label, because the camera can refocus and retry continuously.
Reading from a photo exists for products you cannot bring to the counter.

## Verification not possible without a device

The following are implemented but cannot be exercised by the automated suite,
because they are native modules with no JavaScript implementation off-device.
They are noted here rather than covered by a test that would pass vacuously.

| Area | What is untested | What *is* tested |
|---|---|---|
| ZIP compression (`react-native-zip-archive`) | the actual DEFLATE step | the archive is packed and unpacked as one self-contained file; contents, layout and metadata are asserted, and the packed `inventory.db` is reopened and queried |
| `restoreBackup()` end to end | the final `initDatabase()` reopen, which constructs the op-sqlite driver | validation, refusal of a bad archive, and that a failed restore leaves live data untouched |
| Live camera scanning | VisionCamera frame processing | barcode parsing, normalisation, check digits and format mapping |
| ML Kit still-image detection | the detector itself | the strategy ladder's ordering and fallbacks |
| Image resize/crop/compression | the native codecs | path handling and storage layout |
| Cloud sync on a device | the real HTTP client, and S3 upload/download | the full push/pull/acknowledge loop, two-device convergence, and that a failed push keeps its work queued — against a stand-in server |

The Android build itself (`assembleDebug` / `assembleRelease`) has not been run
in this workspace — there is no JDK or Android SDK installed here. It needs to be
run on a machine set up per the README before the app can be considered
verified end to end.

## Multi-device sync

### Overselling across offline devices cannot be prevented

If two devices are both offline and each sells the last unit, both sales are
legitimate records of something that happened. Merging them produces a ledger
that sums below zero, and no reconciliation invents the missing stock.

The app does not hide this. `current_quantity` is clamped at zero so the
database stays valid, and Settings shows a "stock needs checking" warning naming
the product and the shortfall so it can be counted and corrected. What it will
never do is discard one of the two sales to make the arithmetic look tidy.

Keeping devices online shrinks the window to the sync interval but cannot close
it. Only server-authoritative stock — every sale blocked on a network
round-trip — would, and that trades the app's whole reason for existing.

### Last-write-wins can lose one of two simultaneous edits

Two people editing the same product's name or price at the same time is a real
conflict with no correct answer. The later edit wins and the earlier is gone.
The comparison uses `metadata_updated_at`, which only genuine edits move, so a
busy till cannot out-rank an edit made earlier elsewhere — but two concurrent
*edits* still resolve by timestamp. Stock is not affected: it is a ledger.

### The same barcode on two devices needs manual cleanup

Two counters can each add the same physical item while offline, and both rows
are genuine. The app keeps both — nothing is discarded — but only one can hold
the barcode, so the other's is suffixed (`123456-DUP-a3f9`) and Settings reports
it for you to merge the two products by hand.

The winner is chosen from the row contents alone (earliest `created_at`, ties
broken by id), so every device reaches the same answer without coordinating.
What the app cannot do is merge them for you: which name, price and supplier to
keep is a judgement about the shop, not about the data.

### The API key is extractable from the APK

There are no user accounts, so the app authenticates to the sync server with a
single key compiled into it. An APK is a zip file and anyone who downloads it
can read that key, which grants full access to the shop's synced data.

It is revocable and reaches only the sync endpoints — unlike a database URL or
AWS credentials, which is why neither of those is in the app. But **this build
is not suitable for public distribution.** Fixing it properly means per-user
accounts and row-level authorisation on the server.

### Server SQL is not covered by the Jest suite

The client merge rules are tested against real SQLite, including two-device
convergence, oversell detection, idempotent replay and last-write-wins. The
server's push and pull SQL only runs on Postgres, which the app's test suite has
no access to.

`server/verify.mjs` covers it against a live deployment — authentication, push,
pull, the append-only and last-write-wins rules, cursor advancement, presigning,
image-path validation, an object-storage round trip and tombstoned deletes.
**Run it after deploying and after any change to `schema.sql` or `src/sync.ts`.**
It has been run successfully against a Neon + R2 deployment, so the SQL is known
to work; it is just not something `npm test` can reach.

### "Clear all data" clears one device, not the shop

With sync on, a local wipe would otherwise be pushed as a delete of every row
and empty every other device — unrecoverable, from a button whose dialog
promises to clear "this device". So the wipe is local: the change-tracking
triggers are suppressed, the outbox is dropped, and the cursor is rewound, which
means the data downloads again on the next sync.

There is deliberately no in-app way to erase the shop's data everywhere. Do that
against the database directly, on purpose.

### Not yet done

- **Deleted photos are not removed from S3.** The row goes; the object stays and
  costs storage. Deleting safely needs to account for other devices still
  holding the reference.
- **No conflict UI.** A last-write-wins overwrite happens silently; only stock
  discrepancies are surfaced.
- **Sync is time-based, not push-based.** Another device's change takes up to a
  minute to appear. Real-time would need a socket the Worker does not open.

## Product scope, version 1

Deliberately out of scope, not unfinished:

- **No accounts.** Every device with the app and its key sees the same single
  shop's data; there is no login and no per-user separation.
- **Restore replaces, it does not merge.** Restore validates the archive,
  snapshots current data, then replaces wholesale. It does re-establish sync
  identity afterwards, so a restored phone gets a fresh device tag and re-uploads
  its rows rather than adopting the source phone's identity.
- **A sale is one product.** The scan-to-sell flow sells the scanned item; there
  is no multi-item basket.
- **No returns UI against a specific receipt.** Returns are recorded as stock
  movements, not linked to the original sale line.
- **`quantity_before` / `quantity_after` are per-device.** They record what the
  originating counter saw at the time and are not rewritten on merge, so the
  running balance in one product's history may jump where two devices' rows
  interleave. The authoritative quantity is the sum of the ledger, not these
  columns.

## Scale

Tested design targets are ~5,000 products, ~50,000 sales and ~100,000 stock
movements, with indexes on the columns those queries filter and sort by, and
pagination everywhere a list can grow. Beyond that the list screens are still
paginated, but the Excel export builds the whole workbook in memory and will
become slow — it is a single-shot operation over the full history by design.
