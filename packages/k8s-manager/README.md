# Workspace lifecycle

The API gateway creates the workspace row as `queued` and submits its ID and
owner to BullMQ. The manager updates that row; it never inserts another workspace.

- `queued`: provisioning is pending, the pod is not ready, or another attempt is scheduled.
- `running`: Kubernetes reports phase `Running` and condition `Ready=True` with no deletion timestamp.
- `deleted`: the pod has been confirmed absent. The existing three database states are retained.

Provisioning checks ownership, reuses a matching pod on a 409 retry, waits for
readiness, and conditionally updates only active rows. A late completion cannot
revive a deleted workspace. The terminal has an exec readiness probe checking that
`/workspace` exists and is writable. Readiness waits are bounded to 60 seconds,
with one-second polling and a ten-second cap on individual Kubernetes requests.
The existing pod lifetime is 30 seconds; the readiness timeout does not extend it.

Failed provisioning is returned to the job processor as an error so BullMQ retries
instead of falsely completing the job. New jobs use three attempts with exponential
backoff starting at one second. After the final failed attempt, the row becomes
`deleted` only if the manager confirms that no pod remains.

Every ten seconds, cleanup lists managed pods in the configured namespace. Terminal
or terminating pods are deleted with a UID precondition, then polled for up to
30 seconds until Kubernetes returns 404. Only then is their matching row marked
`deleted`. A failed deletion or an API outage never marks a live pod deleted.
Running rows whose pods are missing from the list are checked individually before
being marked deleted. This repairs manual deletions and database failures that
occurred after pod removal. Each cleanup is idempotent and independent failures
are logged without blocking other pods.

Database and queue operations are still separate systems; this change does not
introduce a transactional outbox or a durable lifecycle event log. Reconciliation
uses polling, so status is eventually consistent. Exhausted job errors remain in
BullMQ; a distinct `failed` application status would require a schema change.

Run `bun test packages/k8s-manager/tests` from the repository root. Tests mock the
Kubernetes API and database operations; they do not create pods or mutate a database.
