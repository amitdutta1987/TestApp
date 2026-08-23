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

The Android build itself (`assembleDebug` / `assembleRelease`) has not been run
in this workspace — there is no JDK or Android SDK installed here. It needs to be
run on a machine set up per the README before the app can be considered
verified end to end.

## Product scope, version 1

Deliberately out of scope, not unfinished:

- **No accounts, no cloud, no sync.** Data lives on the phone. The only way it
  leaves is a backup or export you explicitly share.
- **Restore replaces, it does not merge.** Merging two divergent inventories
  needs conflict rules that a single-counter shop does not have. Restore
  validates the archive, snapshots current data, then replaces wholesale.
- **One device.** Sale numbers are per-day counters (`S-YYYYMMDD-NNNN`) with no
  device component, which is correct for one counter and would collide across
  several.
- **A sale is one product.** The scan-to-sell flow sells the scanned item; there
  is no multi-item basket.
- **No returns UI against a specific receipt.** Returns are recorded as stock
  movements, not linked to the original sale line.

## Scale

Tested design targets are ~5,000 products, ~50,000 sales and ~100,000 stock
movements, with indexes on the columns those queries filter and sort by, and
pagination everywhere a list can grow. Beyond that the list screens are still
paginated, but the Excel export builds the whole workbook in memory and will
become slow — it is a single-shot operation over the full history by design.
