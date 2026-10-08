<p align="right"><a href="README.zh_CN.md">简体中文</a> · <strong>English</strong></p>

# Voice Secretary conversation binding

[voice-secretary-bind](integrations/openclaw/voice-secretary-bind/SKILL.md) is the downloadable OpenClaw
skill and private Tailscale bridge, version 1.0.0. It binds app tasks to an existing
Feishu conversation and preserves that conversation's OpenClaw context.

Read [installation and operation](integrations/openclaw/voice-secretary-bind/references/setup.md).
Run the dependency-free contract tests with Node.js 22+:

```bash
node --test integrations/openclaw/tests/bridge.test.mjs
```

In the AI Passport development checkout, create a source-only archive with
`python3 tools/package_vs_agent_skill.py`. The archive includes the complete skill,
MIT license and per-file SHA-256 manifest; runtime state and credentials are excluded.

The app generates a 30-minute invitation, then imports the JSON receipt returned
in the selected Feishu conversation. The HTTPS challenge exchange stores a
per-binding token in Keychain. Task delivery uses durable request IDs, exact
conversation routing and separate execution/message-delivery outcomes.

Synthetic contract tests do not validate a real OpenClaw installation, tailnet,
Feishu send, or follow-up context. Those checks remain required. Publication and
host service installation are separate from local build validation.

## Planning and selected projects

The package now includes [phone planning snapshots and proposals](integrations/openclaw/voice-secretary-bind/references/planning.md), including opt-in read-only project context. Keep existing Docker volumes, binding credentials and Tailscale identity when upgrading. Selected calendar/reminder mutations still require phone review; project items cannot be directly modified by this Bridge. Publication is not proof of remote deployment or phone acceptance.
