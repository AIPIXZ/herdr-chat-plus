import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('plus_deploy', Path(__file__).resolve().parents[1]/'scripts/deploy-mods.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployModsTests(unittest.TestCase):
    def invoke(self, home, *flags):
        with patch.object(sys, 'argv', ['deploy-mods.py', '--home', str(home), *flags]), \
             patch.object(deploy.install, 'cli', return_value='/fake/herdr-app'), \
             patch.object(deploy.install, 'run'), contextlib.redirect_stdout(io.StringIO()):
            return deploy.main()

    def test_deploy_preserves_layout_keys_drafts_and_detects_an_old_checkout_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp)
            preserved={'layouts/chat.json':'{"personal-layout":true}', 'keys.json':'{"keep":"shortcut"}',
                       'shared.json':'{"keep":"sessions"}', 'data/chat/store-test.json':'{"draft":"keep"}'}
            for name,content in preserved.items():
                path=home/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)
            self.assertEqual(self.invoke(home,'--apply'),0)
            for name,content in preserved.items():self.assertEqual((home/name).read_text(),content)
            receipt=json.loads((home/deploy.RECEIPT).read_text())
            self.assertEqual(receipt['project'],'herdr-chat-plus')
            self.assertEqual(receipt['source'],str(deploy.ROOT))
            self.assertEqual(self.invoke(home,'--check'),0)
            target=home/'mods/chat-preview/main.js';target.write_text('old source without image handling')
            self.assertEqual(self.invoke(home,'--check'),1)
            self.assertEqual(target.read_text(),'old source without image handling')
            self.assertEqual(self.invoke(home,'--apply'),0)
            self.assertEqual(target.read_bytes(),(deploy.ROOT/'mods/chat-preview/main.js').read_bytes())
            self.assertTrue(any((backup/'mods/chat-preview/main.js').is_file() for backup in (home/'backups').iterdir()))

    def test_native_validation_failure_keeps_installed_files_intact(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);(home/'layouts').mkdir();(home/'layouts/chat.json').write_text('{}')
            target=home/'mods/chat/main.js';target.parent.mkdir(parents=True);target.write_text('keep')
            with patch.object(sys,'argv',['deploy-mods.py','--home',str(home),'--apply']), \
                 patch.object(deploy.install,'cli',return_value='/fake/herdr-app'), \
                 patch.object(deploy.install,'run',side_effect=RuntimeError('invalid source')),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):deploy.main()
            self.assertEqual(target.read_text(),'keep')
            self.assertFalse((home/deploy.RECEIPT).exists())
            self.assertFalse((home/'backups').exists())

    def test_dry_run_does_not_create_an_app_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp)/'missing'
            self.assertEqual(self.invoke(home),0)
            self.assertFalse(home.exists())
