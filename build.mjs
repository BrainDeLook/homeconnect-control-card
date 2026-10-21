import fs from 'node:fs/promises';
const names = ['core.mjs', 'schedule.mjs', 'view.mjs', 'card.mjs'];
const parts = await Promise.all(names.map(name => fs.readFile(new URL(`src/${name}`, import.meta.url), 'utf8')));
const bundle = parts.map(source => source.replace(/^import .*? from ['"].*?['"];?\r?\n/gm, '').replace(/^export (?=(?:async )?(?:function|class|const|let)\b)/gm, '')).join('\n');
await fs.mkdir(new URL('dist/', import.meta.url), {recursive:true});
await fs.writeFile(new URL('dist/homeconnect-control-card.js', import.meta.url), `// Home Connect Control Card 0.1.2 — local UI for Home Assistant.\n// Integration remains responsible for all appliance communication.\n${bundle}\n`);
console.log('Built dist/homeconnect-control-card.js');
