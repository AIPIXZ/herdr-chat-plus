import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('plus_check', Path(__file__).resolve().parents[1]/'scripts/check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class PackageTests(unittest.TestCase):
    def fixture(self, root):
        project = {'name': 'example', 'version': '0.1.0-dev.0', 'herdr': {
            'layout': 'chat', 'mods': ['chat'], 'sharedModules': [
                {'source': 'mods/chat/source.js', 'copies': ['mods/chat/copy.js']} ]}}
        (root/'package.json').write_text(json.dumps(project))
        (root/'keys.json').write_text('{}')
        mod = root/'mods/chat'
        mod.mkdir(parents=True)
        (mod/'mod.json').write_text('{}')
        (mod/'main.js').write_text('import {x} from "./source.js";')
        (mod/'source.js').write_text('export const x = 1;')
        (mod/'copy.js').write_text('export const x = 1;')
        return mod

    def test_valid_package_requires_no_running_app(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            project, modules, errors = check.validate(root)
            self.assertEqual(project['name'], 'example')
            self.assertEqual(len(modules), 3)
            self.assertEqual(errors, [])

    def test_rejects_a_divergent_shared_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mod = self.fixture(root)
            (mod/'copy.js').write_text('export const x = 2;')
            self.assertTrue(any('Shared module differs' in error for error in check.validate(root)[2]))

    def test_rejects_missing_runtime_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mod = self.fixture(root)
            (mod/'main.js').write_text('import {x} from "./missing.js";')
            self.assertTrue(any('Missing import' in error for error in check.validate(root)[2]))

    def test_rejects_a_mod_without_its_entrypoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mod = self.fixture(root)
            (mod/'main.js').unlink()
            self.assertTrue(any('Missing mod file' in error for error in check.validate(root)[2]))

    def test_installer_uses_the_manifest_and_excludes_generated_runtime_files(self):
        spec = importlib.util.spec_from_file_location('plus_install_package', check.ROOT/'scripts/install.py')
        install = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(install)
        project = json.loads((check.ROOT/'package.json').read_text())
        self.assertEqual(install.MODS, project['herdr']['mods'])
        files = install.files()
        self.assertFalse(any(path.name in ('gpui-kit.d.ts', 'jsconfig.json') for path in files))
        for name in install.MODS:
            self.assertIn(Path('mods')/name/'main.js', files)
