#!/usr/bin/env python3
"""Check package structure, JavaScript syntax, shared copies, and tests without installing."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def validate(root=ROOT):
    project = json.loads((root / 'package.json').read_text())
    config = project['herdr']
    errors = []
    json_files = [root/'package.json', root/'keys.json', *sorted((root/'layouts').glob('*.json')),
                  *sorted((root/'themes').glob('*.json'))]
    for name in config['mods']:
        mod = root/'mods'/name
        for filename in ('main.js', 'mod.json'):
            if not (mod/filename).is_file():
                errors.append('Missing mod file: ' + str((mod/filename).relative_to(root)))
        json_files.append(mod/'mod.json')
    for path in json_files:
        try:
            json.loads(path.read_text())
        except (OSError, ValueError) as error:
            errors.append('{}: {}'.format(path.relative_to(root), error))
    for group in config['sharedModules']:
        source = root/group['source']
        for copy in group['copies']:
            target = root/copy
            if not source.is_file() or not target.is_file() or source.read_bytes() != target.read_bytes():
                errors.append('Shared module differs: {} -> {} (run scripts/sync-shared.py)'.format(group['source'], copy))
    modules = [path for name in config['mods'] for path in sorted((root/'mods'/name).rglob('*.js'))]
    imports = re.compile(r'''(?:from\s+|import\s*)["'](\./[^"']+)["']''')
    for path in modules:
        for reference in imports.findall(path.read_text()):
            if not (path.parent/reference).is_file():
                errors.append('Missing import: {} -> {}'.format(path.relative_to(root), reference))
    return project, modules, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', action='store_true', help='also check all mods against the installed Herdr App')
    args = parser.parse_args()
    project, modules, errors = validate()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('Checking {} {} ({} mods)'.format(project['name'], project['version'], len(project['herdr']['mods'])), flush=True)
    for path in modules:
        subprocess.run(['node', '--check', str(path)], cwd=ROOT, check=True)
    tests = [str(path.relative_to(ROOT)) for path in sorted((ROOT/'tests').glob('*.test.mjs'))]
    subprocess.run(['node', '--test', '--test-reporter=dot', *tests], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test*.py'], cwd=ROOT, check=True)
    if args.native:
        candidate = Path.home()/'.local/bin/herdr-app'
        binary = shutil.which('herdr-app') or (str(candidate) if candidate.is_file() else None)
        if not binary:
            parser.error('Herdr App is required for --native; regular checks do not need it.')
        subprocess.run([binary, '--version'], check=True)
        for name in project['herdr']['mods']:
            subprocess.run([binary, 'check', str(ROOT/'mods'/name)], check=True)
    print('Checks passed.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
