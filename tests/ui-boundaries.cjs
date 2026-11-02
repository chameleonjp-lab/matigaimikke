'use strict';
// Full closure: only fs/vm/assert, local helper/catalog reads, selected functions
// from HTML. All windows, clipboard, audio, storage and DOM objects are inert.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = __dirname + '/../site/';
const html = fs.readFileSync(root + 'index.html', 'utf8');
const helper = fs.readFileSync(root + 'common.js', 'utf8');
const catalogs = fs.readFileSync(root + 'locales.js', 'utf8');
function extract(name) {
  const start = html.search(new RegExp('    (?:async )?function ' + name + '\\('));
  if (name === 'readSetting') { assert.ok(start >= 0); return html.slice(start, html.indexOf('\n', start)); }
  const offset = html.slice(start + 1).search(/\n    (?:async )?function /);
  assert.ok(start >= 0 && offset >= 0);
  return html.slice(start, start + 1 + offset);
}
function context(names, fake) {
  const sandbox = vm.createContext({ URLSearchParams, ...fake }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(helper + '\n' + catalogs + '\n' + names.map(extract).join('\n'), sandbox, { timeout: 200 });
  sandbox.t = (key, parameters) => sandbox.MMText.text(sandbox.language || 'en', key, parameters);
  return sandbox;
}
async function main() {
  let count = 0;
  const failures = [];
  async function test(name, fn) { try { await fn(); count++; console.log('PASS ' + name); } catch (error) { failures.push(error); console.error('FAIL ' + name + ': ' + error.message); } }
  function shareSandbox(open) {
    const actions = [], text = { value: '', focus() { actions.push('focus'); } }, modal = { classList: { add(value) { actions.push(value); }, remove(value) { actions.push('remove ' + value); } } };
    const s = context(['openX'], { shareGeneration: 0, sound: { hide() { actions.push('stop audio'); } }, window: { open }, $: id => id === 'shareFallbackText' ? text : modal, lastResult: { finalSeconds: 123 } });
    return { s, actions, text };
  }
  function popupWindow(navigate) {
    const created = [], attached = [];
    const popup = { opener: {}, location: { set href(value) { navigate(value); } }, document: {
      createElement(tag) { const node = { tag, click() { navigate(this.href); } }; created.push(node); return node; },
      head: { appendChild(node) { attached.push(node); } }, body: { appendChild(node) { attached.push(node); } }
    }, close() {} };
    return { popup, created, attached };
  }
  await test('X popup gets no opener before navigation and preserves the current result', () => {
    let target, calls = 0; const { popup } = popupWindow(value => { assert.equal(popup.opener, null); target = value; });
    const f = shareSandbox((url, name) => { calls++; assert.equal(url, ''); assert.equal(name, '_blank'); return popup; });
    const result = f.s.lastResult;
    f.s.openX('日本語 & +\n#間違いみっけ #ゲーム制作');
    assert.equal(calls, 1); assert.equal(new URL(target).searchParams.get('text'), '日本語 & +\n#間違いみっけ #ゲーム制作');
    assert.equal(f.actions.includes('open'), false); assert.equal(f.s.lastResult, result);
  });
  await test('blocked popup alone reveals selectable copy text', () => {
    const f = shareSandbox(() => null); f.s.openX('Copy this');
    assert.equal(f.text.value, 'Copy this'); assert.ok(f.actions.includes('open'));
    assert.equal(f.s.shareGeneration, 1);
  });
  await test('closing the actual fallback invalidates any pending clipboard result', () => {
    const removed = [];
    const s = context(['closeShare'], { shareGeneration: 3, $: () => ({ classList: { remove(value) { removed.push(value); } } }) });
    s.closeShare(); assert.equal(s.shareGeneration, 4); assert.deepEqual(removed, ['open']);
  });
  await test('a popup whose navigation fails is closed before showing the fallback', () => {
    let closed = 0;
    const { popup } = popupWindow(() => { throw Error('blocked navigation'); }); popup.close = () => { closed++; };
    const f = shareSandbox(() => popup); f.s.openX('Copy this');
    assert.equal(closed, 1); assert.equal(f.text.value, 'Copy this'); assert.ok(f.actions.includes('open'));
  });
  await test('a popup whose opener cannot be severed is never navigated', () => {
    let navigated = 0, closed = 0;
    const popup = { get opener() { return {}; }, set opener(value) {}, location: { set href(value) { navigated++; } }, close() { closed++; } };
    const f = shareSandbox(() => popup); f.s.openX('Safe fallback');
    assert.equal(navigated, 0); assert.equal(closed, 1); assert.equal(f.text.value, 'Safe fallback');
  });
  await test('only the X popup uses no-referrer metadata and a protected self-targeted anchor', () => {
    const p = popupWindow(() => {}); const f = shareSandbox(() => p.popup); f.s.openX('No referrer');
    const meta = p.attached.find(node => node.tag === 'meta');
    assert.ok(meta); assert.equal(meta.name, 'referrer'); assert.equal(meta.content, 'no-referrer');
    const anchor = p.attached.find(node => node.tag === 'a');
    assert.ok(anchor); assert.equal(anchor.rel, 'noopener noreferrer'); assert.equal(anchor.referrerPolicy, 'no-referrer'); assert.equal(anchor.target, '_self');
    assert.equal(new URL(anchor.href).searchParams.get('text'), 'No referrer');
  });
  await test('clipboard success is reported only after the manual copy operation', async () => {
    let written = null, notice = null;
    const s = context(['copy'], { shareGeneration: 0, navigator: { clipboard: { async writeText(text) { written = text; } } }, window: { isSecureContext: true }, showToast(text) { notice = text; }, $() { throw Error('no fallback needed'); } });
    await s.copy('Share text'); assert.equal(written, 'Share text'); assert.equal(notice, 'Share text copied');
  });
  await test('failed legacy clipboard does not falsely claim a successful copy', async () => {
    let notice = null, selected = 0;
    const area = { focus() {}, select() { selected++; } };
    const s = context(['copy'], { shareGeneration: 0, navigator: {}, window: {}, document: { execCommand: () => false }, $: () => area, showToast(text) { notice = text; } });
    await s.copy('Share text'); assert.ok(notice.startsWith('Copy failed')); assert.equal(selected, 2);
  });
  await test('late clipboard resolution or rejection cannot alter a later share view', async () => {
    for (const shouldReject of [false, true]) {
      let resolve, reject, notices = 0, focus = 0;
      const pending = new Promise((a, b) => { resolve = a; reject = b; });
      const s = context(['copy'], { shareGeneration: 1, navigator: { clipboard: { writeText: () => pending } }, window: { isSecureContext: true }, showToast() { notices++; }, $: () => ({ focus() { focus++; }, select() {} }) });
      const copying = s.copy('Old share'); s.shareGeneration = 2;
      if (shouldReject) reject(Error('late failure')); else resolve();
      await copying; assert.equal(notices, 0); assert.equal(focus, 0);
    }
  });
  await test('stored preferences are initialized without treating off or zero as missing', () => {
    const s = context(['readSetting'], { localStorage: { getItem: key => key === 'lang' ? 'de' : '{"enabled":false,"volume":0}' } });
    assert.equal(s.MMCommon.resolveLanguage(s.readSetting('lang'), ['ja']), 'de');
    assert.equal(s.MMCommon.soundSettings(s.readSetting('sound')).enabled, false);
    assert.equal(s.MMCommon.soundSettings(s.readSetting('sound')).volume, 0);
  });
  await test('the first sound-off action applies mute without initializing audio', () => {
    let gestures = 0, settings = null, saved = null;
    const s = context(['toggleSound', 'saveSound'], { soundSettings: { enabled: true, volume: .35 }, sound: { settings(value) { settings = { ...value }; }, gesture() { gestures++; } }, SOUND_KEY: 'sound', localStorage: { setItem(key, value) { saved = value; } }, renderSettings() {} });
    s.toggleSound(); assert.equal(settings.enabled, false); assert.equal(gestures, 0);
    assert.equal(JSON.parse(saved).enabled, false);
  });
  await test('zero volume persists exactly and does not initialize audio', () => {
    let gestures = 0, saved;
    const s = context(['changeVolume', 'saveSound'], { soundSettings: { enabled: true, volume: .35 }, sound: { settings() {}, gesture() { gestures++; } }, SOUND_KEY: 'sound', localStorage: { setItem(key, value) { saved = value; } }, renderSettings() {} });
    s.changeVolume('0'); assert.equal(JSON.parse(saved).volume, 0); assert.equal(gestures, 0);
  });
  await test('language repaint changes labels but not the run, timer, result or entered name', () => {
    const labels = [{ dataset: { i18n: 'share' } }, { dataset: { i18n: 'ranking' } }];
    const elements = { languageSelect: {}, soundToggle: { setAttribute() {} }, volumeInput: {} };
    const input = { value: 'Unsaved name', placeholder: '' };
    const doc = { documentElement: {}, querySelectorAll: () => labels, querySelector: () => ({}) };
    const state = { modeKey: 'hard', startedAt: 999, sample: ['a'], found: new Set([1]) };
    const result = { scoreInt: 123 };
    const nameError = { textContent: 'このブラウザに保存できませんでした。' };
    const s = context(['applyLanguage', 'renderSettings'], { document: doc, language: 'de', soundSettings: { enabled: false, volume: 0 }, el: { playerNameInput: input, modeLabel: {}, nameError }, state, lastResult: result, $: id => elements[id], modeLabel: () => 'Schwer', renderScores() {}, renderResult() {}, renderRankingList() {}, fetch() { throw Error('must not submit or fetch'); } });
    s.applyLanguage(); assert.equal(doc.documentElement.lang, 'de'); assert.equal(labels[0].textContent, 'Auf X teilen');
    assert.equal(labels[1].textContent, 'Rangliste'); assert.equal(input.value, 'Unsaved name');
    assert.equal(state.startedAt, 999); assert.equal(state.sample[0], 'a'); assert.equal(s.lastResult, result);
    assert.equal(elements.soundToggle.textContent, 'Aus'); assert.equal(elements.volumeInput.value, '0');
    assert.equal(nameError.textContent, s.MMText.text('de', 'storageFailed'));
  });
  console.log('PASS total: ' + count);
  if (failures.length) throw new AggregateError(failures, failures.length + ' failed boundary checks');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
