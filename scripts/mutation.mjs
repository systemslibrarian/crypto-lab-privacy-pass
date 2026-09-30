#!/usr/bin/env node
/**
 * The mutation runner — template §4.1c, made reproducible, for a page whose
 * claims are rendered rather than returned.
 *
 * WHY THIS EXISTS RATHER THAN A PROSE LEDGER
 *
 * `e2e/verdict-mutations.json` used to carry each mutation as a SENTENCE and an
 * `observed` paragraph written by hand. Both halves fail in the same way: a
 * sentence cannot be replayed, and a paragraph describing a run is the author's
 * side of the claim. Some of those paragraphs described a run against a tree
 * that no longer existed. Worse, one described a mutation that had never
 * applied — the anchor matched nothing, the edit silently did not land, and
 * both runs came back green, which is indistinguishable from "the harness does
 * not bite". Every record in that file is now produced BY this script, from a
 * run it actually did.
 *
 * THE RULES, each learned from a way of being wrong:
 *
 *  0. The owning test must PASS on the UNMUTATED tree in this same session. A
 *     mutation "caught" by an already-red test is caught by nothing.
 *  1. The run happens in an ISOLATED TREE — `git archive HEAD` into a temp
 *     directory with node_modules symlinked — so nothing is judged against the
 *     working copy, and a crash mid-run cannot strand an inverted condition in
 *     a file that also holds real work.
 *  2. The patch must APPLY: its anchor must occur exactly once, and the file on
 *     disk must actually differ afterwards. This is the check the old records
 *     lacked, and the one that would have caught the silent no-op.
 *  3. The BUNDLE HASH must move, which is what proves the mutation reached the
 *     browser rather than being tree-shaken, shadowed, or folded away by a
 *     build-time define.
 *  4. The build must SUCCEED. A patch that does not compile is reported as DOES
 *     NOT BUILD and is never counted as a kill: the suite would otherwise run
 *     against the last good bundle, or fail for a reason that is not the claim.
 *     Fix the patch — `|| true` rather than deleting a used local — and re-run.
 *  5. The owning test must FAIL, and its output must NAME the marker or claim it
 *     covers. A test that fails for an unrelated reason is not evidence about
 *     this verdict.
 *  6. The tree is restored and the hash must return to its baseline value.
 *
 * It writes `observed` back into e2e/verdict-mutations.json itself, recording
 * the sha it ran at, both bundle hashes, the md5 of the patched file before and
 * after, the baseline pass count, and the verbatim failure line. No evidence
 * line in that file may be carried over from a run that did not happen on this
 * tree, so this writer is the only thing that produces them.
 *
 * Usage:  node scripts/mutation.mjs           (all)
 *         node scripts/mutation.mjs M7        (one)
 *         node scripts/mutation.mjs --keep    (leave the isolated tree behind)
 */

import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const LEDGER = join(ROOT, 'e2e', 'verdict-mutations.json')

const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const only = argv.find((a) => !a.startsWith('--'))

const doc = JSON.parse(readFileSync(LEDGER, 'utf8'))
const entries = []
for (const group of ['markers', 'claims']) {
  for (const [name, entry] of Object.entries(doc[group])) {
    for (const m of entry.mutations) entries.push({ ...m, group, name, ref: m })
  }
}
const selected = entries.filter((e) => !only || e.id === only)
if (!selected.length) {
  console.error(`No mutation matches "${only}". Ids: ${entries.map((e) => e.id).join(', ')}`)
  process.exit(2)
}

const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim()

// Rule 1's precondition: the archive is of HEAD, so uncommitted work would be
// invisible to the run and every record would describe a tree nobody has.
const dirty = git('status', '--porcelain', '--untracked-files=no')
if (dirty && !process.env.MUTATION_ALLOW_DIRTY) {
  console.error('Refusing to run: uncommitted changes to tracked files.\n')
  console.error(dirty)
  console.error('\n`git archive HEAD` would not contain them, so every record this run wrote')
  console.error('would describe a tree that does not exist. Commit first.')
  console.error('MUTATION_ALLOW_DIRTY=1 overrides, knowing that.')
  process.exit(2)
}
const sha = git('rev-parse', 'HEAD')
const shortSha = sha.slice(0, 7)

const TREE = mkdtempSync(join(tmpdir(), 'pp-mutation-'))
console.log(`isolated tree: ${TREE}`)
console.log(`archived from: ${shortSha}\n`)
execSync(`git -C ${ROOT} archive HEAD | tar -x -C ${TREE}`, { stdio: 'pipe' })
symlinkSync(join(ROOT, 'node_modules'), join(TREE, 'node_modules'))

// CI=1 on purpose: it flips playwright.config.ts's `reuseExistingServer` to
// false, so a mutated bundle can never be judged by a server that an earlier and
// UNMUTATED run left listening — which reports a real kill as a survivor.
const sh = (cmd) =>
  execSync(cmd, {
    cwd: TREE,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 64 * 1024 * 1024,
  })

const DIST = join(TREE, 'dist', 'assets')
function bundleHash() {
  if (!existsSync(DIST)) return null
  const h = createHash('sha256')
  for (const f of readdirSync(DIST).sort()) h.update(f).update(readFileSync(join(DIST, f)))
  return h.digest('hex').slice(0, 12)
}
const md5 = (rel) => createHash('md5').update(readFileSync(join(TREE, rel))).digest('hex').slice(0, 12)

function build() {
  try {
    sh('npm run build')
    return true
  } catch {
    return false
  }
}

