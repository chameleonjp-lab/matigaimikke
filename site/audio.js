'use strict';
// Only browser-generated tones; callers provide host capabilities explicitly.
const MMAudio = Object.freeze({
  create(host, initial) {
    let settings = { ...initial }, context = null, unlocked = false, last = -Infinity;
    const voices = new Set();
    function cleanup(voice) {
      voices.delete(voice);
      try { if (voice.oscillator) voice.oscillator.disconnect(); } catch {}
      try { if (voice.gain) voice.gain.disconnect(); } catch {}
    }
    function silence() {
      for (const voice of [...voices]) {
        try { if (voice.oscillator) voice.oscillator.stop(); } catch {}
        cleanup(voice);
      }
    }
    function gesture() {
      if (!settings.enabled || settings.volume === 0 || host.hidden()) return;
      unlocked = true;
      try {
        if (!context && host.AudioContext) context = new host.AudioContext();
        if (context && context.state === 'suspended') {
          // No tone is queued on promise settlement. A later user gesture may retry.
          const pending = context.resume();
          if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        }
      } catch { context = null; }
    }
    function play(event) {
      if (!unlocked || !settings.enabled || settings.volume === 0 || host.hidden() || !context || context.state !== 'running') return;
      const presets = { start: [440, 660, .12], found: [660, 880, .08], wrong: [150, 90, .10], hint: [500, 640, .10], clear: [660, 1320, .22], best: [784, 1568, .24], retire: [260, 130, .15], select: [400, 500, .05] };
      const preset = presets[event];
      if (!preset) return;
      const now = host.now();
      const priority = ['clear', 'best', 'retire'].includes(event);
      if (!priority && now - last < .06) return;
      if (priority || voices.size >= 4) silence();
      last = now;
      const voice = { oscillator: null, gain: null };
      try {
        voice.oscillator = context.createOscillator();
        voice.gain = context.createGain();
        const t = context.currentTime;
        voice.oscillator.type = event === 'wrong' ? 'triangle' : 'sine';
        voice.oscillator.frequency.setValueAtTime(preset[0], t);
        voice.oscillator.frequency.exponentialRampToValueAtTime(preset[1], t + preset[2]);
        voice.gain.gain.setValueAtTime(Math.max(.0001, settings.volume * .12), t);
        voice.gain.gain.exponentialRampToValueAtTime(.0001, t + preset[2]);
        voice.oscillator.connect(voice.gain); voice.gain.connect(context.destination);
        voice.oscillator.onended = () => cleanup(voice);
        voices.add(voice);
        voice.oscillator.start(t); voice.oscillator.stop(t + preset[2]);
      } catch {
        try { if (voice.oscillator) voice.oscillator.stop(); } catch {}
        cleanup(voice);
      }
    }
    return Object.freeze({
      gesture, play,
      settings(next) { settings = { ...next }; if (!settings.enabled || settings.volume === 0) silence(); },
      hide() {
        unlocked = false; silence();
        try { if (context) { const pending = context.suspend(); if (pending && typeof pending.catch === 'function') pending.catch(() => {}); } } catch {}
      }
    });
  }
});
globalThis.MMAudio = MMAudio;
