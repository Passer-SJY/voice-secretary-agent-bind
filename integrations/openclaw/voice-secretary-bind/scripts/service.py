#!/usr/bin/env python3
"""Prepare or install an owner-managed bridge service. No Tailscale changes."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

LABEL = 'org.folotoy.voice-secretary-bridge'
UNIT = 'voice-secretary-bridge.service'


def unit_quote(value):
    # systemd expands percent specifiers even inside quotes.
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def configuration(platform, node, bridge, openclaw, state, home, path, port):
    values = [node, bridge, openclaw, state, home, path]
    if any('\n' in str(v) or '\r' in str(v) or '\x00' in str(v) for v in values):
        raise ValueError('Paths must not contain newlines or NUL')
    if not 1024 < port <= 65535:
        raise ValueError('Invalid loopback port')
    env = {'PATH': path, 'HOME': str(home), 'VS_BIND_STATE': str(state),
           'VS_BIND_PORT': str(port), 'VS_OPENCLAW_BIN': str(openclaw)}
    if platform == 'darwin':
        return plistlib.dumps({'Label': LABEL, 'ProgramArguments': [str(node), str(bridge), 'serve'],
            'WorkingDirectory': str(bridge.parent), 'EnvironmentVariables': env,
            'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
            'ExitTimeOut': 680, 'Umask': 0o077,
            'StandardOutPath': str(state / 'service.log'),
            'StandardErrorPath': str(state / 'service-error.log')})
    if platform != 'linux':
        raise ValueError('Supported platforms: macOS and Linux')
    environments = '\n'.join('Environment=' + unit_quote(k + '=' + v) for k, v in env.items())
    return f'''[Unit]
Description=Voice Secretary conversation bridge
After=network-online.target

[Service]
Type=simple
ExecStart={unit_quote(node)} {unit_quote(bridge)} serve
{environments}
UMask=0077
Restart=always
RestartSec=10
TimeoutStopSec=680
KillMode=control-group

[Install]
WantedBy=default.target
'''.encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Install and start after owner review')
    parser.add_argument('--owner-approved', action='store_true', help='Owner explicitly authorized this system-managed service installation')
    parser.add_argument('--node', type=Path)
    parser.add_argument('--openclaw', type=Path)
    parser.add_argument('--state', type=Path, default=Path.home() / '.voice-secretary-bind')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if args.apply and os.environ.get('OPENCLAW_SHELL') == 'exec' and not args.owner_approved:
        raise ValueError('Installation from agent exec requires explicit owner authorization (--owner-approved)')
    if args.apply and sys.platform == 'linux':
        usable = shutil.which('systemctl') and subprocess.run(
            ['systemctl', '--user', 'show-environment'], stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL).returncode == 0
        if not usable:
            raise ValueError('No user systemd manager. Use references/docker.md and scripts/container.py; no service files were installed')
    def executable(explicit, name):
        value = explicit or shutil.which(name)
        if not value or not os.access(value, os.X_OK):
            raise ValueError(f'Provide an installed executable with --{name}')
        return Path(value).absolute()
    node, openclaw = executable(args.node, 'node'), executable(args.openclaw, 'openclaw')
    major = int(subprocess.check_output([str(node), '--version'], text=True).strip().lstrip('v').split('.')[0])
    if major < 22:
        raise ValueError('Node.js 22+ required')
    bridge = Path(__file__).resolve().with_name('bridge.mjs')
    home, state = Path.home(), args.state.expanduser().resolve()
    if not bridge.is_file():
        raise ValueError('Missing bridge source')
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    state.chmod(0o700)
    # Keep the profile and executable search path selected by the owner.
    path = os.pathsep.join(dict.fromkeys([str(node.parent), str(openclaw.parent), os.environ.get('PATH', '/usr/bin:/bin')]))
    data = configuration(sys.platform, node, bridge, openclaw, state, home, path, args.port)
    prepared = state / ('bridge.plist' if sys.platform == 'darwin' else UNIT)
    prepared.write_bytes(data); prepared.chmod(0o600)
    print('Prepared service:', prepared)
    print('State retained:', state)
    if not args.apply:
        print('Review this configuration, then rerun with --apply after host owner authorization.')
        return
    target = home / ('Library/LaunchAgents/' + LABEL + '.plist' if sys.platform == 'darwin' else '.config/systemd/user/' + UNIT)
    if target.exists() and target.read_bytes() != data:
        raise ValueError('An existing service differs; review it before replacement')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data); target.chmod(0o600)
    if sys.platform == 'darwin':
        domain = f'gui/{os.getuid()}'
        loaded = subprocess.run(['launchctl', 'print', domain + '/' + LABEL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if not loaded:
            subprocess.run(['launchctl', 'bootstrap', domain, str(target)], check=True)
        else:
            print('Existing service retained; no active task was restarted.')
    else:
        subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', '--user', 'enable', '--now', UNIT], check=True)
    print('Service installed. Verify /health and the existing Tailscale Serve endpoint.')
    if sys.platform == 'linux':
        print('Boot without login requires owner-enabled user lingering; do not assume it is enabled.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Service setup failed:', error, file=sys.stderr)
        sys.exit(1)
