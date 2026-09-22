// The two rules that decide whether a recorded kill is evidence, as pure functions.
//
// They are pure so the negative control in e2e/verdicts.spec.ts can hand them the three known
// escapes directly and watch each one fail. A rule whose only demonstration is a transcript from
// the day it was written is a rule nothing re-checks.
//
// RULE 1 — the pair must have been OBSERVED AT RUNTIME. Source text said only that the call was
// typed somewhere in the file; two edits satisfied that while asserting nothing (see the header
// of e2e/observed.ts). The denominator now comes from what ran.
//
// RULE 2 — the expectation may not be READ OFF THE MARKER IT ASSERTS. Rule 1 cannot see this one:
// a tautological call really does execute, so it really is observed. What makes it worthless is
// the provenance of its ARGUMENT, and that is a question about the text, so this rule reads the
// text — narrowly, and about one thing. Reading a DIFFERENT part of the page is not merely
// allowed but is how the good oracles here work: the partition test counts key buckets off the
// origin ledger and then requires one drawn link per bucket. Reading the marker under assertion
// is the opposite; it makes the call unfalsifiable.
import type { Family, Manifest, Mutation } from './verdict-scan.js'
import type { Observation } from './observed.js'

const HELPER: Record<keyof Manifest, string> = { markers: 'expectVerdict', claims: 'expectClaim' }
const KEY = ' :: '

export type RecordedKill = { family: keyof Manifest; marker: string; mutation: Mutation }

/** Every (family, marker, mutation) the manifest records, flattened. */
export function recordedKills(manifest: Manifest): RecordedKill[] {
  const kills: RecordedKill[] = []
  for (const family of ['markers', 'claims'] as const) {
    for (const [marker, entry] of Object.entries(manifest[family] as Family)) {
      for (const mutation of entry.mutations) kills.push({ family, marker, mutation })
    }
  }
  return kills
}

/**
 * RULE 1. Every recorded kill names a test; that test must have RUN in this session and must have
 * executed the helper against the marker the record names.
 *
 * "Did not run" is a failure rather than a skip on purpose. A run that cannot see the killing test
 * cannot say anything about it, and a checker that cannot look must not report clean — the lane's
 * own census rule, one layer down.
 */
export function unobservedKills(manifest: Manifest, observations: Observation[]): string[] {
  const ran = new Set(observations.filter((entry) => entry.kind === 'test').map((entry) => [entry.spec, entry.test].join(KEY)))
  const executed = new Set(observations.filter((entry) => entry.kind === 'assert').map((entry) => [entry.spec, entry.test, entry.family, entry.marker].join(KEY)))
  const problems: string[] = []
  for (const { family, marker, mutation } of recordedKills(manifest)) {
    const killedBy = mutation.killedBy
    if (!killedBy?.spec || !killedBy?.test) {
      problems.push(`${marker}/${mutation.id}: no killedBy { spec, test } recorded`)
      continue
    }
    if (!ran.has([killedBy.spec, killedBy.test].join(KEY))) {
      problems.push(`${marker}/${mutation.id}: "${killedBy.test}" did not run in this session, so nothing here can say whether it asserts ${marker}`)
      continue
    }
    if (!executed.has([killedBy.spec, killedBy.test, family, marker].join(KEY))) {
      problems.push(`${marker}/${mutation.id}: "${killedBy.test}" ran without ever executing ${HELPER[family]}(page, '${marker}', …) — a call that is commented out, or that lives in another test, is not an assertion`)
    }
  }
  return problems
}

/** The slice of `source` from `test('<title>'` to the next top-level `test(`. */
export function bodyOfTest(source: string, title: string): string | null {
  const start = source.indexOf(`test('${title}'`)
  if (start === -1) return null
  const next = source.indexOf('\ntest(', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

/** The argument text of every `helper(page, '<marker>', <claim>)` call in `body`. */
export function claimArguments(body: string, helper: string, marker: string): string[] {
  const call = new RegExp(`${helper}\\(\\s*page\\s*,\\s*'${marker}'\\s*,`, 'g')
  const args: string[] = []
  for (let hit = call.exec(body); hit !== null; hit = call.exec(body)) {
    let depth = 1
    let index = hit.index + hit[0].length
    const from = index
    for (; index < body.length && depth > 0; index += 1) {
      const character = body[index]
      if (character === '(' || character === '{' || character === '[') depth += 1
      else if (character === ')' || character === '}' || character === ']') depth -= 1
    }
    args.push(body.slice(from, index - 1))
  }
  return args
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/g

/** The argument text plus the declarations of every identifier it reaches, to a fixed point. */
export function provenanceOf(body: string, argument: string): string {
  const collected = [argument]
  const seen = new Set<string>()
  for (let added = true; added;) {
    added = false
    for (const name of collected.join('\n').match(IDENTIFIER) ?? []) {
      if (seen.has(name)) continue
      seen.add(name)
      const declaration = new RegExp(`(?:^|\\n)[^\\n]*\\b(?:const|let|var)\\s+${name}\\s*=[^\\n]*`, 'g')
      for (let hit = declaration.exec(body); hit !== null; hit = declaration.exec(body)) {
        collected.push(hit[0])
        added = true
      }
    }
  }
  return collected.join('\n')
}

/**
 * RULE 2. `readsOf` gives, per marker, the texts that would mean "this expectation came from the
 * marker it is asserting": the marker's own attribute selector, its own name as a quoted literal
 * (how the reader helpers in these specs are addressed), and every DOM id on the marker element
 * or any ancestor of it — that last one DISCOVERED FROM THE RENDERED PAGE, not declared here,
 * because an id list typed into a rule goes stale exactly when the page changes.
 */
export function selfReadingKills(manifest: Manifest, sourceOf: (spec: string) => string, readsOf: (family: keyof Manifest, marker: string) => string[]): string[] {
  const problems: string[] = []
  for (const { family, marker, mutation } of recordedKills(manifest)) {
    const killedBy = mutation.killedBy
    if (!killedBy?.spec || !killedBy?.test) continue
    const body = bodyOfTest(sourceOf(killedBy.spec), killedBy.test)
    if (body === null) {
      problems.push(`${marker}/${mutation.id}: ${killedBy.spec} has no test named "${killedBy.test}"`)
      continue
    }
    const reads = readsOf(family, marker)
    for (const argument of claimArguments(body, HELPER[family], marker)) {
      const provenance = provenanceOf(body, argument)
      const found = reads.filter((read) => provenance.includes(read))
      if (found.length > 0) {
        problems.push(`${marker}/${mutation.id}: "${killedBy.test}" builds its expectation from ${found.join(', ')} — the marker it is asserting, so the call cannot fail and the mutation cannot be killed by it`)
      }
    }
  }
  return problems
}
