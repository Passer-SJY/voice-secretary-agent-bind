<p align="right"><a href="planning.zh_CN.md">简体中文</a> · <strong>English</strong></p>

# Phone planning snapshots and proposals

This is an additive `voice-secretary-planning/v1` interface; existing session bindings,
credentials, Serve endpoints and task dispatch remain unchanged. Upgrade reviewed Skill
sources through the existing owner-managed container service, keeping its persistent state.
Do not register a new binding, reset Tailscale or start a second Bridge for this feature.
App versions before planning support do not share these stores. An old Bridge returns 404;
the App keeps local data and reports that a Bridge upgrade is required.

## Read only the selected phone data

The user enables planning sharing in App Settings, selecting calendars and reminder lists
for one authenticated conversation binding. The App sends a bounded paginated snapshot;
the Bridge publishes it atomically after every page has arrived. No recording audio, voice
embeddings or unrelated stores are included. Reminder mirrors may carry `appTaskID`, `appKind`
and `agentState`; a reminder checkbox is distinct from a business Agent execution result.

In the bound OpenClaw container, use the same `VS_BIND_STATE` as its supervised Bridge:

```bash
node scripts/bridge.mjs planning-read BINDING_UUID 0 100
```

The reply includes `calendarSyncedAt`, `remindersSyncedAt`, `receivedAt`, generation,
selected containers, `total` and `nextOffset`. Continue with that offset to read later pages.
Do not claim this is a live iPhone connection: the phone can be offline or suspended, and
source sync dates may be absent/old. State the snapshot time when responding. Empty scope
means sharing was revoked; never substitute unrelated local calendar data or another binding.
The local CLI requires access to the private state directory; HTTP requires the existing
binding bearer credential and never uses a public Funnel.

## Propose a reviewed mutation

Create a JSON file containing one structured operation. Dates must be ISO 8601 with an
explicit offset; a schedule requires start, end, time zone and a nonempty title. Date-only
reminder due dates omit hour/minute. Reuse a known shared writable container. Edit/complete/
delete requires the EXACT snapshot `itemID` and `expectedRevision`; recurrence is unsupported
here and must be handled explicitly in Apple's app. A unique UUID identifies the operation.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "kind": "reminder",
  "operation": "complete",
  "itemID": "reminder:ITEM_IDENTIFIER_FROM_SNAPSHOT",
  "expectedRevision": "REVISION_FROM_SNAPSHOT",
  "containerID": "SELECTED_LIST_IDENTIFIER",
  "change": { "completed": true }
}
```

```bash
node scripts/bridge.mjs planning-propose BINDING_UUID PROPOSAL.json
```

For new items use `operation: create` without itemID/expectedRevision. Supported kinds are
`schedule` and `reminder`; operations are `create`, `edit`, `complete` (reminders only), and
`delete`. Change fields: title, notes, start, end, allDay, timeZoneID, location, clearLocation,
due, clearDue, completed. `due` contains year/month/day, optional hour/minute/timeZoneID.
An empty notes string clears notes. Never fabricate a revision, container, recurrence scope
or phone permission. Repeating the identical UUID/body returns the same pending/terminal
operation; using that UUID for different content is rejected.

Submission queues a proposal; it does NOT alter the phone or execute an Agent task. The App
retrieves proposals while active, shows the exact before/after and waits for user approval.
The phone checks current permissions, scope and version again. Accepted creates persist an
intent before EventKit and use an operation URL to recover lost receipts without duplication.
Applied/rejected/conflict receipts are durable and can be re-sent after connection loss.
An interrupted applying operation needs phone reconciliation; never submit a different create
UUID simply because the result has not arrived. Re-run planning-propose with the identical
file to inspect its receipt. Do not claim success until the state is `applied`.

## Deployment and acceptance

Upgrade only the generic reviewed Skill package; preserve the existing Docker persistent
volume, binding files, node identity and supervisor. No business run or Feishu message is
needed merely to read/propose planning data. Before deployment, run the Node test suite;
a test/build is not proof the user's remote container is upgraded. After owner-authorized
publication/deployment, verify scoped read, stale-data reporting, proposal review, phone write
and returned receipt on the existing binding. Revocation stops new snapshot sharing after its
empty-scope update reaches the Bridge; data already received in an Agent conversation cannot
be retroactively forgotten by this protocol.

## Project snapshot extension (local candidate)

The additive `voice-secretary-planning/v1` project extension includes explicitly selected
`projectIDs`, a `projects` catalog (stable ID, name, description, revision), and optional
`shareEveryday`/`shareUnclassified` flags. These controls default off; choosing calendar or
reminder containers does not grant access to all projects. Project metadata and selected
App item summaries are disclosed without audio, voice templates or unrelated task evidence.

Items with `kind: app-item` carry `appTaskID`, `appKind`, `appRevision`, `projectPlacement`,
`projectName` and a deterministic revision. They are read-only (`writable: false`): the
Bridge must reject attempts to create/complete/edit them. Use them as planning context;
normal Agent dispatch requires its separate reviewed request. Selected calendar/reminder
items may also carry project placement when that project is explicitly shared. Existing
Calendar/Reminders proposal semantics and phone confirmation remain unchanged.

An older Bridge can still process ordinary calendar/reminder-only snapshots. It may reject
project item snapshots; the App reports incompatibility and keeps local data. Upgrade the
generic candidate through the existing persistent Docker service, without rebinding, only
after publication/deployment authorization. Local package/tests do not prove remote upgrade.
Verify explicit scope, snapshot freshness, read-only project items, proposal receipts,
restart and revocation on the actual phone/container before accepting this extension.
