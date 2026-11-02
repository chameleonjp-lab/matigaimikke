'use strict';
// Static compilation/inventory only. The game IIFE is NEVER evaluated.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = __dirname + '/../';
const html = fs.readFileSync(root + 'site/index.html', 'utf8');
let inlineCount = 0;
for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (match[1].includes('src=')) continue;
  new vm.Script(match[2], { filename: 'inline-game.js' });
  inlineCount++;
}
assert.equal(inlineCount, 1);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'No duplicate static IDs');
for (const name of ['common.js', 'locales.js', 'audio.js', 'normal-score-ack8.js']) {
  assert.ok(html.includes('src="' + name + '"'));
  new vm.Script(fs.readFileSync(root + 'site/' + name, 'utf8'), { filename: name });
}
const manifest = JSON.parse(fs.readFileSync(root + 'publish-manifest.json', 'utf8'));
assert.deepEqual(fs.readdirSync(root + 'site').sort(), manifest.runtimeFiles.map(path => path.replace('site/', '')).sort());
for (const href of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])) {
  if (/^https?:|^#/.test(href)) continue;
  assert.ok(manifest.runtimeFiles.includes('site/' + href), 'Required runtime asset is included: ' + href);
}
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(root + 'site/locales.js', 'utf8'), sandbox, { timeout: 200 });
const keys = Object.keys(sandbox.MMText.catalogs.en);
for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(keys.includes(match[1]), 'Localized UI key exists: ' + match[1]);
const exposed = html.match(/window\.MM = \{([^}]+)\}/)[1].split(',').map(value => value.trim());
for (const match of html.matchAll(/\bon\w+="MM\.([A-Za-z]+)\(/g)) assert.ok(exposed.includes(match[1]), 'Handler is exposed: ' + match[1]);
function checkThumbnail(markup, inventory, exists) {
  const images = [];
  for (const match of markup.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(item => [item[1].toLowerCase(), item[2]]));
    const kind = attributes.property || attributes.name;
    if (kind === 'og:image' || kind === 'twitter:image') images.push({ kind, url: attributes.content });
  }
  if (!images.length) {
    assert.equal(inventory.thumbnail.status, 'pending', 'Absent actual-screen image must remain explicitly pending');
    return;
  }
  assert.equal(inventory.thumbnail.status, 'ready');
  assert.deepEqual(images.map(item => item.kind).sort(), ['og:image', 'twitter:image']);
  const path = inventory.thumbnail.path;
  assert.match(path, /^site\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp)$/i);
  assert.ok(inventory.runtimeFiles.includes(path), 'Declared thumbnail must be in the deployed runtime');
  assert.ok(exists(path), 'Declared thumbnail asset must exist');
  assert.equal(typeof inventory.thumbnail.url, 'string');
  const url = new URL(inventory.thumbnail.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(decodeURIComponent(url.pathname.split('/').pop()), path.slice(5));
  for (const image of images) assert.equal(image.url, inventory.thumbnail.url, 'OG and Twitter must refer to the declared real asset');
}
checkThumbnail(html, manifest, path => fs.existsSync(root + path) && fs.statSync(root + path).isFile());
const pendingImage = { thumbnail: { status: 'pending' }, runtimeFiles: [] };
checkThumbnail('<meta name="twitter:card" content="summary">', pendingImage, () => false);
assert.throws(() => checkThumbnail('', { thumbnail: { status: 'ready' } }, () => true));
const imageMarkup = '<meta property="og:image" content="https://example.test/game/thumbnail.png"><meta name="twitter:image" content="https://example.test/game/thumbnail.png">';
const declaredImage = { thumbnail: { status: 'ready', path: 'site/thumbnail.png', url: 'https://example.test/game/thumbnail.png' }, runtimeFiles: ['site/thumbnail.png'] };
checkThumbnail(imageMarkup, declaredImage, () => true);
assert.throws(() => checkThumbnail(imageMarkup, declaredImage, () => false));
assert.throws(() => checkThumbnail(imageMarkup.replace('thumbnail.png', 'missing.png'), declaredImage, () => true));
assert.throws(() => checkThumbnail(imageMarkup, pendingImage, () => true));
console.log('PASS static syntax, bindings, runtime manifest and explicit pending/declared-image boundaries (no game execution)');
