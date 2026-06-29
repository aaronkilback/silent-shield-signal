import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Source invariants for the Aegis Home voice repair: a captured voice transcript
 * must reach the SAME Aegis request path as typed text, the realtime layer must
 * not answer (no competing tenant-blind brain), and text chat must stay usable.
 */
const ASSISTANT = readFileSync('src/components/DashboardAIAssistant.tsx', 'utf8');
const HOOK = readFileSync('src/components/voice/useOpenAIRealtime.ts', 'utf8');

function block(src: string, startMarker: string): string {
  const s = src.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const o = src.indexOf('{', s);
  let d = 0;
  for (let i = o; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(o, i + 1); }
  }
  throw new Error('unbalanced');
}

describe('voice transcript → same Aegis path as typed text', () => {
  const onTranscript = block(ASSISTANT, 'onTranscript: (text, isFinal)');

  it('typed text still routes to streamChat (typed path intact)', () => {
    expect(/await streamChat\(userMessage\)/.test(ASSISTANT)).toBe(true);
    expect(/const streamChat = async \(userMessage: string\)/.test(ASSISTANT)).toBe(true);
  });

  it('a final transcript is submitted via the SAME streamChat() as typed text', () => {
    expect(/admitVoiceTurn\(/.test(onTranscript)).toBe(true);
    expect(/streamChat\(decision\.text\)/.test(onTranscript)).toBe(true);
  });

  it('one utterance → one turn: pending lock set on admit, released when the turn settles', () => {
    expect(/voiceTurnPendingRef\.current = true/.test(onTranscript)).toBe(true);
    expect(/\.finally\(\(\) => \{ voiceTurnPendingRef\.current = false; \}\)/.test(onTranscript)).toBe(true);
  });

  it('voice no longer bypasses Aegis (no direct user-message insert in onTranscript)', () => {
    // The old path pushed a "🎙️ ${text}" user message and never called the Aegis path.
    expect(/setMessages\(prev =>/.test(onTranscript)).toBe(false);
    expect(onTranscript.includes('🎙️')).toBe(false);
  });

  it('interim partials only update the live caption (not submitted)', () => {
    expect(/reason === 'interim'[\s\S]*setVoiceTranscript\(text\)/.test(onTranscript)).toBe(true);
  });
});

describe('realtime is speech-to-text only (no competing brain)', () => {
  it('the accepted-transcript path does NOT trigger a realtime voice-turn response', () => {
    expect(/requestResponse\(\s*['"]voice-turn['"]\s*\)/.test(HOOK)).toBe(false);
  });
  it('still surfaces the transcript via onTranscript for routing to Aegis', () => {
    expect(/optionsRef\.current\.onTranscript\?\.\(transcriptText, true\)/.test(HOOK)).toBe(true);
  });
  it('enforces STT-only on session create (create_response:false via session.update)', () => {
    expect(/sttOnlySessionUpdate\(\)/.test(HOOK)).toBe(true);
  });
});

describe('voice failure leaves text chat usable', () => {
  it('voice errors surface and deactivate voice without touching the typed path', () => {
    const onError = block(ASSISTANT, 'onError: (error)');
    expect(/toast\.error\(error\)/.test(onError)).toBe(true);
    expect(/setIsVoiceActive\(false\)/.test(onError)).toBe(true);
    // typed submit path is independent of the voice hook
    expect(/const handleSubmit = async/.test(ASSISTANT)).toBe(true);
  });
});
