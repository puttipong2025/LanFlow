# Retain rubber-bill evidence review period boundaries

Each branch stores minimal review-period boundaries with open and close times and actors. A bill is permanently marked in review scope when its `TimestampBill` falls inside one of those periods, including an offline bill that reaches the server after that period has closed. This avoids trusting stale Android switch state and preserves the intended client-time rule without retaining image or review-result history.

A late offline bill or a new revision of an already scoped bill may become `รอตรวจ` while intake is closed. It remains reviewable, and the branch cannot open a new intake period until that prior work is resolved. Closing and reopening remain server-authoritative operations.
