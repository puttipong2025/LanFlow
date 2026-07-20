# ADR-0004: Android Printing Uses LanFlow Kotlin Connector Over Bluetooth Classic SPP

- Status: Superseded
- Date: 2026-07-15
- Owners: LanFlow team
- Decision scope: Rubber Bill printing on Chrome Android through Xprinter XP-N160II
- Superseded by: ADR-0005 on 2026-07-16 after the product owner rejected the Connector/Web Share architecture

## Context

LanFlow needs offline Rubber Bill printing from Chrome Android to a Bluetooth thermal printer. The required runtime is:

- Google Chrome on Android
- HTTPS production deployment
- first-party LanFlow Print Connector installed on the same Android device

The selected XP-N160II uses Bluetooth Classic RFCOMM/SPP. Chrome Android cannot open this transport with Web Bluetooth, so the web application hands an offline print job to a first-party Kotlin Connector and the Connector owns the SPP connection.

The physical printer is an Xprinter XP-N160II. On Android it must first be paired in system Bluetooth settings with PIN `0000`, after which RawBT can print to it. This field behavior is sufficient project evidence to classify the installed unit as Bluetooth Classic SPP, not BLE/GATT. The product owner does not want RawBT as a production bridge.

The printer is paired in Android system settings. Connector reads the bonded-device list with Android permission and remembers the selected device locally.

### Hardware target: Xprinter XP-N160II

The selected target is **Xprinter XP-N160II**. Xprinter's official product page confirms:

- 80mm paper (`79.5 ± 0.5mm`) with a 72mm printable width
- optional interface variants including `USB + Bluetooth`
- 96KB input buffer and 256KB NV flash
- configurable line spacing and 42/48 Font A columns on 80mm paper

The official page does **not** identify the Bluetooth option as BLE/GATT, publish a GATT service/characteristic UUID, or list Thai/CP874 in the extended character tables. Therefore:

- the model name alone is not evidence that Web Bluetooth will work;
- the purchased unit is treated as the `USB + Bluetooth` variant;
- Bluetooth Classic SPP is the locked transport classification for this installed unit;
- Web Bluetooth is not a compatible transport for this unit;
- native printer fonts/code pages are not used for receipt body text;
- all receipt text is rendered by LanFlow as one-bit monochrome raster output, so Thai support does not depend on printer CP874 firmware.

Source: https://www.xprinter.net/product/508.html

## Decision

### 1. Use one Android transport path

There is no pure-web Android transport implementation for the selected printer. The product accepts a first-party Android connector, while rejecting RawBT as a production dependency. A JavaScript library cannot add Bluetooth Classic SPP access to Chrome Android.

Next.js constructs and shares `PrintJobV1`; it never opens Bluetooth. Kotlin Connector owns one small SPP transport that connects, writes serialized chunks, and disconnects.

The connector is deliberately narrow: receive a LanFlow print job from an explicit user action, manage the selected/paird XP-N160II connection, write the job to SPP serially, report an honest result when possible, and expose test-print/configuration diagnostics. It is not a second business application and does not own Rubber Bill records.

Android printing must work while LanFlow is offline. Chrome therefore hands the connector a self-contained, versioned receipt snapshot; the connector must not fetch the bill or require an API call before printing.

The selected handoff is a small JSON file created in memory and shared from the user's Print action with the Web Share API. Android shows its Sharesheet and the user selects LanFlow Print Connector once per print. The connector registers an Android `ACTION_SEND` handler for the physically verified JSON/text MIME type. The web app must feature-detect the exact file with `navigator.canShare({ files })`. A package-targeted deep link carrying the receipt in its URL is not the default because receipt data could leak through URLs and practical URL/payload limits are less robust.

The v1 print-job contract contains only the receipt snapshot and transport-neutral metadata:

- schema version and unique client-generated job ID
- bill identity and immutable display timestamp
- customer display fields and FSC/EUDR flag required by the receipt
- item rows and the stored bill aggregates used as financial authority
- receipt/layout options that affect rendering
- payload checksum for corruption detection