function runOwner(spec, test) {
  const cmd = `npx playwright test ${spec} --project=claims -g ${JSON.stringify(test)}`
  try {
    return { failed: false, output: sh(cmd) }
  } catch (err) {
    return { failed: true, output: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function apply(m, forward) {
  const { patch } = m
  const [from, to] = forward ? [patch.from, patch.to] : [patch.to, patch.from]
  const path = join(TREE, patch.file)
  const before = readFileSync(path, 'utf8')
  const count = before.split(from).length - 1
  if (count !== 1) {
    throw new Error(
      `expected exactly one occurrence of the ${forward ? 'anchor' : 'replacement'} in ${patch.file}, found ${count}`,
    )
  }
  const after = before.replace(from, to)
  // Rule 2, and the reason this runner exists: an edit that does not land reads
  // exactly like a harness that does not bite.
  if (after === before) throw new Error('the patch produced an identical file: it did not apply')
  writeFileSync(path, after)
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** The failure line that names the covered id, or the first assertion line. */
function failureLine(output, needle) {
  const lines = strip(output).split('\n').map((l) => l.trimEnd())
  const at = lines.findIndex((l) => l.includes(needle))
  if (at >= 0) return lines[at].trim().slice(0, 260)
  const err = lines.findIndex((l) => /Error:|expect\(/.test(l))
  return (err >= 0 ? lines[err] : lines.slice(-3).join(' ')).trim().slice(0, 260)
}
const passCount = (output) => (strip(output).match(/(\d+)\s+passed/) || [])[1] ?? '?'

console.log('building the baseline in the isolated tree...')
if (!build()) {
  console.error('The baseline build fails in the isolated tree. Nothing below would mean anything.')
  if (!keep) rmSync(TREE, { recursive: true, force: true })
  process.exit(2)
}
const baselineHash = bundleHash()
console.log(`baseline bundle ${baselineHash}\n`)

// Baselines are cached per owning test: the tree is unmutated at that moment, so
// two mutations sharing a test share one honest baseline.
const baselines = new Map()
function baselineFor(spec, test) {
  const key = `${spec}::${test}`
  if (!baselines.has(key)) baselines.set(key, runOwner(spec, test))
  return baselines.get(key)
}

const results = []
for (const m of selected) {
  process.stdout.write(`${m.id.padEnd(5)} ${m.name.padEnd(17)} `)
  let applied = false
  try {
    const base = baselineFor(m.killedBy.spec, m.killedBy.test)
    const beforeMd5 = md5(m.patch.file)
    apply(m, true)
    applied = true
    const afterMd5 = md5(m.patch.file)
    const built = build()
    const mutatedHash = built ? bundleHash() : null
    const owner = built ? runOwner(m.killedBy.spec, m.killedBy.test) : { failed: false, output: '' }
    apply(m, false)
    applied = false
    build()
    const restoredHash = bundleHash()

    const covered = m.name
    const verdict = base.failed
      ? 'BASELINE ALREADY RED'
      : !built
        ? 'DOES NOT BUILD'
        : mutatedHash === baselineHash
          ? 'BUNDLE UNCHANGED'
          : !owner.failed
            ? 'SURVIVED'
            : !strip(owner.output).includes(covered)
              ? 'FAILED FOR THE WRONG REASON'
              : restoredHash !== baselineHash
                ? 'NOT RESTORED'
                : 'KILLED'

    m.ref.observed = [
      `re-derived ${new Date().toISOString().slice(0, 10)} by scripts/mutation.mjs at ${shortSha},`,
      'in an isolated `git archive HEAD` tree with node_modules symlinked and CI=1,',
      'so Playwright built and served the mutated bundle itself.',
      `Baseline (unmutated, same session): ${base.failed ? 'FAILED' : `${passCount(base.output)} passed`}.`,
      `${m.patch.file} md5 ${beforeMd5} -> ${afterMd5};`,
      `bundle ${baselineHash} -> ${mutatedHash ?? 'no build'} -> ${restoredHash}.`,
      verdict === 'KILLED'
        ? `Mutated run FAILED naming "${covered}": ${failureLine(owner.output, covered)}`
        : `VERDICT ${verdict}: ${failureLine(owner.output, covered)}`,
    ].join(' ')

    results.push({ id: m.id, verdict })
    console.log(
      verdict === 'KILLED'
        ? `KILLED    ${baselineHash} -> ${mutatedHash} -> ${restoredHash}   baseline ${passCount(base.output)} passed`
        : verdict,
    )
  } catch (err) {
    if (applied) {
      try {
        apply(m, false)
        build()
      } catch {
        /* isolated tree, discarded below */
      }
    }
    results.push({ id: m.id, verdict: `ERROR: ${err.message}` })
    console.log(`ERROR  ${err.message}`)
  }
}

writeFileSync(LEDGER, `${JSON.stringify(doc, null, 2)}\n`)
const bad = results.filter((r) => r.verdict !== 'KILLED')
console.log(`\n${results.length - bad.length}/${results.length} mutations were killed by the test that owns them.`)
if (bad.length) {
  console.log('\nNot killed:')
  for (const r of bad) console.log(`  ${r.id}: ${r.verdict}`)
  console.log('\nDOES NOT BUILD is a broken PATCH, not a surviving mutation: fix the patch and re-run.')
  console.log('SURVIVED is evidence about the SOURCE or the test, and is the one worth stopping for.')
}
if (keep) console.log(`\nisolated tree kept at ${TREE}`)
else rmSync(TREE, { recursive: true, force: true })
process.exit(bad.length ? 1 : 0)
