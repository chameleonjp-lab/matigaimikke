'use strict';
// Local source reads + builtin VM/assert only. No game IIFE, real network,
// DB, timers, storage, browser or audio. All response rows below are synthetic.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = __dirname + '/../site/';
const html = fs.readFileSync(root + 'index.html', 'utf8');
const common = fs.readFileSync(root + 'common.js', 'utf8');
const ack = fs.readFileSync(root + 'normal-score-ack8.js', 'utf8');
function extract(name) {
  const start = html.search(new RegExp('    (?:async )?function ' + name + '\\('));
  const offset = html.slice(start + 1).search(/\n    (?:async )?function /);
  assert.ok(start >= 0 && offset >= 0);
  return html.slice(start, start + 1 + offset);
}
function context(names = [], fake = {}) {
  const s = vm.createContext({ URLSearchParams, ...fake }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(common + '\n' + ack + '\n' + names.map(extract).join('\n'), s, { timeout: 200 });
  return s;
}
const fullRow = (rank, name, best, first = best) => ({ rank_no: rank, display_name: name, first_score: first, best_score: best, play_count: 2, updated_at: '2026-01-01T00:00:00Z' });
const response = (name = 'Alice', score = 125) => [{ accepted: true, result_normalized_name: name, result_display_name: name, result_first_score: score, result_best_score: score, result_play_count: 1, is_first_play: true, is_new_best: true }];
const expected = { gameSlug: 'machigai_mikke_easy', displayName: 'Alice', score: 125, scoreOrder: 'asc' };
async function main() {
  let pass = 0; const failures = [];
  async function test(name, fn) { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { failures.push(e); console.error('FAIL ' + name + ': ' + e.message); } }
  await test('actual six-field ranking rows preserve 1,1,3, same names and ASC centiseconds', () => {
    const s = context(); const rows = s.MMCommon.rankingRows([fullRow(1, 'Same', 0), fullRow(1, 'Same', 0), fullRow(3, 'Third', 123)]);
    assert.deepEqual(Array.from(rows, row => row.rank), [1, 1, 3]);
    assert.deepEqual(Array.from(rows, row => row.name), ['Same', 'Same', 'Third']);
    assert.deepEqual(Array.from(rows, row => row.seconds), [0, 0, 1.23]);
  });
  await test('only positive safe numeric rank_no is known; no aliases or ordinal fallback', () => {
    const s = context();
    for (const rank of [undefined, null, '1', 0, -1, 1.5, 9007199254740992, Infinity, NaN, true, []]) {
      const row = fullRow(rank, 'A', 0); row.rank = 1;
      assert.equal(s.MMCommon.rankingRows([row])[0].rank, null);
    }
    assert.equal(s.MMCommon.rankingRows([fullRow(Number.MAX_SAFE_INTEGER, 'A', 0)])[0].rank, Number.MAX_SAFE_INTEGER);
  });
  await test('best ranking never substitutes first_score, an alias, or null with zero', () => {
    const s = context();
    for (const best of [null, undefined, '', false, [], {}, '0', 1.5, Infinity]) {
      const row = fullRow(1, 'A', best, 300); row.score = 100;
      assert.equal(s.MMCommon.rankingRows([row])[0].seconds, null);
    }
    assert.equal(s.MMCommon.rankingRows([fullRow(1, 'A', 0, 300)])[0].seconds, 0);
  });
  await test('real parser output reaches the actual renderer with ties and unknowns intact', () => {
    function node() { return { children: [], textContent: '', append(...values) { this.children.push(...values); }, appendChild(value) { this.children.push(value); } }; }
    const list = node();
    const s = context(['renderRankingList', 'fmt'], { el: { resultRankingList: list, reloadRankingButton: {} }, document: { createElement: node }, resultRankingState: 'ready', resultRankingRows: [], t: key => key === 'seconds' ? 's' : key });
    s.resultRankingRows = s.MMCommon.rankingRows([fullRow(1, 'Same', 0), fullRow(1, 'Same', 0), fullRow(3, '<b>Third</b>', 123), fullRow(null, 'Unknown', null, 300)]);
    s.renderRankingList();
    assert.deepEqual(list.children.map(row => row.children[0].textContent), ['1', '1', '3', '—']);
    assert.deepEqual(list.children.map(row => row.children[2].textContent), ['0.00 s', '0.00 s', '1.23 s', '—']);
    assert.equal(list.children[2].children[1].textContent, '<b>Third</b>');
  });
  await test('fixed normal ACK helper validates all three ASC slugs and btrim-only names', () => {
    const s = context();
    for (const gameSlug of ['machigai_mikke_easy', 'machigai_mikke_hard', 'machigai_mikke_super_hard']) assert.equal(s.validateNormalScoreAck8(response(), { ...expected, gameSlug }).ok, true);
    assert.equal(s.validateNormalScoreAck8(response('A  B'), { ...expected, displayName: ' A  B ' }).ok, true);
    assert.equal(s.validateNormalScoreAck8(response('A B'), { ...expected, displayName: ' A  B ' }).ok, false);
    assert.equal(s.validateNormalScoreAck8(response(), { ...expected, scoreOrder: 'desc' }).ok, false);
  });
  await test('current input range differs from retained historical int4 scores', () => {
    const s = context();
    assert.equal(s.validateNormalScoreAck8(response('Alice', 100000000), { ...expected, score: 100000000 }).ok, true);
    assert.equal(s.validateNormalScoreAck8(response('Alice', 100000001), { ...expected, score: 100000001 }).ok, false);
    const old = response(); Object.assign(old[0], { result_first_score: 2147483647, result_best_score: -2147483648, result_play_count: 2, is_first_play: false, is_new_best: false });
    assert.equal(s.validateNormalScoreAck8(old, expected).ok, true);
  });
  function sender(data, options = {}) {
    const requests = [], pending = []; let reads = 0;
    const s = context(['submitRanking'], { lastResult: null, setTimeout() { return 1; }, clearTimeout() {}, AbortController: class { constructor() { this.signal = {}; } abort() {} }, SUPABASE_URL: 'https://invalid.example', SUPABASE_KEY: 'fake', CLIENT_VERSION: 'test', renderSubmissionStatus() {}, loadResultRanking() { reads++; }, fetch(url, init) { requests.push(JSON.parse(init.body)); if (options.pending) return new Promise(resolve => pending.push(resolve)); return Promise.resolve({ ok: options.ok !== false, text: async () => options.raw === undefined ? JSON.stringify(data) : options.raw }); } });
    s.lastResult = { status: 'clear', modeKey: 'easy', mode: { rankingSlug: options.slug || 'machigai_mikke_easy' }, scoreInt: 125, run: s.MMCommon.createRun('Alice', 'easy') };
    return { s, requests, pending, reads: () => reads };
  }
  await test('actual sender validates eight-field ACK for every existing mode and sends once', async () => {
    for (const slug of ['machigai_mikke_easy', 'machigai_mikke_hard', 'machigai_mikke_super_hard']) {
      const f = sender(response(), { slug }); const run = f.s.lastResult.run;
      await f.s.submitRanking(); await f.s.submitRanking();
      assert.equal(run.submission, 'confirmed'); assert.equal(f.reads(), 1); assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].p_game_slug, slug); assert.equal(f.requests[0].p_score, 125); assert.equal(f.requests[0].p_display_name, 'Alice');
    }
  });
  await test('HTTP 200 alone, malformed/extra/mismatched/contradictory ACK stay uncertain with no resubmit', async () => {
    const bad = [null, {}, [], response().concat(response()), response('Bob'), response('Alice', 126)];
    const extra = response(); extra[0].submission_id = 'not-normal-eight'; bad.push(extra);
    const refused = response(); refused[0].accepted = false; bad.push(refused);
    const wrongOrder = response(); Object.assign(wrongOrder[0], { result_first_score: 200, result_best_score: 200, result_play_count: 2, is_first_play: false, is_new_best: false }); bad.push(wrongOrder);
    for (const data of bad) { const f = sender(data); const result = f.s.lastResult; await f.s.submitRanking(); await f.s.submitRanking(); assert.equal(result.run.submission, 'uncertain'); assert.equal(f.s.lastResult, result); assert.equal(f.requests.length, 1); assert.equal(f.reads(), 0); }
    for (const raw of ['', 'not-json']) { const f = sender(null, { raw }); await f.s.submitRanking(); assert.equal(f.s.lastResult.run.submission, 'uncertain'); }
    const http = sender(response(), { ok: false }); await http.s.submitRanking(); assert.equal(http.s.lastResult.run.submission, 'uncertain');
  });
  await test('late valid ACK only settles its original run, never a new result', async () => {
    const f = sender(null, { pending: true }); const old = f.s.lastResult; const p = f.s.submitRanking();
    f.s.lastResult = { ...old, run: f.s.MMCommon.createRun('Bob', 'easy') };
    f.pending[0]({ ok: true, text: async () => JSON.stringify(response()) }); await p;
    assert.equal(old.run.submission, 'confirmed'); assert.equal(f.s.lastResult.run.submission, 'idle'); assert.equal(f.reads(), 0);
  });
  console.log('PASS total: ' + pass);
  if (failures.length) throw new AggregateError(failures, failures.length + ' normal contract regressions');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
