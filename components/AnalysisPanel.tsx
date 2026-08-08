'use client';

import type { ReactNode } from 'react';

import { PitchChip, hueForName, hueStyle } from '@/components/PitchColor';
import type { AnalysisOnly } from '@/lib/gemini/schema';

/**
 * The analysis, as scannable cards.
 *
 * The rule from the brief is that a card is populated or absent — never
 * present-but-empty with a dash in it. That is enforced structurally here:
 * `Card` returns null when it has nothing to show, so an omitted field cannot
 * leave a hole behind. The only card that is never omitted is arrangement
 * decisions, which the schema already refuses to accept empty.
 */

export type AnalysisPanelProps = {
  analysis: AnalysisOnly;
  /** Rendered inside the panel so the form sits with the rest of the reading. */
  timeline?: ReactNode;
};

const hasText = (value: string | undefined | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasItems = <T,>(value: readonly T[] | undefined | null): value is readonly T[] =>
  Array.isArray(value) && value.length > 0;

function Card({
  title,
  children,
  empty = false,
}: {
  title: string;
  children: ReactNode;
  /** When true the card is dropped entirely rather than rendered blank. */
  empty?: boolean;
}) {
  if (empty) return null;
  const id = `card-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="cadence-card flex flex-col gap-2.5">
      <h3
        id={id}
        className="font-mono text-[0.65rem] tracking-widest uppercase"
        style={{ color: 'var(--ink-faint)' }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <dt className="w-24 shrink-0 text-xs" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
}

/** A quiet badge, not a warning banner — the brief is specific about this. */
function ConfidenceBadge({ value, reason }: { value: number; reason: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1 px-1">
      <p className="flex items-baseline gap-2 text-xs">
        <span className="font-mono font-bold tabular-nums">{percent}%</span>
        <span style={{ color: 'var(--ink-faint)' }}>transcription confidence</span>
      </p>
      {hasText(reason) && (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          {reason}
        </p>
      )}
    </div>
  );
}

export default function AnalysisPanel({ analysis, timeline }: AnalysisPanelProps) {
  const { musical, harmony, melody } = analysis;

  const populatedHarmony = harmony.filter(
    (entry) => hasItems(entry.chordSymbols) || hasItems(entry.romanNumerals),
  );

  return (
    <div className="flex flex-col gap-3">
      <ConfidenceBadge value={analysis.transcriptionConfidence} reason={analysis.confidenceReason} />

      <Card title="Key and tempo">
        <div className="cadence-accent-bar" style={hueStyle(hueForName(musical.key))} />
        <dl className="flex flex-col gap-1">
          <Row
            label="Key"
            value={
              <span className="flex flex-wrap items-baseline gap-2">
                <PitchChip label={musical.key} />
                <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--ink-faint)' }}>
                  {Math.round(musical.keyConfidence * 100)}% confident
                </span>
              </span>
            }
          />
          {hasText(musical.mode) && <Row label="Mode" value={musical.mode} />}
          <Row
            label="Tempo"
            value={
              <span className="font-mono tabular-nums">{Math.round(musical.tempoBpm)} BPM</span>
            }
          />
          <Row label="Meter" value={<span className="font-mono">{musical.timeSignature}</span>} />
          {hasText(musical.feel) && <Row label="Feel" value={musical.feel} />}
        </dl>
      </Card>

      <Card title="Modulations" empty={!hasItems(musical.modulations)}>
        <ul className="flex flex-col gap-1 text-sm">
          {musical.modulations.map((modulation, index) => (
            /*
             * The separating spaces are deliberate. Flex gaps put visual space
             * between these, but whitespace-only text runs are not rendered as
             * flex items — so they cost nothing on screen and keep the copied
             * and announced text reading "bar 25 to A minor" rather than
             * "bar 25toA minor".
             */
            <li key={`${modulation.toKey}-${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--ink-faint)' }}>
                bar {modulation.atBar}
              </span>{' '}
              <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                to
              </span>{' '}
              <PitchChip label={modulation.toKey} />{' '}
              {hasText(modulation.note) && (
                <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                  {modulation.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Meter changes" empty={!hasItems(musical.meterChanges)}>
        <ul className="flex flex-col gap-1 text-sm">
          {musical.meterChanges.map((change, index) => (
            <li key={`${change}-${index}`}>{change}</li>
          ))}
        </ul>
      </Card>

      {timeline && <div className="cadence-card">{timeline}</div>}

      <Card title="Harmony" empty={populatedHarmony.length === 0}>
        <div className="flex flex-col gap-3">
          {populatedHarmony.map((entry, index) => (
            <div key={`${entry.section}-${index}`} className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold">{entry.section}</p>
              {hasItems(entry.chordSymbols) && (
                <div className="flex flex-wrap gap-1">
                  {entry.chordSymbols.map((chord, i) => (
                    <PitchChip key={`${chord}-${i}`} label={chord} />
                  ))}
                </div>
              )}
              {hasItems(entry.romanNumerals) && (
                <p
                  className="font-mono text-xs break-words"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  {entry.romanNumerals.join('  ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Instrumentation" empty={!hasItems(analysis.instrumentation)}>
        <ul className="flex flex-wrap gap-1 text-sm">
          {analysis.instrumentation.map((instrument, index) => (
            <li
              key={`${instrument}-${index}`}
              className="rounded px-2 py-0.5 text-xs"
              style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
            >
              {instrument}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Texture" empty={!hasText(analysis.texture)}>
        <p className="text-sm">{analysis.texture}</p>
      </Card>

      <Card
        title="Melody"
        empty={
          !hasText(melody.range) &&
          !hasText(melody.contour) &&
          !hasText(melody.phraseLength) &&
          !hasItems(melody.motifs)
        }
      >
        <dl className="flex flex-col gap-1">
          {hasText(melody.range) && <Row label="Range" value={<span className="font-mono">{melody.range}</span>} />}
          {hasText(melody.contour) && <Row label="Contour" value={melody.contour} />}
          {hasText(melody.phraseLength) && <Row label="Phrases" value={melody.phraseLength} />}
        </dl>
        {hasItems(melody.motifs) && (
          <ul className="flex flex-col gap-1 text-sm">
            {melody.motifs.map((motif, index) => (
              <li key={`${motif}-${index}`}>{motif}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Production" empty={!hasItems(analysis.productionNotes)}>
        <ul className="flex flex-col gap-1 text-sm">
          {analysis.productionNotes.map((note, index) => (
            <li key={`${note}-${index}`}>{note}</li>
          ))}
        </ul>
      </Card>

      {/*
        Always present. The schema rejects an empty arrangementDecisions, so
        this card cannot go missing — it is the one that admits what the
        arrangement lost, and it is the reason to trust the rest.
      */}
      <Card title="Arrangement decisions">
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          What two hands could not keep.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {analysis.arrangementDecisions.map((decision, index) => (
            <li key={`${decision}-${index}`}>{decision}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
