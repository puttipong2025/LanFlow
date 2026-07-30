# Snapshot report opening balances

Report batches snapshot the previous active report ID and its closing balance when a new report is created, then render that amount as the first `ยอดยกมา` ledger row. This deliberately snapshots only the cross-report balance while source details remain live: calculating the carry dynamically would let later report-history changes alter an already-issued report, while copying every ledger row would duplicate the existing report-item source-of-truth model.
