<p align="right"><a href="setup.zh_CN.md">简体中文</a> · <strong>English</strong></p>

# Installation and operation

This source package is distributed separately. Supply the actual published
repository and fixed 40-character commit in the app before using the download
prompt. A downloaded checkout must contain this complete skill folder.

## Prerequisites and identity

Use Node.js 22+ and an installed OpenClaw Gateway with an operational Feishu
account. Verify `openclaw agent --help` includes `--session-key`, `--message-file`,
`--deliver`, `--reply-channel`, `--reply-account`, `--reply-to`, `--json` and
`--timeout`. Unsupported versions need a reviewed upgrade. Delivery JSON lacking
`deliveryStatus` remains unknown; exit status alone does not prove a send.

Capture trusted current-message metadata into a private `context.json`:

```json
{
  "accountID": "configured-feishu-account",
  "chatID": "oc_actual_chat",
  "requesterID": "ou_actual_sender",
  "sessionKey": "agent:actual-agent:feishu:direct:ou_actual_sender"
}
```

The example session key is illustrative: copy the actual runtime key. Verify the
key exists with `openclaw sessions --all-agents --json`; list pagination may require
a compatible CLI supporting a larger limit. The service does not guess missing
keys. For isolated DMs, check the owner's session routing; broad shared main DM
routing cannot meet per-conversation context acceptance. Thread/topic sessions
are deferred. Normal group replies are sent to the chat and are visible to members;
requester ID records who initiated the binding, not a private delivery override.

## Tailscale and service

