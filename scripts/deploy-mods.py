#!/usr/bin/env python3
"""Check or deploy only Plus mod files; keep layout, keys, tabs and session state untouched."""
import argparse
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('plus_deploy_install', ROOT/'scripts/install.py')
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)
RECEIPT = Path('data/herdr-chat-plus-deployment.json')


def mod_files():
    return [path for path in install.files() if path.parts[0] == 'mods']


def differences(home):
    return [path for path in mod_files() if install.digest(ROOT/path) != install.digest(home/path)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, default=Path(os.environ.get('HERDR_APP_HOME', str(Path.home()/'.config/herdr-app'))))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true', help='validate, back up and replace changed mod files only')
    mode.add_argument('--check', action='store_true', help='read-only check; fail if installed mods differ')
    args = parser.parse_args()
    home = args.home.expanduser().resolve()
    changed = differences(home)
    for path in changed:
        print('MISSING OR DIFFERENT:', path)
    if not args.apply:
        print('{} mod file(s) differ. Source: {}'.format(len(changed), ROOT))
        return 1 if args.check and changed else 0
    if not (home/'layouts/chat.json').is_file():
        parser.error('Install the Chat layout first with scripts/install.py --install.')
    binary = install.cli()
    if not binary:
        parser.error('Herdr App is required to validate mods before deployment.')
    for name in install.MODS:
        install.run([binary, 'check', str(ROOT/'mods'/name)], home)
    backup = home/'backups'/('plus-mods-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True)
    for path in [*changed, RECEIPT]:
        target = home/path
        if target.exists():
            saved = backup/path
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, saved)
    # Dependencies before entrypoints: hot reload must not see missing modules.
    for path in sorted(changed, key=lambda path: (path.name == 'main.js', str(path))):
        target = home/path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT/path, target)
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True)
    receipt = {'project': 'herdr-chat-plus', 'source': str(ROOT),
               'repository': 'https://github.com/AIPIXZ/herdr-chat-plus',
               'revision': revision.stdout.strip() if revision.returncode == 0 else None,
               'files': {str(path): install.digest(ROOT/path) for path in mod_files()}}
    (home/RECEIPT).parent.mkdir(parents=True, exist_ok=True)
    (home/RECEIPT).write_text(json.dumps(receipt, indent=2)+'\n')
    remaining = differences(home)
    if remaining:
        raise RuntimeError('Installed mods changed during deployment: '+', '.join(map(str, remaining)))
    print('Backup:', backup)
    print('All mod files match Herdr Chat Plus. Layout, keys and session state were preserved.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
