# Unify rubber-bill work filters and badge counts

> The placement of evidence-review filters and pending-evidence badge counts is superseded by ADR-0040. The zero-price definition and existing approval permissions below remain valid for the Rubber Bill module.

The historical design placed evidence filters and a modal in the Rubber Bill list. ADR-0040 supersedes that placement: Rubber Bills now retains only evidence status and a deep link, while the separate review workspace owns evidence filters and decisions. Every user who can access the branch can see evidence state and the separate pending-evidence badge; only system managers and super admins can change review state or decisions.

`ยังไม่กำหนดราคา` preserves the existing rule of any weigh row with price less than or equal to zero. It does not use bill net payable zero because valid branch-receipt bills intentionally pay zero. The Rubber Bill badge counts this queue without pending evidence; pending evidence is counted distinctly under `rubber-evidence`. A bill may count once in each queue but never twice within the same queue. Existing permission rules for other approval work remain unchanged.