Check `tailscale status` and `tailscale serve status` first. The iPhone must have
Tailscale installed, signed in, connected, and authorized to reach this host.
Use an unused Serve HTTPS listener; do not reset an existing Serve configuration.
For an unused port 8443, a suitable command is:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8765
```

Copy the actual advertised hostname, giving an app endpoint such as
`https://host.tailnet.ts.net:8443/v1`. MagicDNS/HTTPS and tailnet ACLs must permit
access. This does not enable public Funnel. Tailscale is installed from its
[official instructions](https://tailscale.com/download), not bundled here.

Save the exact app invitation as private `invitation.json`. With the skill folder
as working directory, prepare the receipt:

```bash
node scripts/bridge.mjs register invitation.json context.json https://host.tailnet.ts.net:8443/v1
```

Return the complete JSON from stdout in the originating Feishu conversation.
Keep files private, do not paste them into public issues. The server state defaults
to `~/.voice-secretary-bind`; `VS_BIND_STATE` can choose another private directory.
Node creates mode-0700 state directories and mode-0600 journals/credentials.
Never place that directory in a repository. The invitation contains `challengeHash` (SHA-256 of the private challenge text),
not the secret. The iPhone retains the secret in Keychain, so viewing a group
prompt and receipt does not grant dispatch credentials. Registration is one binding per
invitation. Identical challenge-exchange retries before expiry return the same
binding-scoped token, allowing recovery from a lost HTTPS response.

Run the bridge under the host owner's normal process manager, with the same
OpenClaw profile and PATH that own the bound session:

```bash
node scripts/bridge.mjs serve
```

It listens only on `127.0.0.1:8765`. Set `VS_BIND_PORT` if using a different local
port, and update Serve accordingly. Use a user service (systemd on Linux or
LaunchAgent on macOS) with absolute Node/script paths and an explicit PATH.
Service creation must follow the host owner's authorization. The service must
not inherit `OPENCLAW_SHELL=exec`; do not remove that attribution from an agent's
child merely to bypass OpenClaw restrictions. A supported owner-managed service
starts independently of the turn. No root Gateway or credential changes are needed.

Registration can run while the service is up. Graceful SIGTERM waits for active
runs. An abrupt crash leaves `bridge.lock`; the safe recovery rules below apply. Never remove run journals. On restart, unfinished
runs become `outcome_unknown` and are not executed again.

## Task and delivery semantics

The app authenticates each call with a per-binding token. `GET /v1/bindings/:id`
checks identity without sending anything. `POST /v1/pair` exchanges a matching,
unexpired invitation challenge and pairing token. Tasks use
`POST /v1/bindings/:id/runs` with an `Idempotency-Key` UUID, protocol version,
frozen `binding`, `task_id`, `revision` and `input`. Optional `probe: true` sends
only a binding test. Poll `GET /v1/bindings/:id/runs/:requestUUID`.

The durable UUID and full payload fingerprint precede the agent call. A repeated
UUID with identical contents returns its receipt; changed contents return 409.
Concurrent bridge turns into the same session are rejected. The actual turn uses
`openclaw agent --session-key ... --message-file ... --deliver --reply-channel
feishu --reply-account ... --reply-to chat:... --json`. Native OpenClaw session
routing handles subsequent Feishu messages and `/new`; if the bound key disappears,
stop and reconcile rather than allocate another session. Session existence is
checked before every dispatch; routing changes require a new binding.

Execution and delivery are independent. A text result can be completed while
Feishu delivery failed or is unknown. No automatic task or message replay occurs.
The app retains the result copy; a probe and an actual Feishu follow-up are required
for real acceptance. Media-only/partial/malformed replies require reconciliation.
The bridge journals indefinitely in this increment; host storage retention/export
must be agreed before long-term release. App deletion removes local credentials;
remote revocation requires stopping the service and removing the relevant binding
file after active requests are reconciled. Automatic remote revocation is deferred.

Official references: [agent CLI](https://docs.openclaw.ai/cli/agent),
[session CLI](https://docs.openclaw.ai/cli/sessions),
[Feishu](https://docs.openclaw.ai/channels/feishu),
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).


## Persistent service and existing-binding upgrades

Run the bridge and Tailscale on the always-on OpenClaw host, not inside a
short-lived agent shell/container. Preserve the Tailscale daemon's state and
node identity across restarts; an ephemeral or deleted node is unsuitable for
this persistent binding. A node marked offline in Tailscale is a host networking
condition, distinct from the loopback bridge process being stopped. Phone
disconnection does not stop either independent host service.

This package now includes an owner-run service helper. In the installed skill directory, prepare the configuration for owner review:

```bash
python3 scripts/service.py
# Inspect the private generated unit/plist and its paths, then install it:
python3 scripts/service.py --apply
```

Use `--node /absolute/node`, `--openclaw /absolute/openclaw`, `--state` and
`--port` when the original installation uses custom paths. Keep the same state
directory and port as the existing binding. The helper does not register a new
binding, change Tailscale, alter credentials, stop an existing service or overwrite
a different service configuration. It sets private state permissions and explicit
executable paths. Linux uses a user systemd unit with restart supervision;
macOS uses a LaunchAgent with KeepAlive. Linux boot without login requires the
owner to enable lingering (`loginctl enable-linger` for that user); inspect the
policy before changing it. A LaunchAgent starts after login; a sleeping or powered
off host remains unavailable. Containers need persistent state volumes and a
supervisor outside the agent turn; do not assume user systemd exists there.

Check service status using `systemctl --user status voice-secretary-bridge` on
Linux or `launchctl print gui/$(id -u)/org.folotoy.voice-secretary-bridge` on macOS.
Check `http://127.0.0.1:8765/health` (adjust the port), then the existing Serve
HTTPS endpoint. `/health` exposes only service readiness/version, no identities or
credentials, and does not validate OpenClaw/Feishu delivery. Tailscale `serve --bg`
persists its configuration but cannot keep a stopped daemon or bridge running.

On startup, a stale `bridge.lock` is automatically replaced only after its stored
PID is positively absent. Active, inaccessible or malformed owners are retained.
Startup replacement is serialized with `bridge-startup.guard`; a guard left by a
crash during this tiny section requires owner review. Never delete run journals.
Recovered unfinished requests remain `outcome_unknown`, without replay. Stop or
upgrade only after active tasks have been reconciled, and retain the original
bindings, state path, HTTPS hostname, port and credentials.

On iPhone, enable [VPN On Demand](https://tailscale.com/docs/features/client/ios-vpn-on-demand)
in Tailscale settings if automatic connectivity is desired. Wi-Fi/cellular Always
rules or supported `.ts.net` hostname matching can avoid routine manual reconnects.
The app cannot override a disabled VPN or another active VPN. After connectivity
returns, task Retry queries the durable original UUID. A missing run is resubmitted
with exactly the same UUID/payload only after verifying the original binding;
received or unknown work is not replayed. Confirmed failure creates a reviewed
retry draft instead of silently repeating side effects.

After reconciling active tasks, an already-loaded service needs an explicit
restart to load upgraded code: `systemctl --user restart voice-secretary-bridge`
or `launchctl kickstart -k gui/$(id -u)/org.folotoy.voice-secretary-bridge`. If the
old bridge was a foreground process, stop that known process gracefully before
installing its supervisor. Do not stop unrelated Node/OpenClaw processes.

An installer running inside agent exec may prepare the configuration. With explicit
host-owner approval, it may use `--apply --owner-approved` to ask the independent
system process manager to start the service. The installer does not run the bridge
as its child or strip `OPENCLAW_SHELL`; the system manager owns the new service.
Without a usable independent manager, stop and report the missing host setup.

Docker without a user systemd manager uses [the dedicated container route](docker.md). Apply now checks manager availability before installing files.
