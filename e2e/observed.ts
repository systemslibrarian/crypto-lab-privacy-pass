// The pairs the helpers ACTUALLY EXECUTE, recorded while they run.
//
// The rule this file replaces read the spec's SOURCE and asked whether the string
// `expectVerdict(page, '<marker>'` appeared inside the killing test's body. A mention is not an
// execution, and three different edits satisfy a mention while asserting nothing:
//
//   1. comment the call out            — the text survives inside `//`, the assertion does not;
//   2. move it to another test         — the rule was file-granular, so any occurrence anywhere
//                                        in the file satisfied every record naming that file;
//   3. feed it values read off the very marker it asserts — the call runs and cannot fail.
//
// (1) and (2) are closed here, by recording what ran instead of reading what was typed. (3) is a
// provenance question about the ARGUMENT rather than about the call, and is closed in
// e2e/coverage.ts, which refuses an expectation derived from the marker under assertion.
//
// Playwright runs tests in separate worker processes, so a module-level Set aggregates nothing:
// the coverage check would see only the observations made in its own worker. The sink is
// therefore durable and run-scoped — one append-only file per worker process under
// test-results/, cleared by e2e/global-setup.ts before the first test of a run — and it is read
// back whole by the `verdict-coverage` project, which `dependencies:` forces to run last.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SINK = fileURLToPath(new URL('../test-results/verdict-observations/', import.meta.url))

export type Family = 'markers' | 'claims'

/** A test started. Recorded for EVERY test, so "never ran" and "ran and asserted nothing" are
 *  distinguishable — a check that cannot tell those apart is the silence this lane keeps finding. */
export type RunObservation = { kind: 'test'; spec: string; test: string }
/** A helper asserted a marker. Recorded at entry, so the pair means "this test reached this
 *  assertion", not "this assertion passed". */
export type AssertObservation = { kind: 'assert'; spec: string; test: string; family: Family; helper: string; marker: string }
export type Observation = RunObservation | AssertObservation

/** Spec paths are recorded the way e2e/verdict-mutations.json writes them: repo-relative, `/`. */
export const specOf = (file: string): string => relative(ROOT, file).split(sep).join('/')

export function resetObservations(): void {
  rmSync(SINK, { recursive: true, force: true })
  mkdirSync(SINK, { recursive: true })
}

export function record(observation: Observation): void {
  mkdirSync(SINK, { recursive: true })
  appendFileSync(join(SINK, `${process.pid}.jsonl`), `${JSON.stringify(observation)}\n`)
}

export function readObservations(): Observation[] {
  let files: string[]
  try {
    files = readdirSync(SINK).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
  return files.flatMap((name) =>
    readFileSync(join(SINK, name), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Observation))
}
