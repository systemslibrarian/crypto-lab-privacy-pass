// Every test records THAT IT RAN, before it does anything else.
//
// Without this the coverage check cannot tell "the killing test ran and never asserted its
// marker" from "the killing test was not part of this run", and would have to treat the second
// as clean — a checker reporting green because it could not look, which is the defect this lane
// exists to close. With it, both are named failures.
import { test as base } from '@playwright/test'
import { record, specOf } from './observed.js'

export const test = base.extend<{ recordRun: void }>({
  recordRun: [async ({}, use, testInfo) => {
    record({ kind: 'test', spec: specOf(testInfo.file), test: testInfo.title })
    await use()
  }, { auto: true }],
})

export { expect } from '@playwright/test'
