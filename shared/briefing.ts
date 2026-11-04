// Pacing of the server-timed BRIEFING step. The server sizes the step with briefingSchedule() and the
// phones reveal the story and rules on the same schedule, so editing the text in server/content.ts
// changes the timing automatically. Longer lines get more reading time.

/** Story line: shown for STORY_BASE_MS + words * STORY_WORD_MS, at least STORY_MIN_MS. */
export const STORY_BASE_MS = 1200;
export const STORY_WORD_MS = 320;
export const STORY_MIN_MS = 2800;
/** Pause between the last story line and the first rule box. */
export const STORY_PAUSE_MS = 2000;
/** Rule box (and the objective box): RULE_BASE_MS + words * RULE_WORD_MS before the next one appears. */
export const RULE_BASE_MS = 2000;
export const RULE_WORD_MS = 380;
/** Reading time after everything is on screen, before the round starts. */
export const END_PAUSE_MS = 4000;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface BriefingText {
  sentences: string[];
  rules: { title: string; desc: string }[];
  objective: string;
}

export interface BriefingSchedule {
  /** Offset (ms from the start) at which each story line appears. */
  sentenceAt: number[];
  storyEndsAt: number;
  /** Offset at which each rule box appears; the last entry is the objective box. */
  ruleAt: number[];
  allShownAt: number;
  totalMs: number;
}

export function briefingSchedule(b: BriefingText): BriefingSchedule {
  let t = 0;
  const sentenceAt: number[] = [];
  for (const s of b.sentences) {
    sentenceAt.push(t);
    t += Math.max(STORY_MIN_MS, STORY_BASE_MS + words(s) * STORY_WORD_MS);
  }
  const storyEndsAt = t;
  t += STORY_PAUSE_MS;
  const ruleAt: number[] = [];
  const boxes = [...b.rules.map(r => `${r.title} ${r.desc}`), b.objective];
  let allShownAt = t;
  for (const text of boxes) {
    ruleAt.push(t);
    allShownAt = t;
    t += RULE_BASE_MS + words(text) * RULE_WORD_MS;
  }
  return { sentenceAt, storyEndsAt, ruleAt, allShownAt, totalMs: t + END_PAUSE_MS };
}