It contains no Supabase session, API credential, or raw executable HTML. The connector validates schema, maximum size, required fields, numeric bounds, and checksum before rendering.

### 2.1 Split implementation between Next.js and a Kotlin Android connector

The existing Next.js/TypeScript application is the sender. It owns Rubber Bill selection, receipt snapshot construction, `PrintJobV1` validation, checksum generation, `File` creation, capability detection, and the user-initiated Web Share call.

The Android receiver is a small native Kotlin application. It owns the `ACTION_SEND` entry point, safe JSON stream parsing, connector-local printer settings, Android Bluetooth permissions, bonded-device selection, RFCOMM/SPP connection, receipt rendering/encoding, serialized writes, and local diagnostics.

Kotlin Native is selected because the connector is Android-only and its core work is native Android intent, Bluetooth Classic, permission, lifecycle, and stream handling. React Native is out of scope: it would add a JavaScript runtime and still require a native Bluetooth/intent module or a third-party module for the critical path.

Keep the language boundary explicit rather than sharing application runtime code. A checked-in `PrintJobV1` JSON Schema plus valid/invalid fixture files is the contract authority used by TypeScript and Kotlin tests.

Receipt rendering produces bytes and does not know which transport sends them.

### 2. Render all receipt text as monochrome raster

The sender continues to hand the connector structured `PrintJobV1` JSON, not an image. Kotlin Connector lays out every Thai/English/numeric glyph with a bundled font, converts the completed receipt into one-bit black/white raster bands, and wraps the bands with the minimal ESC/POS raster/feed/cut commands proven on the XP-N160II.

Rasterize in bounded vertical bands rather than allocating an unbounded full-length bitmap. Serialize and chunk the resulting bytes because the XP-N160II publishes a 96KB input buffer. Text antialiasing may be used during layout, but the final printer payload is one-bit black or white with a fixed threshold; grayscale and dithering are out of scope.

"No images" means no customer photos, attached bill photos, or logos. It does not prohibit the internal monochrome raster representation of text required for consistent Thai output.

### 3. Add a device-local printer configuration page

The page must be available to roles that can print Rubber Bills. It is device configuration, not a global business setting.

Required fields and actions:

- Android action to install/open/configure LanFlow Print Connector
- selected bonded printer name/address
- printer command language: start with `ESC/POS`; keep `StarPRNT` out of scope until required by hardware
- paper width: 80mm/78mm receipt layout
- bundled font, font sizes, line spacing, and raster threshold
- printable width/dots and margins
- chunk size and inter-chunk delay
- feed and cut behavior
- connection state, last error, disconnect/forget, and test-print actions

Store non-secret preferences locally in Connector DataStore. Do not put printer connection state in the offline business sync queue. Android owns the Bluetooth bond and Connector uses its granted permission.

For Android, use Preferences DataStore inside LanFlow Print Connector to remember the selected bonded printer. Persist only device-local configuration:

- Bluetooth address and last display name
- SPP UUID/connection option proven by the physical pilot
- paper width/dots, bundled font/layout preset, and raster threshold
- feed/cut behavior, chunk size, and inter-chunk delay
- last successful connection timestamp for diagnostics

On each print job, resolve the saved address against Android's bonded-device list and verify that it is still bonded before opening RFCOMM. Reconnect automatically without discovery or printer selection. If permission is missing, Bluetooth is disabled, the bond was removed, or the device changed, stop and open connector configuration instead of silently selecting another printer.

Do not store the pairing PIN, receipt/customer content, Supabase credentials, or a permanent socket. Android owns the Bluetooth bond; the connector owns only its selected-device preference. On Android 12 and later, bonded-device access and connection require runtime `BLUETOOTH_CONNECT` permission.

### 4. Reject unsupported Android states clearly

