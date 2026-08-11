---
status: accepted
---

# Offline Rubber Bill Receipts Use a Trusted Local Price-Cap Snapshot

LanFlow will let a branch create, download a PDF receipt for, and use an unsynced small-scale Rubber Bill for payment only when every item price passes the last approval-setting snapshot successfully loaded on that device. The configured price is a maximum: prices from 0 through the maximum do not require approval, any higher item blocks offline saving, and a device with no cached setting cannot create an offline bill. A null configured price disables price approval, while zero requires approval for every positive price.

The server will trust the `configuredPriceSnapshot` carried by the client without a rule revision or central setting-history table. This keeps offline operation simple and preserves the rule used when the branch paid, while deliberately treating authenticated branch users and devices as a trusted environment; a user who intentionally alters IndexedDB or a request payload can bypass this check. Approval requests still retain the configured-price and edit-window snapshots used for retrospective explanation.

An offline receipt is a full financial document labeled “ใบรับซื้อยางออฟไลน์” with a device reference instead of a central bill number. It omits customer address, FSC/EUDR, and the payment-responsible employee, and shows the current revision’s approval result. A zero-price bill may be saved and printed but must say “ยังไม่กำหนดราคา — ห้ามจ่าย”; a pending approval request cannot be printed.

Receipt output is a local 80 mm PDF download to the browser's configured Downloads folder. It does not open a physical-printer dialog and does not record output status or history. Synced receipts are cached as the latest 100 snapshots per branch and a later bill revision overwrites the earlier cached receipt. This supersedes ADR-0005 and the online-only/current-setting portions of ADR-0011.
