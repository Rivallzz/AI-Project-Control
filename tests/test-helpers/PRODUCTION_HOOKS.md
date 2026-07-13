# Production hooks required for focused tests

The API contracts below are exercised through a spawned server. The remaining
contracts need small pure exports; tests must not recover them by matching or
rewriting production source text.

## Server lifecycle

Export a server factory such as `createServer(options)` from `server.js` (or a
small owned module). It should accept `{ host, port, paths, jobStore }`, avoid
listening during import, and report `server.address().port` after `listen(0)`.
This removes the small reserve-and-release race in the test harness.

## Job store and recovery

`recoverJobs(records, now)` is exported and covered. Export pure or
dependency-injected `snapshotJob` and `serializeSseEvent`. A test-only job-store
injection point is still needed to cover every kind without starting providers
or installers: `task`, `install`, `update`, `provision`, and
`dashboard-command`.

## UI request races and job visibility

`public/modules/request-state.js#createRequestState` is now covered directly.
Export the remaining pure visibility predicate from
`public/modules/project-ui-state.js`:

- `jobBelongsInConversation(job, activeProjectId)`: returns true for every
  supported job kind owned by the active project, not only `task`.

`ui-behavior-*.test.js` defines the executable contract for these exports and
is skipped with a named reason until the module exists.

## Remote branch deletion

Local integration must never implicitly delete a remote branch. Add a separate
confirmed API action and export its pure authorization check, for example
`authorizeRemoteBranchDelete({ branch, expectedOid, currentOid, integrated })`.
It must reject non-`ai/*` branches, non-integrated branches, missing expected
OIDs, and any remote OID change. The command layer should use an exact lease.
The current behavioral Git test already proves that integration preserves the
remote branch using a local bare remote; the export is needed for exhaustive
rejection cases without invoking a remote command.