The config page must show a clear message when Web Share file handoff is unavailable or LanFlow Print Connector is not installed. Connector must show a clear message when Bluetooth permission is denied, Bluetooth is disabled, the saved printer is no longer bonded, or RFCOMM connection fails.

### 5. Printing uses a queued byte writer

RFCOMM writes must be serialized. Connector splits raster bytes into configured chunks and waits between writes when required by the printer. Parallel writes are forbidden.

The first release sends monochrome raster bands generated from structured receipt text. External images, photos, and logos remain out of scope.

### 6. Keep print outcome local and ephemeral

Connector shows success, failure, or cancellation only in its current foreground UI. LanFlow v1 does not persist print status in the web app or database.

There is therefore:

- no `print_status` mutation;
- no print-result outbox;
- no result nonce or result callback payload;
- no API/RPC dedicated to recording print completion.

After all bytes are written without a reported transport error, Connector automatically opens a fixed, allowlisted LanFlow HTTPS return route. It also shows a `กลับ LanFlow` button if automatic navigation fails. On failure, Connector stays in the foreground and offers Retry or Return; it does not send business state back to LanFlow.

## Security And Privacy

- Require HTTPS except localhost development.
- Start Web Share only from the user's Print action.
- Request only the Android Bluetooth permissions required for bonded-device access and connection.
- Never store customer, receipt, or authentication data in printer preferences.
- Validate shared JSON; never render raw executable HTML in Connector.
- Keep a restrictive CSP because XSS could create an unauthorized print payload.

## Consequences

### Positive

- Android has one explicit print path with no transport branching in the web UI.
- Receipt formatting is testable independently from hardware transport.
- Printer-specific SPP and chunking settings stay inside Connector.

### Negative

- Android cannot support arbitrary Bluetooth Classic SPP printers with pure Web APIs.
- Hardware testing is mandatory; "ESC/POS Bluetooth" on a product page is not enough evidence.
- Pairing and reconnect behavior depends on Android permission and bond state and cannot be completely silent.
- Raster output is larger and may print more slowly than native printer text, so longest-bill buffer/chunk testing is mandatory.

## Alternatives Considered

### Use only Web Bluetooth

Rejected as a general promise. Web Bluetooth communicates with BLE/GATT, not Bluetooth Classic RFCOMM/SPP printers.

### Use one third-party Bluetooth printer library for everything

Rejected. A library can reduce boilerplate but cannot bypass browser/platform transport limitations. It also cannot know the target printer's proprietary UUIDs or buffer limits without hardware evidence.

### Use native printer text/code pages

Rejected for receipt body text. The XP-N160II published code-page list does not include Thai/CP874, and native text would make layout depend on printer firmware. LanFlow renders all text itself and keeps only a small application-owned ESC/POS raster/feed/cut wrapper.

### Require a native Android bridge or print-service app

Accepted as a first-party component. LanFlow will provide a narrowly scoped Android Print Connector because the selected printer is Bluetooth Classic-only. The browser remains the business UI; the connector owns only device configuration and print transport.

### Require RawBT on Android

Rejected by the product owner. RawBT proves that the paired XP-N160II can print over Classic SPP, but it will not be a LanFlow production dependency.

### Implement the connector with React Native

Rejected. The connector is Android-only and its critical path is native Android API work. Kotlin Native keeps the transport boundary smaller and avoids a JavaScript runtime plus Bluetooth/intent bridge dependency.

### Implement LanFlow Connector as an Android PrintService in v1

Deferred. Android Print Spooler integration is possible through a `PrintService`, which discovers printers and owns system `PrintJob` lifecycle, but it changes the selected JSON snapshot/Web Share flow into the Android printing framework and normally processes a spooled document. That adds printer discovery, service lifecycle, PDF/raster handling, and a second status model. The v1 connector instead remembers the bonded XP-N160II in DataStore and sends the validated LanFlow job directly over SPP.

## Verification Gates

