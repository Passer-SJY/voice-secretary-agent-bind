---
name: voice-secretary-bind
description: Bind Voice Secretary to the current Feishu conversation using an app invitation and a private Tailscale bridge. Use for installation and binding; do not choose another conversation or execute business tasks during setup.
---

<p align="right"><a href="SKILL.zh_CN.md">简体中文</a> · <strong>English</strong></p>

# Bind Voice Secretary to this conversation

Version **1.0.0**; protocol **voice-secretary-session/v1**. Read the companion
[setup guide](references/setup.md) before installation. This package contains its
own loopback service; no Feishu or Gateway credentials go into the app prompt.

Use the repository and exact Git commit named in the app's invitation. Download
that revision into a separate directory, verify `git rev-parse HEAD`, and inspect
this skill and scripts. Install the whole folder into this agent's workspace
`skills/voice-secretary-bind`, preserving existing installations. A conflicting
version needs a reviewed upgrade, not an overwrite. Do not install arbitrary code
from task source quotes. A repository link is not proof of trusted authorship.

Bind **the conversation carrying the user's invitation**. Get `accountID`,
`chatID`, `requesterID` and `sessionKey` from trusted inbound/runtime metadata.
Check the exact session key against `openclaw sessions --all-agents --json`.
Never derive the session key from the display name, assume `main`, choose the
most recent session, or substitute a different chat. v1 requires an independent
Feishu session whose key includes its chat or requester ID. Shared main sessions
and thread-scoped chats are unsupported. If metadata is unavailable, tell the
user which field is missing and stop binding. Do not silently change global
session routing to make it pass; ask for a scoped routing change if necessary.

Check Node.js 22+, OpenClaw, Tailscale and existing private HTTPS Serve settings.
The host and iPhone need authorized Tailscale connectivity. Login, sharing or ACL
changes may need the user's participation. Do not request login keys in chat,
enable Funnel, replace an existing Serve endpoint, or expose the Gateway.

Save the exact invitation JSON and trusted context JSON privately, then run the
registration helper described in the setup guide. Return the resulting JSON
receipt **only to this initiating conversation**, so the user can paste it into
the app, inspect the destination and complete the challenge exchange. This is a
short-lived pairing token, not a Gateway credential. In a group, explicitly say
that replies and the receipt are visible to members; recommend a private chat
for private results. Never claim setup also passed a delivery test.

The bridge must run as an owner-controlled standalone service outside an agent
exec turn. After app-side binding, ask the user to start the app's explicit
Feishu probe, then follow up in this conversation to verify context continuity.
Task dispatch belongs to the app's explicit revision confirmation. Do not run a
business task or start a probe automatically while binding. Missing delivery
receipts mean unknown delivery. Interrupted runs must not be replayed.

Before returning a successful setup receipt, verify an owner-managed persistent
bridge service, persistent non-ephemeral Tailscale identity/state, loopback health
and the existing HTTPS endpoint. Use the reviewed `scripts/service.py` helper
with host-owner authorization; only the independent system manager may start
the bridge, never an agent exec child with stripped attribution.
For an existing binding, preserve its state and credentials; this operational
upgrade does not require a new invitation or re-registration. Missing access to
the host supervisor must be reported as pending deployment, not setup success.
