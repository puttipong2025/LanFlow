# Backfill only active report balance chains

When restoring Rubber Export expenses to the canonical report period ledger, LanFlow will recalculate stored opening and closing balances chronologically only for each branch's active report chain under the branch advisory lock. Deleted reports retain their stored header snapshots as audit evidence, while their Detail and PDF views use the corrected ledger helper and therefore include referenced `REX` expenses; this corrects operational balances without rewriting deleted history.
