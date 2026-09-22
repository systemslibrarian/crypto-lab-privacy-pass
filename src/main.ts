import './styles.css'
import './gold.css'
import { hex, keyId, pointBytes } from './oprf/voprf.js'
import { Client, Issuer, Origin, issuerCanLink, serializeRequest, serializeResponse, serializeToken, type Issuance } from './pass/privacy-pass.js'

const challenge = { issuerName: 'issuer.privacy-pass.test', originInfo: 'news.example', redemptionContext: new Uint8Array() }
const issuer = new Issuer(0x123456789abcdef123456789abcdef123456789abcdef123456789abcdefn)
const origin = new Origin()
let issuance: Issuance | undefined
let partitioned: Array<{ client: string; issuer: Issuer; issuance: Issuance; origin: Origin }> = []
let skipped: { issuance: Issuance; verdict: { ok: boolean; reason: string } } | undefined
let mode: 'private' | 'unblinded' | 'partitioned' | 'substituted' = 'private'
let redemptions = 0

// The per-client-key fixture used to be two clients, hard-coded, with no way to run it at any
// other size. "One drawn link per partition" is not falsifiable at a single size: a literal 2 in
// the diagram call and a measured bucket count are the same number in every run the page could
// reach, so the claim beside the number said more than the page could show. The roster is a list
// and the size is a control, so the two readings separate.
const PARTITION_ROSTER = [
  { client: 'Alice', secret: 0xaaa111n },
  { client: 'Bob', secret: 0xbbb222n },
  { client: 'Carol', secret: 0xccc333n },
  { client: 'Dave', secret: 0xddd444n },
]
const CLIENT_COUNTS = [2, 3, 4]
let clientCount = 2

const $ = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!
const short = (value: Uint8Array | string, length = 18): string => {
  const source = typeof value === 'string' ? value : hex(value)
  return `${source.slice(0, length)}...${source.slice(-8)}`
}
type Result = 'good' | 'alarm' | 'neutral'

// A verdict's words and its state are ONE claim, so one writer sets both. `data-result` is the
// machine-readable half of what the palette already says, and e2e/expect-verdict.ts asserts text,
// attribute and palette together: a mutation that flips the sentence while leaving the pass
// styling behind has to fail, not be recorded as a kill.
const setVerdict = (selector: string, base: string, result: Result, text?: string): void => {
  const element = $(selector)
  element.className = `${base} ${result}`
  element.setAttribute('data-result', result)
  if (text !== undefined) element.textContent = text
}
// A measurement's number and the sentence around it are one claim too: the value is published as
// `data-value`, and it must also appear in the text a reader can see.
const setClaim = (selector: string, value: string | number, text: string): void => {
  const element = $(selector)
  element.setAttribute('data-value', String(value))
  element.textContent = text
}
const status = (text: string, intact = true): void => setVerdict('#status', 'status', intact ? 'good' : 'alarm', text)

// Every wire value the page prints is printed with its own measured length, never with a literal
// typed beside it: the number a reader sees is `bytes.length`, and the oracle re-derives the same
// number from the RFC 9578 field list instead of copying it.
const wire = (value: Uint8Array): { length: number; text: string } => ({ length: value.length, text: `${hex(value)} · ${value.length} bytes` })

