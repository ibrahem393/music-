'use client';

import type { ReactNode } from 'react';

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
  return (
    <section aria-labelledby={`card-${title.replace(/\s+/g, '-').toLowerCase()}`} className="flex flex-col gap-2 rounded border border-neutral-300 p-3">
      <h3 id={`card-${title.replace(/\s+/g, '-').toLowerCase()}`} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <dt className="w-28 shrink-0 text-neutral-500">{label}</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}

/** A quiet badge, not a warning banner — the brief is specific about this. */
function ConfidenceBadge({ value, reason }: { value: number; reason: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1 rounded border border-neutral-300 px-3 py-2">
      <p className="flex items-baseline gap-2 text-xs">
        <span className="font-mono tabular-nums font-semibold">{percent}%</span>
        <span className="text-neutral-600">transcription confidence</span>
      </p>
      {hasText(reason) && <p className="text-xs text-neutral-500">{reason}</p>}
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
        <dl className="flex flex-col gap-1">
          <Row
            label="Key"
            value={
              <span className="flex flex-wrap items-baseline gap-2">
                <span>{musical.key}</span>
                <span className="font-mono text-xs tabular-nums text-neutral-500">
                  {Math.round(musical.keyConfidence * 100)}% confident
                </span>
              </span>
            }
          />
          {hasText(musical.mode) && <Row label="Mode" value={musical.mode} />}
          <Row
            label="Tempo"
            value={<span className="font-mono tabular-nums">{Math.round(musical.tempoBpm)} BPM</span>}
          />
          <Row label="Meter" value={<span className="font-mono">{musical.timeSignature}</span>} />
          {hasText(musical.feel) && <Row label="Feel" value={musical.feel} />}
        </dl>
      </Card>

      <Card title="Modulations" empty={!hasItems(musical.modulations)}>
        <ul className="flex flex-col gap-1 text-sm">
          {musical.modulations.map((modulation, index) => (
            <li key={`${modulation.toKey}-${index}`} className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xs tabular-nums text-neutral-500">
                bar {modulation.atBar}
              </span>
              <span className="font-medium">to {modulation.toKey}</span>
              {hasText(modulation.note) && (
                <span className="text-neutral-600">— {modulation.note}</span>
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

      {timeline && <div className="rounded border border-neutral-300 p-3">{timeline}</div>}

      <Card title="Harmony" empty={populatedHarmony.length === 0}>
        <div className="flex flex-col gap-3">
          {populatedHarmony.map((entry, index) => (
            <div key={`${entry.section}-${index}`} className="flex flex-col gap-1">
              <p className="text-xs font-medium text-neutral-700">{entry.section}</p>
              {hasItems(entry.chordSymbols) && (
                <p className="font-mono text-xs break-words">{entry.chordSymbols.join('  ')}</p>
              )}
              {hasItems(entry.romanNumerals) && (
                <p className="font-mono text-xs break-words text-neutral-500">
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
            <li key={`${instrument}-${index}`} className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
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
        <p className="text-xs text-neutral-500">What two hands could not keep.</p>
        <ul className="flex flex-col gap-1 text-sm">
          {analysis.arrangementDecisions.map((decision, index) => (
            <li key={`${decision}-${index}`}>{decision}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
