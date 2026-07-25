# Keep the daily weighing queue on one designated branch device

LanFlow keeps each branch's daily weighing queue in browser storage on one designated device, partitioned by device, branch, and Bangkok date. The queue does not use the database, API, or offline sync queue because the operating rule permits only one queue device per branch and prioritizes simple offline operation over cross-device availability.

The trade-off is deliberate: clearing site data, changing browser profile, uninstalling the PWA, or losing the device also loses the current queue and customer-name snapshot. Moving to a shared multi-device queue later would require a server-owned ordering and concurrency contract rather than reusing this local state.