function render(): void {
  const publishedKey = wire(pointBytes(issuer.publicKey))
  const tokenKeyId = wire(keyId(issuer.publicKey))
  const katTotal = __RFC9497_VECTOR_COUNT__ + __RFC9578_VECTOR_COUNT__
  $('#app').innerHTML = `
    <header class="cl-hero">
      <div class="cl-hero-main"><h1 class="cl-hero-title">Privacy Pass</h1><p class="cl-hero-sub">Anonymous tokens · VOPRF · RFC 9578</p><p class="cl-hero-desc">Blind a token request, have the issuer evaluate it under a key it must prove it used, redeem it elsewhere, then ask both services to pool their ledgers and try to match a request.</p></div>
      <aside class="cl-hero-why" aria-label="Why it matters"><span class="cl-hero-why-label">WHY IT MATTERS</span><p class="cl-hero-why-text">This is the token behind CAPTCHA-free anti-bot and rate-limit checks that need a signal without needing an identity. Remove the blinding and the wire format stays familiar, but the privacy guarantee disappears.</p></aside>
    </header>
    <section class="intro" aria-labelledby="what-title"><p class="eyebrow">WHAT YOU ARE WATCHING</p><h2 id="what-title">A receipt with no name on it</h2><p>An issuer vouches that it evaluated one request. An origin can verify the resulting token, but a correctly blinded request gives the issuer nothing it can match to that redemption. All three roles below run locally in this browser session; no request leaves this page.</p></section>
    <section class="controls" aria-label="Experiment controls"><fieldset><legend>Experiment mode</legend><label><input type="radio" name="mode" value="private" checked> Private issuance</label><label><input type="radio" name="mode" value="unblinded"> <strong>BROKEN:</strong> remove blinding</label><label><input type="radio" name="mode" value="partitioned"> <strong>BROKEN:</strong> per-client published key</label><label><input type="radio" name="mode" value="substituted"> <strong>BROKEN:</strong> unpublished issuer key</label></fieldset><fieldset id="client-roster"><legend>Clients in the per-client-key fixture</legend>${CLIENT_COUNTS.map((count) => `<label><input type="radio" name="clients" value="${count}"${count === clientCount ? ' checked' : ''}${mode === 'partitioned' ? '' : ' disabled'}> ${count} clients</label>`).join('')}</fieldset><div class="command-row"><button id="issue" type="button">1. Issue token</button><button id="redeem" type="button" disabled>2. Redeem at origin</button><button id="link" type="button" disabled>3. Try to link ledgers</button><button id="replay" type="button" disabled>Replay token</button></div><p id="status" class="status neutral" data-verdict="status" data-result="neutral" role="status" aria-live="polite">Ready. Issue a token to begin.</p></section>
    <section class="flow" aria-label="Protocol flow"><article><span class="step">01</span><h2>Client blinds</h2><p id="client-detail" data-result-region="client detail">The nonce and challenge become an input point, multiplied by a fresh secret blind.</p></article><article><span class="step">02</span><h2>Issuer proves</h2><p id="issuer-detail" data-result-region="issuer detail">It sees only a blinded point and returns an evaluation with a DLEQ proof.</p></article><article><span class="step">03</span><h2>Origin redeems</h2><p id="origin-detail" data-result-region="origin detail">It privately re-evaluates the token input and records the nonce once.</p></article></section>
    <section class="ledgers" aria-label="Role ledgers"><article class="ledger"><div class="ledger-head"><p class="eyebrow">ISSUER LEDGER</p><span>What it received</span></div><div id="issuer-ledger" class="ledger-body" data-result-region="issuer ledger" role="region" tabindex="0" aria-label="Issuer ledger"><p class="empty">No issuance yet.</p></div></article><article class="ledger"><div class="ledger-head"><p class="eyebrow">ORIGIN LEDGER</p><span>What it verified</span></div><div id="origin-ledger" class="ledger-body" data-result-region="origin ledger" role="region" tabindex="0" aria-label="Origin ledger"><p class="empty">No redemption yet.</p></div></article></section>
    <div id="link-map" class="link-map neutral" data-verdict="link-map" data-result="neutral" data-result-region="ledger link map" role="img" aria-label="No ledger comparison has run"><p>Run “Try to link ledgers” to compare the values both parties hold.</p></div>
    <section class="verdicts" aria-label="Protocol verdicts" data-result-region="protocol verdicts"><div id="dleq" class="verdict neutral" data-verdict="dleq" data-result="neutral">DLEQ PROOF · waiting</div><div id="redeem-verdict" class="verdict neutral" data-verdict="redemption" data-result="neutral">REDEMPTION · waiting</div><div id="link-verdict" class="verdict neutral" data-verdict="linkage" data-result="neutral">COLLUSION CHECK · waiting</div></section>
    <p id="negative-claim" class="negative-claim" data-verdict="negative-claim" data-result="alarm" hidden>The DLEQ proof shows the issuer used the key it published to this client; it does not show it published the same key to every client. Key consistency is outside RFC 9578 and outside this page.</p>
    <details><summary>Inspect the real wire values and scope</summary><dl data-result-region="wire values"><dt>Official known-answer tests</dt><dd id="kat-count" data-claim="kat-count" data-value="${katTotal}">${katTotal} vectors: ${__RFC9497_VECTOR_COUNT__} RFC 9497 P-384 VOPRF + ${__RFC9578_VECTOR_COUNT__} RFC 9578 type-0x0001 issuance</dd><dt>Published P-384 key</dt><dd id="pk" data-claim="published-key" data-value="${publishedKey.length}">${publishedKey.text}</dd><dt>RFC 9578 token key id</dt><dd id="key-id" data-claim="key-id" data-value="${tokenKeyId.length}">${tokenKeyId.text}</dd><dt>TokenRequest</dt><dd id="wire-request" data-claim="wire-request" data-value="">Issue a token to populate.</dd><dt>TokenResponse</dt><dd id="wire-response" data-claim="wire-response" data-value="">Issue a token to populate.</dd><dt>Token</dt><dd id="wire-token" data-claim="wire-token" data-value="">Issue a token to populate.</dd><dt>What this is not</dt><dd>No HTTP transport, attester, rate-limit model, key-consistency protocol, batched issuance, or Blind RSA implementation is included. This is not production crypto.</dd></dl></details>
    <section class="comparison"><h2>Type 0x0001 is not type 0x0002</h2><p>This page implements VOPRF(P-384, SHA-384), whose origin verifies with the issuer secret key. RFC 9474 Blind RSA tokens are publicly verifiable and use a different construction; see the Crypto Lab Blind Sign demo for that comparison.</p></section>
    <footer class="scripture-footer"><p>So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31</p></footer>`
  // Changing the mode and changing the fixture size retire the same things: a rendered verdict
  // describes the run that produced it, so it may not outlive the parameters of that run.
  const retire = (message: string): void => {
    issuance = undefined
    partitioned = []
    skipped = undefined
    redemptions = 0
    $('#redeem').setAttribute('disabled', '')
    $('#link').setAttribute('disabled', '')
    $('#replay').setAttribute('disabled', '')
    $('#issuer-ledger').innerHTML = '<p class="empty">Prior verdict retired after mode change.</p>'
    $('#origin-ledger').innerHTML = '<p class="empty">Prior verdict retired after mode change.</p>'
    $('#link-map').innerHTML = '<p>Prior link result retired after mode change.</p>'
    setVerdict('#link-map', 'link-map', 'neutral')
    $('#link-map').setAttribute('aria-label', 'Prior ledger link result retired')
    $('#negative-claim').setAttribute('hidden', '')
    status(message)
  }
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((input) => input.addEventListener('change', () => {
    mode = input.value as typeof mode
    document.querySelectorAll<HTMLInputElement>('input[name="clients"]').forEach((radio) => { radio.disabled = mode !== 'partitioned' })
    retire('Prior result retired. Issue a new token for this mode.')
  }))
  document.querySelectorAll<HTMLInputElement>('input[name="clients"]').forEach((input) => input.addEventListener('change', () => {
    clientCount = Number(input.value)
    retire(`Prior result retired. The fixture will publish a different key to each of ${clientCount} clients.`)
  }))
  $('#issue').addEventListener('click', issue)
  $('#redeem').addEventListener('click', redeem)
  $('#link').addEventListener('click', link)
  $('#replay').addEventListener('click', replay)
}

