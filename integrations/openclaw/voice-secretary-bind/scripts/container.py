#!/usr/bin/env python3
"""Prepare private Docker migration/configuration; never control the host daemon."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def persistent_mount(destination, mount_root, mountinfo):
    destination, mount_root = Path(destination).resolve(), Path(mount_root).resolve()
    if mount_root not in destination.parents:
        raise ValueError('Destination must be inside the verified persistent mount')
    targets = []
    for line in mountinfo.splitlines():
        parts = line.split()
        if len(parts) < 7 or '-' not in parts: continue
        decoded = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), parts[4])
        if Path(decoded).resolve() == mount_root:
            targets.append(parts[parts.index('-') + 1])
    if not targets or any(t in ['overlay', 'tmpfs', 'ramfs', 'proc', 'sysfs'] for t in targets):
        raise ValueError('A separate disk-backed persistent mount must be verified')


def migrate(source, tailscale_state, destination, stopped):
    source, tailscale_state, destination = map(lambda p: Path(p).resolve(), (source, tailscale_state, destination))
    if not stopped:
        raise ValueError('Stop both original services and reconcile work before migration')
    if destination.exists():
        raise ValueError('Destination exists; refusing to overwrite private state')
    if not source.is_dir() or not tailscale_state.is_file():
        raise ValueError('Original bridge directory and Tailscale state file required')
    if destination == source or source in destination.parents:
        raise ValueError('Destination must be separate from original state')
    if (source / 'bridge-startup.guard').exists():
        raise ValueError('Startup guard requires owner review')
    lock = source / 'bridge.lock'
    if lock.exists():
        try:
            pid = int(lock.read_text().strip())
            if pid <= 0: raise ValueError('Invalid lock')
            os.kill(pid, 0)
        except ProcessLookupError: pass
        else: raise ValueError('Original bridge owner remains alive')
    files = list(source.rglob('*'))
    if any(p.is_symlink() or not (p.is_file() or p.is_dir()) for p in files):
        raise ValueError('Original state contains unsupported links/special files')
    for p in files:
        if p.name.startswith('run-') and p.suffix == '.json' and json.loads(p.read_text()).get('status') == 'running':
            raise ValueError('Reconcile active requests before migration')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.bridge-migration-', dir=destination.parent))
    try:
        shutil.copytree(source, temporary / 'bridge', copy_function=shutil.copy2)
        (temporary / 'tailscale').mkdir(mode=0o700)
        shutil.copy2(tailscale_state, temporary / 'tailscale/tailscaled.state')
        for p in files:
            if p.is_file() and digest(p) != digest(temporary / 'bridge' / p.relative_to(source)):
                raise ValueError('Copy verification failed')
        if digest(tailscale_state) != digest(temporary / 'tailscale/tailscaled.state'):
            raise ValueError('Node state copy verification failed')
        # A legacy lock PID belongs to another PID namespace; do not retain it.
        (temporary / 'bridge/bridge.lock').unlink(missing_ok=True)
        for p in temporary.rglob('*'): p.chmod(0o700 if p.is_dir() else 0o600)
        directory = os.open(temporary, os.O_RDONLY)
        try:
            for p in temporary.rglob('*'):
                if p.is_file():
                    with p.open('rb') as f: os.fsync(f.fileno())
            os.fsync(directory)
        finally: os.close(directory)
        temporary.rename(destination)
        parent = os.open(destination.parent, os.O_RDONLY)
        try: os.fsync(parent)
        finally: os.close(parent)
    finally:
        if temporary.exists(): shutil.rmtree(temporary)


def compose(gateway, bridge_image, tailscale_image, persistent, openclaw_source, home, user, node, openclaw):
    if not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_-]*', gateway) or gateway in ['voice-bridge', 'voice-tailscale']:
        raise ValueError('Provide the actual original Compose service name')
    for image in [bridge_image, tailscale_image]:
        if not image or any(c.isspace() for c in image) or image.endswith(':latest') or not (':' in image or '@sha256:' in image):
            raise ValueError('Use explicit reviewed image versions/digests')
    for p in [persistent, openclaw_source, home, node, openclaw]:
        if not str(p).startswith('/') or any(c in str(p) for c in ['\n', '\r', '$']):
            raise ValueError('Use actual absolute paths without Compose interpolation')
    if not re.fullmatch(r'[0-9]+:[0-9]+', user): raise ValueError('Original numeric UID:GID required')
    def mount(source, target): return {'type': 'bind', 'source': str(source), 'target': target, 'bind': {'create_host_path': False}}
    common = {'restart': 'unless-stopped', 'network_mode': 'service:' + gateway, 'user': user,
              'depends_on': {gateway: {'condition': 'service_started'}}, 'init': True}
    bridge = dict(common, image=bridge_image, entrypoint=[node], command=['/skill/scripts/bridge.mjs', 'serve'],
        environment={'HOME': home, 'VS_BIND_STATE': '/state/bridge', 'VS_BIND_PORT': '8765', 'VS_OPENCLAW_BIN': openclaw},
        volumes=[mount(str(persistent) + '/bridge', '/state/bridge'), mount(str(persistent) + '/skill', '/skill'),
                 mount(openclaw_source, home + '/.openclaw')], stop_grace_period='680s',
        healthcheck={'test': ['CMD', node, '-e', "fetch('http://127.0.0.1:8765/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                     'interval': '30s', 'timeout': '5s', 'retries': 3},
        logging={'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '3'}})
    tailscale = dict(common, image=tailscale_image, entrypoint=['/usr/local/bin/tailscaled'],
        command=['--tun=userspace-networking', '--state=/state/tailscaled.state', '--socket=/tmp/tailscaled.sock'],
        volumes=[mount(str(persistent) + '/tailscale', '/state')], stop_grace_period='30s',
        logging={'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '3'}})
    # No replacement Gateway, published ports, Funnel or new auth key.
    return {'services': {'voice-tailscale': tailscale, 'voice-bridge': bridge}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    m = sub.add_parser('migrate')
    m.add_argument('--bridge-state', required=True); m.add_argument('--tailscale-state', required=True)
    m.add_argument('--destination', required=True); m.add_argument('--services-stopped', action='store_true')
    m.add_argument('--mount-root', required=True, help='Actual original disk-backed mount inside the container')
    c = sub.add_parser('compose')
    for option in ['gateway', 'bridge-image', 'tailscale-image', 'persistent', 'openclaw-source', 'home', 'user', 'node', 'openclaw', 'output']:
        c.add_argument('--' + option, required=True)
    args = parser.parse_args()
    if args.mode == 'migrate':
        persistent_mount(args.destination, args.mount_root, Path('/proc/self/mountinfo').read_text())
        migrate(args.bridge_state, args.tailscale_state, args.destination, args.services_stopped)
        print('Private state copies verified; originals retained. Confirm destination is a mounted persistent volume.')
    else:
        values = vars(args).copy(); values.pop('mode'); output = Path(values.pop('output'))
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x') as f: json.dump(compose(**values), f, indent=2); f.write('\n')
        output.chmod(0o600)
        print('Compose override prepared. Review with the original Compose file; no service started.')


if __name__ == '__main__':
    try: main()
    except (ValueError, OSError) as e: raise SystemExit('Container preparation failed: ' + str(e))
