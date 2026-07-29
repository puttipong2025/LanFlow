# Make branch provisioning idempotent

LanFlow treats retries of the same add-branch request as the same provisioning operation: once committed, a repeated request returns the original branch as a success instead of creating another branch or surfacing a uniqueness error. The client retains a request identifier until it receives a definitive result, and the atomic database operation verifies that a retry matches the original name, code, and creator. This requires an explicit replay contract but makes double-clicks and lost HTTP responses safe.
