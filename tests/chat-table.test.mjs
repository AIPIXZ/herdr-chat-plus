import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitMarkdownTables } from '../mods/chat/table.js';

test('pipe tables become separate blocks without changing surrounding markdown', () => {
  const text = 'Before\n\n| Name | Value |\n| :--- | ---: |\n| one | 2 |\n\nAfter';
  const blocks = splitMarkdownTables(text);
  assert.deepEqual(blocks, [
    { md: 'Before\n' },
    { table: { rows: [['Name', 'Value'], ['one', '2']], align: ['left', 'right'] } },
    { md: '\nAfter' },
  ]);
});

test('escaped and inline-code pipes stay inside their cells', () => {
  const blocks = splitMarkdownTables('| A | B |\n| --- | --- |\n| `x|y` | a\\|b |');
  assert.deepEqual(blocks[0].table.rows[1], ['`x|y`', 'a\\|b']);
});

test('ordinary pipes without a separator row remain markdown', () => {
  assert.deepEqual(splitMarkdownTables('a | b\njust text'), [{ md: 'a | b\njust text' }]);
});

test('compact delimiter rows use the rounded table renderer too', () => {
  const parts=splitMarkdownTables('| A | B |\n| - | :-: |\n| one | two |');
  assert.equal(parts[0].table.rows.length,2);
  assert.deepEqual(parts[0].table.align,['left','center']);
});

test('table-shaped text inside closed and unfinished fences remains literal', () => {
  for(const fence of ['```','~~~']) {
    const code=`${fence}text\n| A | B |\n| --- | --- |\n| one | two |`;
    assert.deepEqual(splitMarkdownTables(code),[{md:code}]);
    const closed=code+`\n${fence}`;
    assert.deepEqual(splitMarkdownTables(closed),[{md:closed}]);
    const parts=splitMarkdownTables(closed+'\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |');
    assert.equal(parts.filter(part=>part.table).length,1);
    assert(parts[0].md.includes(closed));
  }
});
