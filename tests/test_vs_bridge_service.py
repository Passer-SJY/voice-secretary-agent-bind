import importlib.util
from pathlib import Path
import plistlib
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge_service', ROOT / 'integrations/openclaw/voice-secretary-bind/scripts/service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class BridgeServiceTests(unittest.TestCase):
    def config(self, platform, **changes):
        values = dict(node=Path('/fixture/node'), bridge=Path('/fixture/skill/bridge.mjs'),
                      openclaw=Path('/fixture/bin/openclaw'), state=Path('/fixture/state'),
                      home=Path('/fixture'), path='/fixture/bin:/usr/bin:/bin', port=8765)
        values.update(changes)
        return service.configuration(platform, **values)

    def test_mac_restart_paths_private_logs_and_no_exec_attribution(self):
        c = plistlib.loads(self.config('darwin'))
        self.assertEqual(c['ProgramArguments'], ['/fixture/node', '/fixture/skill/bridge.mjs', 'serve'])
        self.assertTrue(c['KeepAlive']); self.assertTrue(c['RunAtLoad'])
        self.assertEqual(c['Umask'], 0o077)
        self.assertEqual(c['EnvironmentVariables']['VS_BIND_STATE'], '/fixture/state')
        self.assertEqual(c['EnvironmentVariables']['VS_OPENCLAW_BIN'], '/fixture/bin/openclaw')
        self.assertNotIn('OPENCLAW_SHELL', c['EnvironmentVariables'])
        self.assertTrue(c['StandardErrorPath'].startswith('/fixture/state/'))

    def test_linux_quotes_specifiers_and_graceful_stop(self):
        c = self.config('linux', bridge=Path('/fixture/percent% and "quoted"/bridge.mjs')).decode()
        self.assertIn('Restart=always', c)
        self.assertIn('percent%% and \\"quoted\\"', c)
        self.assertIn('TimeoutStopSec=680', c)
        self.assertIn('KillMode=control-group', c)
        self.assertIn('VS_BIND_STATE=/fixture/state', c)
        self.assertNotIn('OPENCLAW_SHELL', c)
        self.assertNotIn('sudo', c)
        self.assertNotIn('tailscale', c)

    def test_reject_invalid_paths_and_ports(self):
        for changes in ({'path': '/bad\npath'}, {'port': 80}, {'port': 70000}):
            with self.assertRaises(ValueError): self.config('linux', **changes)
        with self.assertRaises(ValueError): self.config('unsupported')

    def test_agent_context_cannot_install_without_owner_approval(self):
        with tempfile.TemporaryDirectory() as root:
            env = dict(os.environ, OPENCLAW_SHELL='exec')
            r = subprocess.run([sys.executable, str(Path(service.__file__)), '--apply', '--state', root],
                               env=env, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('--owner-approved', r.stderr)
            self.assertEqual(list(Path(root).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
