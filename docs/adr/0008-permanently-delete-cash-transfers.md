# Permanently delete cash transfers

Cash transfers between branches may be deleted only by a `super_admin`, regardless of status. Deletion is permanent and does not require a reason; `user` and `admin` cannot delete these transfers. This deliberately favors a simple privileged cleanup operation over recoverability and a retained deletion audit trail.
