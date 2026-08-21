// Sonidos de interfaz suaves y agradables, sintetizados con Web Audio API.
// Sin ficheros de audio ni dependencias: cada sonido es una envolvente de
// oscilador (seno/triángulo) con ataque rápido y decaimiento exponencial, para
// que nunca suene a "beep" de sistema ni haga clic al cortar.
//
// Uso: import { playSuccess, playError, playNotify, playClick, playToggle, playSend,
// setSoundsEnabled, soundsEnabled } from "../sounds";
//
// El contexto de audio se crea de forma perezosa en la primera interacción
// (los navegadores exigen un gesto del usuario para permitir audio).

const STORAGE_KEY = "makora.sounds";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

let enabled = readEnabled();
let ctx: AudioContext | null = null;

type ACWithWebkit = typeof AudioContext & {
  new (): AudioContext;
};

function ensureCtx(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const AC = (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: ACWithWebkit }).webkitAudioContext) as
        | ACWithWebkit
        | undefined;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOptions {
  type?: OscillatorType;
  volume?: number;
  when?: number;
  attack?: number;
  duration?: number;
}

function tone(frequency: number, opts: ToneOptions = {}): void {
  const c = ensureCtx();
  if (!c) return;
  const {
    type = "sine",
    volume = 0.12,
    when = 0,
    attack = 0.008,
    duration = 0.12,
  } = opts;

  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t0);

  // Envolvente: silencio -> ataque suave -> decaimiento exponencial a ~0.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function soundsEnabled(): boolean {
  return enabled;
}

export function setSoundsEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* ignorar */
  }
  // Feedback inmediato para que el usuario oiga el cambio.
  if (value) playClick();
}

/** Tick sutil para clics genéricos. */
export function playClick(): void {
  tone(950, { volume: 0.05, duration: 0.05 });
}

/** Doble nota corta para interruptores/toggles. */
export function playToggle(): void {
  tone(520, { volume: 0.06, duration: 0.06 });
  tone(660, { volume: 0.05, when: 0.025, duration: 0.06 });
}

/** Blip ascendente al enviar un mensaje. */
export function playSend(): void {
  tone(620, { volume: 0.07, duration: 0.08 });
  tone(880, { volume: 0.06, when: 0.06, duration: 0.1 });
}

/** Arpegio ascendente suave (C5-E5-G5) al completar una tarea. */
export function playSuccess(): void {
  tone(523.25, { volume: 0.09, duration: 0.16 });
  tone(659.25, { volume: 0.09, when: 0.09, duration: 0.16 });
  tone(783.99, { volume: 0.1, when: 0.18, duration: 0.22 });
}

/** Descenso suave (G4-E4) para errores/fallos. */
export function playError(): void {
  tone(392, { volume: 0.09, duration: 0.14 });
  tone(311.13, { volume: 0.08, when: 0.1, duration: 0.2 });
}

/** Campanilla de dos notas (E5-A5) para notificaciones. */
export function playNotify(): void {
  tone(659.25, { volume: 0.08, duration: 0.18 });
  tone(880, { volume: 0.09, when: 0.14, duration: 0.24 });
}
