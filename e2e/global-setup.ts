// The observation sink is run-scoped: a stale file from a previous run would let a pair that was
// observed yesterday satisfy today's coverage check, which is the same "evidence that was never
// re-derived" failure one layer down. Cleared once, before the first test of the run.
import { resetObservations } from './observed.js'

export default function globalSetup(): void {
  resetObservations()
}
