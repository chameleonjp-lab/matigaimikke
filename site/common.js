'use strict';
// Pure shared rules. No storage, network, audio or game startup on load.
const MMCommon = Object.freeze({
  languages: Object.freeze([
    ['ja', '日本語'], ['en', 'English'], ['es', 'Español'], ['pt-BR', 'Português (Brasil)'],
    ['zh-Hans', '简体中文'], ['fr', 'Français'], ['de', 'Deutsch'], ['ko', '한국어'],
    ['ru', 'Русский'], ['it', 'Italiano'], ['zh-Hant', '繁體中文'], ['id', 'Bahasa Indonesia'],
    ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'], ['th', 'ไทย']
  ].map(([id, name]) => Object.freeze({ id, name }))),
  normalizeName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 12);
    // Preserve the original 12 UTF-16-unit cap without cutting an emoji in half.
    return /[\uD800-\uDBFF]$/.test(name) ? name.slice(0, -1) : name;
  },
  createRun(name, modeKey) {
    const normalized = MMCommon.normalizeName(name);
    return { identity: Object.freeze({ name: normalized, participating: Boolean(normalized), modeKey }), submission: 'idle' };
  },
  beginSubmission(run, status) {
    if (!run || !run.identity.participating || status !== 'clear' || run.submission !== 'idle') return false;
    run.submission = 'pending';
    return true;
  },
  settleSubmission(run, validatedResponse) {
    if (run && run.submission === 'pending') run.submission = validatedResponse ? 'confirmed' : 'uncertain';
  },
  resolveLanguage(saved, browsers) {
    const supported = MMCommon.languages.map(item => item.id);
    if (supported.includes(saved)) return saved;
    for (const value of Array.isArray(browsers) ? browsers : []) {
      const parts = String(value).trim().toLowerCase().replace(/_/g, '-').split('-');
      if (parts[0] === 'zh') {
        if (parts.includes('hant')) return 'zh-Hant';
        if (parts.includes('hans')) return 'zh-Hans';
        return parts.some(part => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-Hant' : 'zh-Hans';
      }
      if (parts[0] === 'pt') return 'pt-BR';
      if (supported.includes(parts[0])) return parts[0];
    }
    return 'en';
  },
  rankingRows(data) {
    if (!Array.isArray(data)) throw new Error('Unexpected ranking response');
    return data.slice(0, 30).map(item => {
      const record = item && typeof item === 'object' ? item : {};
      const raw = record.best_score;
      const validScore = Number.isInteger(raw) && raw >= -2147483648 && raw <= 2147483647;
      const rank = record.rank_no;
      return { name: typeof record.display_name === 'string' ? record.display_name : '', seconds: validScore ? raw / 100 : null, rank: Number.isSafeInteger(rank) && rank > 0 ? rank : null };
    });
  },
  rankingURL(mode) {
    const base = 'https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=machigai_mikke';
    return base + (mode ? '&mode=' + encodeURIComponent(mode) + '&type=best' : '');
  },
  shareText(language, result, text) {
    const parts = ['間違いみっけ'];
    if (!result) parts.push(text(language, 'shareIntro'));
    else {
      parts.push(text(language, result.modeKey));
      parts.push(result.status === 'clear'
        ? text(language, 'finalSeconds') + ': ' + Number(result.finalSeconds).toFixed(2) + ' ' + text(language, 'seconds')
        : text(language, 'retired') + ' · ' + Number(result.elapsedSeconds).toFixed(2) + ' ' + text(language, 'seconds') + ' · ' + text(language, 'found') + ' ' + result.found + '/9');
    }
    parts.push('https://chameleonjp.codeberg.page/machigai_mikke/', '#間違いみっけ #ゲーム制作');
    return parts.join('\n');
  },
  xIntent(text) { return 'https://x.com/intent/post?' + new URLSearchParams({ text }).toString(); },
  soundSettings(raw) {
    let value = null;
    try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { /* Defaults only for invalid settings. */ }
    return {
      enabled: value && typeof value.enabled === 'boolean' ? value.enabled : true,
      volume: value && typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 ? value.volume : 0.35
    };
  }
});
globalThis.MMCommon = MMCommon;
