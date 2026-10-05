import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge_container', ROOT / 'integrations/openclaw/voice-secretary-bind/scripts/container.py')
container = importlib.util.module_from_spec(spec); spec.loader.exec_module(container)


class ContainerTests(unittest.TestCase):
    def test_mount_validation_rejects_overlay_and_unknown_mount(self):
        container.persistent_mount('/fixture/mount/state', '/fixture/mount', '10 1 0:1 / /fixture/mount rw - ext4 /dev/fixture rw')
        for info in ['', '10 1 0:1 / /fixture/mount rw - overlay overlay rw']:
            with self.assertRaises(ValueError): container.persistent_mount('/fixture/mount/state', '/fixture/mount', info)
        with self.assertRaises(ValueError): container.persistent_mount('/fixture/outside', '/fixture/mount', '10 1 0:1 / /fixture/mount rw - ext4 /dev/fixture rw')
    def test_verified_migration_preserves_originals_and_refuses_running(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); source = root/'original'; source.mkdir()
            (source/'binding-fixture.json').write_text('{"credential":"synthetic-only"}')
            run = source/'run-fixture.json'; run.write_text('{"status":"completed"}')
            state = root/'original.state'; state.write_bytes(b'synthetic-node-state')
            destination = root/'persistent'
            with self.assertRaises(ValueError): container.migrate(source, state, destination, False)
            run.write_text('{"status":"running"}')
            with self.assertRaises(ValueError): container.migrate(source, state, destination, True)
            run.write_text('{"status":"completed"}')
            (source/'bridge.lock').write_text(str(os.getpid()))
            with self.assertRaises(ValueError): container.migrate(source, state, destination, True)
            (source/'bridge.lock').unlink()
            container.migrate(source, state, destination, True)
            self.assertEqual((destination/'bridge/binding-fixture.json').read_bytes(), (source/'binding-fixture.json').read_bytes())
            self.assertEqual((destination/'tailscale/tailscaled.state').read_bytes(), state.read_bytes())
            self.assertEqual((destination/'bridge/run-fixture.json').read_bytes(), run.read_bytes())
            self.assertEqual((destination/'bridge/binding-fixture.json').stat().st_mode & 0o777, 0o600)
            self.assertTrue(source.exists()); self.assertTrue(state.exists())
            with self.assertRaises(ValueError): container.migrate(source, state, destination, True)

    def test_compose_has_independent_restart_and_no_new_identity_or_public_port(self):
        c = container.compose('gateway', 'fixture/openclaw:reviewed', 'tailscale/tailscale:v1.90.9',
                              '/fixture/persistent', '/fixture/config', '/home/node', '1000:1000', '/usr/local/bin/node', '/usr/local/bin/openclaw')
        self.assertNotIn('gateway', c['services'])
        for service in c['services'].values():
            self.assertEqual(service['restart'], 'unless-stopped')
            self.assertEqual(service['network_mode'], 'service:gateway')
            self.assertNotIn('ports', service); self.assertNotIn('privileged', service)
        self.assertNotIn('authkey', json.dumps(c).lower())
        with self.assertRaises(ValueError): container.compose('gateway', 'latest', 'tailscale/tailscale:latest', '/p', '/c', '/h', '1000:1000', '/node', '/openclaw')
        if not shutil.which('docker') or subprocess.run(['docker', 'compose', 'version'], capture_output=True).returncode != 0:
            print('Optional Docker Compose parser: NOT RUN (CLI unavailable)'); return
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); base = root/'base.json'; override = root/'bridge.json'
            base.write_text(json.dumps({'services': {'gateway': {'image': 'fixture/openclaw:reviewed'}}}))
            override.write_text(json.dumps(c))
            r = subprocess.run(['docker', 'compose', '-f', str(base), '-f', str(override), 'config', '--quiet'], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__': unittest.main()
