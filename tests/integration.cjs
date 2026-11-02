'use strict';
// Safety closure: builtin fs/vm/assert. NO whole game evaluation, imports,
// real browser, network, storage, audio or real timer callbacks.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = __dirname + '/../site/';
const html = fs.readFileSync(root + 'index.html', 'utf8');
const common = fs.readFileSync(root + 'common.js', 'utf8');
const ack = fs.readFileSync(root + 'normal-score-ack8.js', 'utf8');
function extract(name) {
  const pattern = new RegExp('    (?:async )?function ' + name + '\\(');
  const start = html.search(pattern);
  assert.ok(start >= 0, name + ' exists');
  const tail = html.slice(start + 1);
  const offset = tail.search(/\n    (?:async )?function /);
  assert.ok(offset >= 0, name + ' is bounded by the next declaration');
  return html.slice(start, start + 1 + offset);
}
function context(names, fake) {
  const sandbox = vm.createContext({ URLSearchParams, ...fake }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(common + '\n' + ack + '\n' + names.map(extract).join('\n'), sandbox, { timeout: 200 });
  return sandbox;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function response(data) { return { ok: true, text: async () => JSON.stringify(data) }; }
function acceptedZero() { return [{ accepted: true, result_normalized_name: 'Alice', result_display_name: 'Alice', result_first_score: 0, result_best_score: 0, result_play_count: 1, is_first_play: true, is_new_best: true }]; }
function rankingRow(name, score) { return { rank_no: 1, display_name: name, first_score: score, best_score: score, play_count: 1, updated_at: '2026-01-01T00:00:00Z' }; }
const inertClock = { setTimeout() { return 1; }, clearTimeout() {}, clearInterval() {}, setInterval() { return 1; } };
class FakeAbortController { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } }
async function main() {
  let count = 0;
  async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
  await test('start uses the current blank input and takes a stable named snapshot', () => {
    const box = { value: '' };
    const s = context(['normalizeName', 'start', 'closeShare'], { ...inertClock, shareGeneration: 1, $: () => ({ classList: { remove() {} } }), MODES: { easy: {}, hard: {} }, el: { playerNameInput: box, countdownNumber: {} }, setName() {}, sound: { gesture() {}, play() {} }, timer: 0, countdownTimer: 0, rankRequest: 0, rankController: null, buildGame: key => ({ modeKey: key }), state: null, lastResult: {}, resultRankingState: 'ready', resultRankingRows: [{}], showScreen() {} });
    vm.runInContext("start('easy')", s, { timeout: 100 });
    assert.equal(s.state.run.identity.participating, false);
    assert.equal(s.shareGeneration, 2, 'New play invalidates an old share copy');
    box.value = ' Alice '; vm.runInContext("start('hard')", s, { timeout: 100 });
    box.value = 'Bob'; assert.equal(s.state.run.identity.name, 'Alice');
    assert.equal(s.state.run.identity.modeKey, 'hard');
    assert.equal(s.lastResult, null);
  });
  function submissionSandbox() {
    const pending = [], payloads = []; let renders = 0, reads = 0;
    const s = context(['submitRanking'], { ...inertClock, AbortController: FakeAbortController, lastResult: null, SUPABASE_URL: 'https://invalid.example', SUPABASE_KEY: 'fake', CLIENT_VERSION: 'test', renderSubmissionStatus() { renders++; }, loadResultRanking() { reads++; }, fetch(url, options) { const d = deferred(); pending.push(d); payloads.push(JSON.parse(options.body)); return d.promise; } });
    return { s, pending, payloads, renders: () => renders, reads: () => reads };
  }
  function result(s, name, status = 'clear') { return { status, mode: { rankingSlug: 'machigai_mikke_easy' }, scoreInt: 0, run: s.MMCommon.createRun(name, 'easy') }; }
  await test('anonymous and retired plays never invoke the score transport', async () => {
    const f = submissionSandbox(); f.s.lastResult = result(f.s, ''); await f.s.submitRanking();
    f.s.lastResult = result(f.s, 'Alice', 'retired'); await f.s.submitRanking();
    assert.equal(f.payloads.length, 0);
  });
  await test('submission uses the start snapshot, sends once and reloads after a validated ACK', async () => {
    const f = submissionSandbox(); f.s.lastResult = result(f.s, 'Alice');
    const p = f.s.submitRanking(); await f.s.submitRanking();
    assert.equal(f.payloads.length, 1); assert.equal(f.payloads[0].p_display_name, 'Alice');
    assert.equal(f.payloads[0].p_score, 0); assert.equal(f.payloads[0].p_game_slug, 'machigai_mikke_easy');
    f.pending[0].resolve(response(acceptedZero())); await p; await f.s.submitRanking();
    assert.equal(f.payloads.length, 1); assert.equal(f.reads(), 1);
    assert.equal(f.s.lastResult.run.submission, 'confirmed');
  });
  await test('uncertain submissions remain visible and cannot be resent', async () => {
    const f = submissionSandbox(); const old = result(f.s, 'Alice'); f.s.lastResult = old;
    const p = f.s.submitRanking(); f.pending[0].reject(Error('offline')); await p;
    assert.equal(old.run.submission, 'uncertain'); await f.s.submitRanking(); assert.equal(f.payloads.length, 1);
    assert.equal(f.s.lastResult, old);
  });
  await test('late submission settlement never updates a newer result', async () => {
    const f = submissionSandbox(); const old = result(f.s, 'Alice'); f.s.lastResult = old;
    const p = f.s.submitRanking(); f.s.lastResult = result(f.s, 'Bob');
    f.pending[0].resolve(response(acceptedZero())); await p;
    assert.equal(f.renders(), 1); assert.equal(f.reads(), 0);
    assert.equal(old.run.submission, 'confirmed'); assert.equal(f.s.lastResult.run.submission, 'idle');
  });
  function readSandbox() {
    const pending = [], payloads = [];
    const s = context(['loadResultRanking'], { ...inertClock, AbortController: FakeAbortController, lastResult: { mode: { rankingSlug: 'machigai_mikke_hard' } }, rankRequest: 0, rankController: null, resultRankingState: 'idle', resultRankingRows: [], renderRankingList() {}, SUPABASE_URL: 'https://invalid.example', SUPABASE_KEY: 'fake', fetch(url, options) { const d = deferred(); pending.push(d); payloads.push(JSON.parse(options.body)); return d.promise; } });
    return { s, pending, payloads };
  }
  await test('ranking requests 30 and an earlier response cannot overwrite a newer one', async () => {
    const f = readSandbox(); const first = f.s.loadResultRanking(); const second = f.s.loadResultRanking();
    assert.equal(f.payloads[0].p_limit, 30); assert.equal(f.payloads[0].p_game_slug, 'machigai_mikke_hard');
    f.pending[1].resolve(response([rankingRow('New', 0)])); await second;
    f.pending[0].resolve(response([rankingRow('Old', 123)])); await first;
    assert.equal(f.s.resultRankingRows[0].name, 'New'); assert.equal(f.s.resultRankingRows[0].seconds, 0);
  });
  await test('read failure can be retried without invoking any score submission', async () => {
    const f = readSandbox(); const first = f.s.loadResultRanking(); f.pending[0].reject(Error('offline')); await first;
    assert.equal(f.s.resultRankingState, 'error');
    const second = f.s.loadResultRanking(); f.pending[1].resolve(response([])); await second;
    assert.equal(f.s.resultRankingState, 'ready'); assert.equal(f.s.resultRankingRows.length, 0);
  });
  await test('old-mode ranking reads cannot modify a new result', async () => {
    const f = readSandbox(); const first = f.s.loadResultRanking();
    f.s.lastResult = { mode: { rankingSlug: 'machigai_mikke_easy' } };
    f.pending[0].resolve(response([rankingRow('Old', 0)])); await first;
    assert.equal(f.s.resultRankingRows.length, 0);
  });
  await test('clear result keeps original penalty and rounding rules in an isolated finish function', () => {
    const s = context(['finishClear'], { state: { ended: false, finishLock: false, modeKey: 'hard', mode: { hintPenalty: 30 }, mistakes: 1, hints: 1, run: {} }, timer: 0, clearInterval() {}, nowElapsed: () => 5.125, MISTAKE_PENALTY: 60, SCORE_SCALE: 100, saveBest: () => false, lastResult: null, sound: { play() {} }, finalizeResult() {} });
    vm.runInContext('finishClear()', s, { timeout: 100 });
    assert.equal(s.lastResult.finalSeconds, 95.125); assert.equal(s.lastResult.scoreInt, 9513);
    assert.equal(s.lastResult.status, 'clear');
  });
  console.log('PASS total: ' + count);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
