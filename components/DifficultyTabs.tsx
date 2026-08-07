'use client';

import { DIFFICULTY_LEVELS, type Difficulty } from '@/lib/gemini/schema';
import type { ScoreState } from '@/lib/client/prepareScore';

/**
 * Level switcher. Implements the tabs pattern properly — roving tabindex,
 * arrow-key navigation, aria-controls — because a keyboard user should reach
 * all three arrangements without a mouse.
 */

export type DifficultyTabsProps = {
  active: Difficulty;
  onChange: (level: Difficulty) => void;
  states: Record<Difficulty, ScoreState>;
};

const LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function statusNote(state: ScoreState): string | null {
  switch (state.status) {
    case 'validating':
      return 'checking';
    case 'repairing':
      return 'repairing';
    case 'unavailable':
      return 'unavailable';
    case 'ready':
      return state.repaired ? 'repaired' : null;
  }
}

export default function DifficultyTabs({ active, onChange, states }: DifficultyTabsProps) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = DIFFICULTY_LEVELS.indexOf(active);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % DIFFICULTY_LEVELS.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + DIFFICULTY_LEVELS.length) % DIFFICULTY_LEVELS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = DIFFICULTY_LEVELS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const level = DIFFICULTY_LEVELS[next];
    if (level) onChange(level);
  };

  return (
    <div role="tablist" aria-label="Difficulty" onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
      {DIFFICULTY_LEVELS.map((level) => {
        const selected = level === active;
        const note = statusNote(states[level]);
        const unavailable = states[level].status === 'unavailable';
        return (
          <button
            key={level}
            type="button"
            role="tab"
            id={`tab-${level}`}
            aria-selected={selected}
            aria-controls={`panel-${level}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(level)}
            className={[
              'rounded border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600',
              selected ? 'border-violet-700 bg-violet-700 text-white' : 'border-neutral-300',
              unavailable && !selected ? 'text-neutral-400' : '',
            ].join(' ')}
          >
            {LABEL[level]}
            {note && (
              <span className={selected ? 'ml-2 text-violet-100' : 'ml-2 text-neutral-500'}>({note})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
