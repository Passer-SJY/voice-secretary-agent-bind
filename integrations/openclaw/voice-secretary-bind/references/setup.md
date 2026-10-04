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
runs. An abrupt crash leaves `bridge.lock`; verify no process owns that state
before removing this one lock. Never remove run journals. On restart, unfinished
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
