#!/usr/bin/env python3
"""Copy canonical shared modules into mods that cannot import outside their folder."""
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    project = json.loads((ROOT/'package.json').read_text())
    for group in project['herdr']['sharedModules']:
        source = ROOT/group['source']
        for copy in group['copies']:
            target = ROOT/copy
            if source.read_bytes() != target.read_bytes():
                shutil.copyfile(source, target)
                print('{} -> {}'.format(group['source'], copy))


if __name__ == '__main__':
    main()
