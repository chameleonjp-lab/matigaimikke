'use strict';
// Complete test closure: only local reads, node VM, assertions. All browser,
// storage, timers and audio objects below are inert in-memory fakes.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = __dirname + '/../site/';
const context = vm.createContext({ URLSearchParams, console: { error() {} } });
for (const file of ['common.js', 'locales.js', 'audio.js']) {
  assert.ok(fs.existsSync(root + file), file + ' implements missing common behavior');
  vm.runInContext(fs.readFileSync(root + file, 'utf8'), context, { timeout: 200, filename: file });
}
const C = context.MMCommon;
const T = context.MMText;
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
test('cleared and whitespace names never restore a saved name', () => {
  assert.equal(C.normalizeName('   '), '');
  assert.equal(C.normalizeName('  Alice   Bob  '), 'Alice Bob');
  assert.equal(C.normalizeName('1234567890123'), '123456789012');
  assert.equal(C.normalizeName('😀😀😀😀😀😀😀').length, 12);
});
test('UTF-16 length cap never leaves a dangling high surrogate', () => {
  assert.equal(C.normalizeName('12345678901😀'), '12345678901');
  assert.equal(C.normalizeName('1234567890😀Z'), '1234567890😀');
});
test('start identity is immutable and later home edits cannot publish anonymous runs', () => {
  const run = C.createRun('', 'easy');
  assert.ok(Object.isFrozen(run.identity));
  assert.equal(run.identity.participating, false);
  assert.equal(C.beginSubmission(run, 'clear'), false);
  const named = C.createRun('Alice', 'hard');
  assert.equal(named.identity.name, 'Alice');
  assert.equal(C.beginSubmission(named, 'retired'), false);
  assert.equal(C.beginSubmission(named, 'clear'), true);
  assert.equal(C.beginSubmission(named, 'clear'), false);
  C.settleSubmission(named, false);
  assert.equal(named.submission, 'uncertain');
  assert.equal(C.beginSubmission(named, 'clear'), false);
});
test('validated response state is terminal and cannot be resent', () => {
  const run = C.createRun('Alice', 'easy');
  C.beginSubmission(run, 'clear'); C.settleSubmission(run, true);
  assert.equal(run.submission, 'confirmed');
  assert.equal(C.beginSubmission(run, 'clear'), false);
});
test('saved language wins, Chinese scripts are mapped, browser alternatives and English fallback work', () => {
  assert.equal(C.resolveLanguage('de', ['ja-JP']), 'de');
  assert.equal(C.resolveLanguage('bad', ['xx', 'zh-HK']), 'zh-Hant');
  assert.equal(C.resolveLanguage(null, ['zh-SG']), 'zh-Hans');
  assert.equal(C.resolveLanguage(null, ['pt-PT']), 'pt-BR');
  assert.equal(C.resolveLanguage(null, ['xx']), 'en');
  assert.equal(C.resolveLanguage(null, ['EN_us']), 'en');
  assert.equal(C.resolveLanguage(null, ['zh-Hans-TW']), 'zh-Hans');
  assert.equal(C.resolveLanguage(null, ['zh-Hant-CN']), 'zh-Hant');
});
test('all 15 catalogs cover every UI key and interpolate penalties without English fallback', () => {
  assert.equal(Object.keys(T.catalogs).length, 15);
  const keys = Object.keys(T.catalogs.en).sort();
  for (const lang of C.languages) {
    assert.deepEqual(Object.keys(T.catalogs[lang.id]).sort(), keys);
    for (const key of keys) assert.ok(typeof T.catalogs[lang.id][key] === 'string' && T.catalogs[lang.id][key].length, lang.id + ':' + key);
    assert.equal(T.text(lang.id, 'hintAdded', { n: 30 }).includes('{n}'), false);
  }
  assert.equal(T.text('ja', 'share'), 'Xでシェア');
  assert.equal(T.text('ja', 'ranking'), 'ランキング');
});
test('ranking preserves API order and name identity; missing values are not zero or invented ranks', () => {
  const data = [
    { rank_no: 1, display_name: 'Same', first_score: 0, best_score: 0, play_count: 1, updated_at: '2026-01-01T00:00:00Z' },
    { rank_no: null, display_name: 'Same', first_score: 1, best_score: null, play_count: 1, updated_at: '2026-01-01T00:00:00Z' },
    { rank_no: 0, display_name: '<b>A</b>', first_score: 1, best_score: '', play_count: 1, updated_at: '2026-01-01T00:00:00Z' }
  ];
  const rows = C.rankingRows(data);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].seconds, 0);
  assert.equal(rows[1].seconds, null);
  assert.equal(rows[1].rank, null);
  assert.equal(rows[2].seconds, null);
  assert.equal(rows[2].name, '<b>A</b>');
  assert.equal(C.rankingRows(Array.from({ length: 45 }, (_, i) => ({ rank_no: i + 1, display_name: 'A', first_score: i, best_score: i, play_count: 1, updated_at: '2026-01-01T00:00:00Z' }))).length, 30);
});
test('mode detail routes use old game identity, never repository spelling', () => {
  assert.equal(C.rankingURL('super_hard'), 'https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=machigai_mikke&mode=super_hard&type=best');
});
test('home and current confirmed result shares include canonical URL and only two tags', () => {
  const home = C.shareText('ja', null, T.text);
  assert.ok(home.includes('https://chameleonjp.codeberg.page/machigai_mikke/'));
  const result = C.shareText('en', { status: 'clear', modeKey: 'hard', finalSeconds: 12.34, best: 1 }, T.text);
  assert.ok(result.includes('12.34'));
  assert.ok(result.includes('Hard'));
  assert.equal((result.match(/#/g) || []).length, 2);
  assert.ok(result.endsWith('#間違いみっけ #ゲーム制作'));
  assert.equal(result.includes('Alice'), false);
  assert.ok(C.shareText('en', { status: 'clear', modeKey: 'easy', finalSeconds: 0 }, T.text).includes('Easy\nFinal time: 0.00 s'));
  assert.ok(C.shareText('en', { status: 'clear', modeKey: 'superHard', finalSeconds: 2 }, T.text).includes('Super hard\nFinal time: 2.00 s'));
  const intent = C.xIntent('日本語 & +\n' + home);
  assert.equal(new URL(intent).searchParams.get('text'), '日本語 & +\n' + home);
});
test('sound defaults on, respects saved off and exact zero, rejects malformed settings', () => {
  assert.equal(C.soundSettings(null).enabled, true);
  assert.ok(C.soundSettings(null).volume > 0);
  assert.equal(C.soundSettings('{"enabled":false,"volume":0.4}').enabled, false);
  assert.equal(C.soundSettings('{"enabled":true,"volume":0}').volume, 0);
  assert.equal(C.soundSettings('{"enabled":true,"volume":null}').volume, 0.35);
});
test('audio is gesture-gated, throttled, stopped when hidden/off, and failures do not escape', () => {
  let made = 0, ended = 0, disconnected = 0, at = 10;
  const nodes = [];
  class FakeContext {
    constructor() { made++; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { disconnected++; } }; }
    createOscillator() { const n = { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { disconnected++; }, start() {}, stop() { ended++; }, onended: null }; nodes.push(n); return n; }
    resume() { return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const sound = context.MMAudio.create({ AudioContext: FakeContext, now: () => at, hidden: () => false }, { enabled: true, volume: 0.35 });
  sound.play('start'); assert.equal(made, 0);
  sound.gesture(); sound.play('start'); assert.equal(made, 1); assert.equal(nodes.length, 1);
  sound.play('start'); assert.equal(nodes.length, 1);
  at += 1; sound.play('found'); assert.equal(nodes.length, 2);
  sound.hide(); assert.ok(ended >= 2);
  sound.settings({ enabled: false, volume: 0.35 }); at += 1; sound.gesture(); sound.play('start'); assert.equal(nodes.length, 2);
  for (const n of nodes) if (n.onended) n.onended();
  assert.ok(disconnected >= 4);
  const failed = context.MMAudio.create({ AudioContext: class { constructor() { throw Error('denied'); } }, now: () => 0, hidden: () => false }, { enabled: true, volume: 0.35 });
  assert.doesNotThrow(() => { failed.gesture(); failed.play('start'); failed.hide(); });
});
test('pending resume never queues tones and is retried on the next gesture', () => {
  let resumes = 0, tones = 0;
  const host = { AudioContext: class {
    constructor() { this.state = 'suspended'; }
    resume() { resumes++; return new Promise(() => {}); }
    suspend() { return Promise.resolve(); }
    createOscillator() { tones++; throw Error('must not create while suspended'); }
  }, now: () => 5, hidden: () => false };
  const sound = context.MMAudio.create(host, { enabled: true, volume: .35 });
  sound.gesture(); sound.play('found'); sound.gesture(); sound.play('found');
  assert.equal(resumes, 2); assert.equal(tones, 0);
  sound.hide(); sound.play('found'); assert.equal(tones, 0);
});
test('partial audio construction cleans up the oscillator when gain creation fails', () => {
  let stopped = 0, disconnected = 0;
  const host = { AudioContext: class {
    constructor() { this.state = 'running'; }
    createOscillator() { return { stop() { stopped++; }, disconnect() { disconnected++; } }; }
    createGain() { throw Error('gain unavailable'); }
  }, now: () => 1, hidden: () => false };
  const sound = context.MMAudio.create(host, { enabled: true, volume: .35 });
  assert.doesNotThrow(() => { sound.gesture(); sound.play('found'); });
  assert.equal(stopped, 1); assert.equal(disconnected, 1);
});
test('late resume completion after hiding or muting never plays a queued tone', () => {
  let instance, finishResume, tones = 0;
  class PendingContext {
    constructor() { instance = this; this.state = 'suspended'; }
    resume() { finishResume = () => { this.state = 'running'; }; return new Promise(() => {}); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createOscillator() { tones++; throw Error('unexpected tone'); }
  }
  const sound = context.MMAudio.create({ AudioContext: PendingContext, now: () => 1, hidden: () => false }, { enabled: true, volume: .35 });
  sound.gesture(); sound.play('found'); sound.hide(); finishResume(); sound.play('found');
  assert.equal(instance.state, 'running'); assert.equal(tones, 0);
  sound.settings({ enabled: false, volume: .35 }); sound.gesture(); sound.play('found');
  assert.equal(tones, 0);
});
console.log('PASS total: ' + count);
