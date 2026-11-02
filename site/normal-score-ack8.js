'use strict';
// Pure candidate; not loaded by any game or lab page. No RPC or storage calls.
// Characterizes the existing normal submit_score 8-field response, not the
// separately proposed (currently absent) shared-once 9-field wrapper.
function validateNormalScoreAck8(data, expected) {
  const fail = (reason) => ({ ok: false, reason });
  const orders = {
    juden_ga: 'desc', kodomo_demo_tokechau: 'desc',
    machigai_mikke_easy: 'asc', machigai_mikke_hard: 'asc', machigai_mikke_super_hard: 'asc',
    maketara_omae_no_sei_dakara: 'desc', meoshi_wo_seisu_normal: 'asc', meoshi_wo_seisu_hard: 'asc',
    nayuta_no_himatsubushi: 'desc', sandoicchi: 'desc', shiwakezaru: 'desc',
    suiteki_catch: 'desc', torani_yasashiku: 'desc', toreba_iinoyo: 'desc', yume_wo_mitandakedosa: 'desc'
  };
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const validScore = (value) => Number.isInteger(value) && value >= -100000000 && value <= 100000000;
  // Historical first/best values are returned from retained int4 columns;
  // today's submit range does not prove historical rows used that range.
  const validHistoricalScore = (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)
      || !own(orders, expected.gameSlug) || orders[expected.gameSlug] !== expected.scoreOrder
      || typeof expected.displayName !== 'string' || !validScore(expected.score)) return fail('invalid_expected_contract');
  // PostgreSQL btrim(text) here removes U+0020 only. JS trim/NFKC/lowercase
  // would change the observed server identity. Frontend input caps stay separate.
  const name = expected.displayName.replace(/^ +| +$/g, '');
  if (Array.from(name).length < 1 || Array.from(name).length > 20) return fail('invalid_expected_name');
  if (!Array.isArray(data) || data.length !== 1) return fail('invalid_row_count');
  const row = data[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return fail('invalid_row');
  const keys = ['accepted', 'result_normalized_name', 'result_display_name', 'result_first_score',
    'result_best_score', 'result_play_count', 'is_first_play', 'is_new_best'];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => own(row, key))) return fail('unexpected_schema');
  if (row.accepted !== true || typeof row.is_first_play !== 'boolean' || typeof row.is_new_best !== 'boolean') return fail('not_accepted_or_invalid_flags');
  if (row.result_normalized_name !== name || row.result_display_name !== name) return fail('name_mismatch');
  if (!validHistoricalScore(row.result_first_score) || !validHistoricalScore(row.result_best_score)
      || !Number.isInteger(row.result_play_count) || row.result_play_count < 1 || row.result_play_count > 2147483647) return fail('invalid_score_or_count');
  const first = row.result_first_score;
  const best = row.result_best_score;
  const score = expected.score;
  const bestAtLeast = expected.scoreOrder === 'asc' ? best <= score && best <= first : best >= score && best >= first;
  if (!bestAtLeast) return fail('inconsistent_best');
  if (row.is_first_play) {
    if (row.result_play_count !== 1 || first !== score || best !== score || row.is_new_best !== true) return fail('inconsistent_first_play');
  } else if (row.result_play_count < 2) return fail('inconsistent_later_play');
  if (row.is_new_best && best !== score) return fail('new_best_mismatch');
  return { ok: true, receipt: { ...row }, validationScope: 'normal8_shape_name_score_consistency_only' };
}