function issue(): void {
  redemptions = 0
  try {
    if (mode === 'partitioned') {
      partitioned = PARTITION_ROSTER.slice(0, clientCount).map(({ client, secret }) => {
        const clientIssuer = new Issuer(secret)
        return { client, issuer: clientIssuer, issuance: new Client().issue(clientIssuer, challenge), origin: new Origin() }
      })
      $('#issuer-ledger').innerHTML = partitioned.map(({ client, issuer: clientIssuer }) => `<p><b>${client}</b> · proof verified</p><code>published key id: ${short(keyId(clientIssuer.publicKey))}</code>`).join('')
      $('#client-detail').textContent = 'Every client receives a valid proof under the different key published to it.'
      $('#issuer-detail').textContent = 'BROKEN: the issuer partitions clients with one valid key each; no client sees the inconsistency.'
      setVerdict('#dleq', 'verdict', 'good', 'DLEQ PROOFS · ALL VERIFIED')
      $('#negative-claim').removeAttribute('hidden')
      $('#redeem').removeAttribute('disabled'); $('#link').removeAttribute('disabled'); $('#replay').setAttribute('disabled', '')
      status(`All ${partitioned.length} clients finalized valid tokens. The missing property is global key consistency.`)
    } else if (mode === 'substituted') {
      const rogue = new Issuer(0xfeedfacecafebeef0123456789abcdefn)
      const careless = new Client().issue(rogue, challenge)
      skipped = { issuance: careless, verdict: new Origin().redeem(careless.token, challenge, issuer) }
      new Client().issue(rogue, challenge, { verifyKey: issuer.publicKey })
      setVerdict('#dleq', 'verdict', 'alarm', 'DLEQ PROOF · ACCEPTED AN UNPUBLISHED KEY')
      $('#client-detail').textContent = 'BROKEN: the client finalized against a key it was never told to trust.'
      status('ALARM: DLEQ verification against the published key should have failed and did not.', false)
    } else {
      const blindScalar = mode === 'unblinded' ? 1n : undefined
      issuance = new Client().issue(issuer, challenge, { blindScalar })
      $('#issuer-ledger').innerHTML = `<p><b>Request received</b></p><code>blinded element: ${short(pointBytes(issuance.request.blinded))}</code><p>truncated key id: <b data-claim="truncated-key-id" data-value="${issuance.request.truncatedTokenKeyId}">${issuance.request.truncatedTokenKeyId}</b></p><p>It cannot see the nonce or challenge digest.</p>`
      // The broken blind is PRINTED FROM THE SCALAR THAT WAS USED, not from a literal typed into
      // the sentence: changing the scalar has to change the number a reader sees.
      $('#client-detail').innerHTML = blindScalar === undefined
        ? 'Fresh random blind multiplied the hash-to-group token input.'
        : `BROKEN: the blind scalar is <b data-claim="blind-scalar" data-value="${blindScalar}">${blindScalar}</b>, so the issuer receives the raw hash-to-group point.`
      $('#issuer-detail').textContent = 'Evaluated blinded point and generated a DLEQ proof under the published key.'
      setVerdict('#dleq', 'verdict', 'good', 'DLEQ PROOF · VERIFIED')
      const request = wire(serializeRequest(issuance.request))
      const response = wire(serializeResponse(issuance.response))
      const token = wire(serializeToken(issuance.token))
      setClaim('#wire-request', request.length, request.text)
      setClaim('#wire-response', response.length, response.text)
      setClaim('#wire-token', token.length, token.text)
      $('#redeem').removeAttribute('disabled'); $('#link').removeAttribute('disabled'); $('#replay').removeAttribute('disabled')
      status(mode === 'unblinded' ? 'BROKEN mode issued: the request is directly linkable.' : 'Token finalized after the real DLEQ proof verified.')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    setVerdict('#dleq', 'verdict', 'good', 'DLEQ PROOF · REJECTED AS DESIGNED')
    $('#issuer-ledger').innerHTML = skipped
      ? `<p><b>BROKEN unpublished-key mode</b></p><p>The issuer answered with a key other than the one this client was told to trust.</p><code>trusted key id: ${short(keyId(issuer.publicKey))}</code><code>answered under: ${short(skipped.issuance.token.tokenKeyId)}</code>`
      : '<p><b>Issuance aborted</b></p><p>The client refused to finalize a token.</p>'
    $('#client-detail').textContent = 'Client aborted before finalization.'
    $('#issuer-detail').textContent = 'BROKEN: the evaluation carries a valid proof, but under an unpublished key.'
    if (skipped) {
      $('#origin-ledger').innerHTML = `<p><b>A client that skipped the proof check</b> · finalized a token anyway</p><code>token key id: ${short(skipped.issuance.token.tokenKeyId)}</code><p>${skipped.verdict.reason}</p>`
      $('#origin-detail').textContent = skipped.verdict.reason
      setVerdict('#redeem-verdict', 'verdict', skipped.verdict.ok ? 'alarm' : 'good', `SKIPPED-CHECK TOKEN · ${skipped.verdict.ok ? 'ACCEPTED' : 'REFUSED'}`)
    }
    status(`${message}. A careful client receives no token.`, true)
  }
}
function redeem(): void {
  if (partitioned.length) {
    const results = partitioned.map((entry) => ({ ...entry, result: entry.origin.redeem(entry.issuance.token, challenge, entry.issuer) }))
    $('#origin-ledger').innerHTML = results.map(({ client, issuance: clientIssuance, result }) => `<p><b>${client}</b> · ${result.ok ? 'verified' : 'refused'}</p><code>token key id: ${short(clientIssuance.token.tokenKeyId)}</code>`).join('')
    const allVerified = results.every(({ result }) => result.ok)
    setVerdict('#redeem-verdict', 'verdict', allVerified ? 'good' : 'alarm', `REDEMPTIONS · ${allVerified ? 'ALL VERIFIED' : 'REFUSED'}`)
    $('#origin-detail').textContent = 'Every authenticator verifies and every fresh nonce is accepted.'
    status(allVerified ? `All ${results.length} tokens redeemed successfully under their respective issuer keys.` : 'A partition fixture redemption failed.', allVerified)
    return
  }
  if (!issuance) return
  // The colour tracks integrity, not the return value: a first redemption must be accepted and
  // every later presentation of the same token must be refused. Both of those are the origin
  // working, so both render green; the alarm is reserved for the origin disagreeing with that.
  const expectedOk = redemptions === 0
  const result = origin.redeem(issuance.token, challenge, issuer)
  redemptions += 1
  const intact = result.ok === expectedOk
  $('#origin-ledger').innerHTML = `<p><b>${result.ok ? 'Token redeemed' : 'Token refused'}</b></p><code>nonce: ${short(issuance.token.nonce)}</code><code>authenticator: ${short(issuance.token.authenticator)}</code><p>${result.reason}</p>`
  $('#origin-detail').textContent = result.reason
  setVerdict('#redeem-verdict', 'verdict', intact ? 'good' : 'alarm', `REDEMPTION · ${result.ok ? 'VERIFIED' : 'REFUSED'}`)
  status(intact ? result.reason : `INTEGRITY ALARM: the origin ${result.ok ? 'accepted' : 'refused'} a presentation it should have ${expectedOk ? 'accepted' : 'refused'}. ${result.reason}`, intact)
}
function link(): void {
  if (partitioned.length) {
    const buckets = new Set(partitioned.map(({ issuance: clientIssuance }) => hex(clientIssuance.token.tokenKeyId)))
    const linked = buckets.size === partitioned.length
    setVerdict('#link-verdict', 'verdict', linked ? 'alarm' : 'good', linked ? 'PROOFS VERIFIED · AND PARTITIONED' : 'COLLUSION CHECK · NO PARTITION')
    // One line per bucket that actually separates a client, counted from the buckets themselves.
    // A literal here could not tell "one line per partition" from "always two".
    $('#link-map').innerHTML = linkDiagram(linked ? buckets.size : 0, partitioned.map(({ client }) => `${client} key bucket`))
    setVerdict('#link-map', 'link-map', linked ? 'alarm' : 'good')
    $('#link-map').setAttribute('aria-label', linked ? `${buckets.size} alarm lines link the clients by different issuer keys` : 'No ledger links found')
    status(linked ? 'ALARM: colluding issuer and origin sort every redemption by the client-specific key id.' : 'No client-specific key partition was found.', !linked)
    return
  }
  if (!issuance) return
  const linked = issuerCanLink(issuance)
  setVerdict('#link-verdict', 'verdict', linked ? 'alarm' : 'good', linked ? 'COLLUSION CHECK · LINKED: BLINDING WAS REMOVED' : 'COLLUSION CHECK · NO COMPUTABLE MATCH')
  $('#link-map').innerHTML = linkDiagram(linked ? 1 : 0, linked ? ['raw input point matches'] : [])
  setVerdict('#link-map', 'link-map', linked ? 'alarm' : 'good')
  $('#link-map').setAttribute('aria-label', linked ? 'One alarm line links the raw request point to redemption' : 'No ledger links found')
  status(linked ? 'ALARM: issuer hash-to-group value equals the origin-computable input point.' : 'Issuer and origin have no shared equality-testable value.', !linked)
}
function replay(): void { if (issuance) redeem() }

function linkDiagram(count: number, labels: string[]): string {
  const lines = Array.from({ length: count }, (_, index) => {
    const y = count === 1 ? 50 : 15 + index * (70 / (count - 1))
    return `<g class="computed-link"><line x1="18" y1="${y}" x2="182" y2="${y}"/><circle cx="18" cy="${y}" r="4"/><circle cx="182" cy="${y}" r="4"/></g>`
  }).join('')
  // The count is rendered as its own measurement, including when it is zero: "no line was drawn"
  // is a result, and an unmarked number would be outside every coverage rule this suite applies.
  const caption = count === 0
    ? 'no equality-testable values cross the ledgers'
    : labels.join(' · ')
  const svg = count === 0 ? '' : `<svg viewBox="0 0 200 100" aria-hidden="true" focusable="false">${lines}</svg>`
  return `${svg}<p class="${count === 0 ? 'no-match' : 'link-labels'}" data-claim="computed-links" data-value="${count}">${count} computed link${count === 1 ? '' : 's'} · ${caption}</p>`
}

render()