1. Record exact printer manufacturer/model and its Bluetooth mode from the manual.
2. Confirm the XP-N160II SPP UUID/connection option with the physical printer.
3. Print mixed Thai/English/numeric monochrome raster lines through LanFlow Print Connector on Android.
4. Print a full 78mm Rubber Bill with long Thai names and multiple item rows.
5. Verify chunking with the longest supported receipt and repeated prints.
6. Test disconnect, reconnect, paper-out, canceled chooser, denied permission, and mid-write failure.

## Locked Grill Decisions

1. The product must have a device-local printer configuration page.
2. Chrome Android is the only v1 browser target; Windows is out of scope.
3. Direct printing sends ESC/POS-style monochrome raster bytes; external images/photos/logos remain out of the first release.
4. Transport and receipt encoding remain separate.
5. The web UI exposes one Android Connector route and does not offer BLE, Web Serial, or browser-print alternatives.
6. Android production devices may install the first-party LanFlow Print Connector.
7. RawBT is not a production dependency.
8. Android printing must work offline.
9. The Android handoff carries a self-contained versioned receipt snapshot and does not fetch the bill from an API.
10. The existing Next.js application is the print-job sender; the Android companion is the receiver and SPP transport owner.
11. The Android connector is implemented with Kotlin Native; React Native is out of scope.
12. Connector v1 remembers the selected bonded printer in local Preferences DataStore; Android Print Spooler/`PrintService` integration is out of scope.
13. Android v1 uses Web Share file handoff and one Sharesheet selection of LanFlow Print Connector per print.
14. All receipt text is rendered as one-bit black/white raster output; native printer fonts/code pages are not used for the receipt body.
15. LanFlow v1 does not persist or synchronize print status and has no print-result outbox/API/RPC.
16. Connector automatically opens a fixed LanFlow return route after a successful write and exposes a manual `กลับ LanFlow` fallback.
17. Windows, Web Serial, and browser/OS print dialog support are out of v1 scope.

## Grill Progress

- 2026-07-15: Hardware candidate identified as Xprinter XP-N160II.
- 2026-07-15: Android pairing with PIN `0000` and successful RawBT printing recorded as field evidence of Bluetooth Classic SPP.
- 2026-07-15: RawBT rejected as a production dependency.
- 2026-07-15: First-party LanFlow Print Connector accepted for Android production devices.
- 2026-07-15: Offline Android printing required; self-contained receipt snapshot selected over an online job-ID fetch.
- 2026-07-15: Next.js sender plus Android connector receiver implementation split selected; native Kotlin recommended for the connector.
- 2026-07-15: Kotlin Native locked for the Android connector; React Native removed from scope.
- 2026-07-15: Connector-local saved printer recommended over Android Print Spooler for v1.
- 2026-07-15: Preferences DataStore locked for the selected bonded printer; Android Print Spooler/`PrintService` removed from v1 scope.
- 2026-07-15: One Android Sharesheet selection of LanFlow Print Connector per print accepted for the offline file handoff.
- 2026-07-15: All receipt text locked to one-bit black/white raster rendering; native printer text/code pages removed from receipt-body output.
- 2026-07-15: Persisted print status, result outbox, callback nonce, and status API/RPC removed for simplicity.
- 2026-07-15: Automatic return to a fixed LanFlow route after success accepted, with a manual Return button fallback.
- 2026-07-15: Windows, Web Serial, and browser/OS print fallback removed; v1 is Android-only.

## References

- Chrome for Developers: https://developer.chrome.com/docs/capabilities/bluetooth
- Web Share API: https://web.dev/articles/web-share
- Android sharing: https://developer.android.com/training/sharing/send
- Android paired devices: https://developer.android.com/develop/connectivity/bluetooth/find-bluetooth-devices
- Android DataStore: https://developer.android.com/jetpack/androidx/releases/datastore
- Android PrintService: https://developer.android.com/reference/android/printservice/PrintService
