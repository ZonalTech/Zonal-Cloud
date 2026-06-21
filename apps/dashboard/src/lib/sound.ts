// Lightweight success/failure beeps for deploy completion. Synthesised with the
// Web Audio API so there are no audio assets to bundle, host, or whitelist in
// the CSP — a single oscillator + gain envelope per beep.
//
// Browsers block audio until the user has interacted with the page. Since the
// beeps only fire after the user clicks Deploy/Migrate, the AudioContext is
// already unlocked by then; we still guard against a suspended context.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Play a sequence of (frequency, startOffset, duration) notes.
function playTones(notes: { freq: number; at: number; dur: number }[]) {
  const audio = getCtx();
  if (!audio) return;
  const now = audio.currentTime;
  for (const { freq, at, dur } of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Short attack/decay envelope to avoid clicks.
    const start = now + at;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.15, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + dur);
  }
}

// Rising two-note chime — a deploy went live.
export function playSuccessBeep() {
  playTones([
    { freq: 660, at: 0, dur: 0.16 },
    { freq: 990, at: 0.14, dur: 0.22 },
  ]);
}

// Falling two-note buzz — a deploy failed.
export function playFailureBeep() {
  playTones([
    { freq: 440, at: 0, dur: 0.18 },
    { freq: 220, at: 0.16, dur: 0.3 },
  ]);
}
