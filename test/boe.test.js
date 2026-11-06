import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBoeManifest, parseXmlRecord } from '../lib/bocm.js';
const payload = JSON.parse(readFileSync(new URL('./sumario-20261106.json', import.meta.url)));
test('sumario real: incluye disposiciones A y anuncios B sin duplicados', () => {
 const manifest = parseBoeManifest(payload, '2026-11-06');
 assert.equal(manifest.bulletinNumber, '277');
 assert(manifest.cves.includes('BOE-A-2026-23264'));
 assert(manifest.cves.some(id => id.startsWith('BOE-B-')));
 assert.equal(manifest.cves.length, new Set(manifest.cves).size);
 assert(manifest.cves.every(id => /^BOE-[AB]-2026-\d+$/.test(id)));
});
test('rechaza un sumario de otra fecha o un error de origen', () => {
 assert.throws(() => parseBoeManifest(payload, '2026-11-05'));
 assert.throws(() => parseBoeManifest({status:{code:'500'}}, '2026-11-06'));
});
test('XML real: extrae texto completo y verifica identificador', () => {
 const xml=readFileSync(new URL('./BOE-A-2026-23264.xml', import.meta.url),'utf8');
 const record=parseXmlRecord(xml,'BOE-A-2026-23264');
 assert(record.body.length>1000);
 assert.equal(record.publicationDate,'20261106');
 assert.equal(parseXmlRecord(xml,'BOE-B-2026-1'),null);
});
