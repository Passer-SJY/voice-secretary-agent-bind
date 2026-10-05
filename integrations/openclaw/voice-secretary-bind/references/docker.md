<p align="right"><a href="docker.zh_CN.md">简体中文</a> · <strong>English</strong></p>

# Docker recovery without systemd

Use this route when the original OpenClaw container has tini but no user systemd.
Do not run `service.py --apply` there. Prepare two Compose sidecars: the Bridge
uses the reviewed original OpenClaw image/profile; userspace Tailscale uses an
explicit reviewed Tailscale version. Each process is its container's main service,
with `restart: unless-stopped`, sharing the original Gateway network namespace.
No Gateway replacement, new public ports, auth key, Funnel or re-registration.

## Owner preflight

Docker host access and the original Compose project are required. An agent inside
the container cannot apply host configuration without an authorized host tool.
Do not expose the Docker socket merely to avoid this requirement. First identify:
original Compose service name, exact images, original numeric UID:GID/HOME,
Node/OpenClaw executable paths, actual mounted `.openclaw` host source and original
Tailscale state filename. Do not dump container environment or state contents.

Verify the chosen Bridge image actually contains the compatible CLI and Node22+;
software installed only in the old container overlay is not present in the image.
Verify the chosen Tailscale image contains `/usr/local/bin/tailscaled` and the
reviewed compatible version. Build a reviewed image if binaries are absent. Keep
custom OpenClaw profile/config environment in the generated private service after
owner review; validate the original session before business dispatch.

## Stop, copy and verify

Reconcile active requests. Gracefully stop the identified original Bridge and
Tailscale daemon before copying; never terminate unrelated processes or run two
daemons with the same node identity. Keep the original files for rollback.
Inside the original container, run this helper with actual paths:

```bash
python3 scripts/container.py migrate \
  --bridge-state /actual/original/bridge-state \
  --tailscale-state /actual/original/tailscale.state \
  --mount-root /actual/existing/persistent-mount \
  --destination /actual/existing/persistent-mount/voice-secretary-service \
  --services-stopped
```

The helper checks the Linux mount table, rejects overlay/tmpfs destinations,
checks the old Bridge owner and running journals, verifies private copies, and
retains all originals. Only the copied legacy PID lock is removed, because its
PID namespace changes; credentials and journals are byte-identical. The caller
must verify the Tailscale daemon is stopped; the helper cannot prove that from a
state-file path. Copy this complete reviewed skill to the destination's `skill/`.
Preserve existing UID/GID ownership; confirm new containers can read/write only
the selected state/config mounts.

## Generate and deploy from the Docker host

The persistent paths below are HOST paths corresponding to the verified mount,
not container overlay paths. Generate a private override; all parameters must be
actual inspected values, never paste the placeholders as working values:

```bash
python3 scripts/container.py compose \
  --gateway ORIGINAL_SERVICE \
  --bridge-image REVIEWED_OPENCLAW_IMAGE_WITH_VERSION \
  --tailscale-image REVIEWED_TAILSCALE_IMAGE_WITH_VERSION \
  --persistent /actual/host/persistent-mount/voice-secretary-service \
  --openclaw-source /actual/host/openclaw-config \
  --home /actual/original/home --user ORIGINAL_UID:ORIGINAL_GID \
  --node /actual/node --openclaw /actual/openclaw \
  --output /private/voice-bridge.compose.json
```

Merge with the original Compose file and review `docker compose -f ORIGINAL.yml
-f /private/voice-bridge.compose.json config` privately. Verify the original Gateway
service/config is retained, only intended mounts are shared and no new ports or
Funnel are exposed. With owner authorization, apply only the two new services:
`docker compose -f ORIGINAL.yml -f /private/voice-bridge.compose.json up -d
voice-tailscale voice-bridge`. Keep the override in the host's normal deployment
workflow so recreation includes these services. Do not create a new Gateway or
restart it casually; network namespace changes require coordinated sidecar recreation.

The original Tailscale state must restore the same node and Serve listener8443;
do not call `tailscale up` with a new key. The sidecar socket is `/tmp/tailscaled.sock`.
If identity or Serve does not restore, stop and reconcile the copied state/version,
not register a same-name replacement node. Docker's daemon/host must itself be
configured to start; manual `unless-stopped` stops are respected.

## Acceptance and rollback

Check both containers running, loopback `/health` ready, same Tailscale node online,
original hostname/8443 Serve and authenticated original binding reachable. Manually
restart each sidecar and verify recovery; then recreate using the saved host
configuration and verify identity/journals survive. Ask the user to query the
original UUID and test an explicitly confirmed task. Do not replay old business
requests or send a probe automatically. Report deployment and actual tests separately.

If rollback is needed, stop BOTH sidecars first, then use retained original code/
state with the original parameters. Never run old and new daemons concurrently.
Successful config generation is not successful deployment.

References: [Docker multiple processes](https://docs.docker.com/engine/containers/multi-service_container/),
[restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).
