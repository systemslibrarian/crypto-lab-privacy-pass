import './styles.css'
import './gold.css'
import { hex, keyId, pointBytes } from './oprf/voprf.js'
import { Client, Issuer, Origin, issuerCanLink, serializeRequest, serializeResponse, serializeToken, type Issuance } from './pass/privacy-pass.js'

const challenge = { issuerName: 'issuer.privacy-pass.test', originInfo: 'news.example', redemptionContext: new Uint8Array() }
const issuer = new Issuer(0x123456789abcdef123456789abcdef123456789abcdef123456789abcdefn)
const origin = new Origin()
let issuance: Issuance | undefined
let partitioned: Array<{ client: string; issuer: Issuer; issuance: Issuance; origin: Origin }> = []
let mode: 'private' | 'unblinded' | 'partitioned' = 'private'

const $ = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!
const short = (value: Uint8Array | string, length = 18): string => {
  const source = typeof value === 'string' ? value : hex(value)
  return `${source.slice(0, length)}...${source.slice(-8)}`
}
const status = (text: string, good = true): void => {
  $('#status').textContent = text
  $('#status').className = `status ${good ? 'good' : 'alarm'}`
}

function render(): void {
  $('#app').innerHTML = `
    <header class="cl-hero">
      <div class="cl-hero-main"><h1 class="cl-hero-title">Privacy Pass</h1><p class="cl-hero-sub">Anonymous tokens · VOPRF · RFC 9578</p><p class="cl-hero-desc">Blind a token request, have the issuer evaluate it under a key it must prove it used, redeem it elsewhere, then ask both services to pool their ledgers and try to match a request.</p></div>
      <aside class="cl-hero-why" aria-label="Why it matters"><span class="cl-hero-why-label">WHY IT MATTERS</span><p class="cl-hero-why-text">This is the token behind CAPTCHA-free anti-bot and rate-limit checks that need a signal without needing an identity. Remove the blinding and the wire format stays familiar, but the privacy guarantee disappears.</p></aside>
    </header>
    <section class="intro" aria-labelledby="what-title"><p class="eyebrow">WHAT YOU ARE WATCHING</p><h2 id="what-title">A receipt with no name on it</h2><p>An issuer vouches that it evaluated one request. An origin can verify the resulting token, but a correctly blinded request gives the issuer nothing it can match to that redemption. All three roles below run locally in this browser session; no request leaves this page.</p></section>
    <section class="controls" aria-label="Experiment controls"><fieldset><legend>Experiment mode</legend><label><input type="radio" name="mode" value="private" checked> Private issuance</label><label><input type="radio" name="mode" value="unblinded"> <strong>BROKEN:</strong> remove blinding</label><label><input type="radio" name="mode" value="partitioned"> <strong>BROKEN:</strong> per-client published key</label></fieldset><div class="command-row"><button id="issue" type="button">1. Issue token</button><button id="redeem" type="button" disabled>2. Redeem at origin</button><button id="link" type="button" disabled>3. Try to link ledgers</button><button id="replay" type="button" disabled>Replay token</button></div><p id="status" class="status" role="status" aria-live="polite">Ready. Issue a token to begin.</p></section>
    <section class="flow" aria-label="Protocol flow"><article><span class="step">01</span><h2>Client blinds</h2><p id="client-detail">The nonce and challenge become an input point, multiplied by a fresh secret blind.</p></article><article><span class="step">02</span><h2>Issuer proves</h2><p id="issuer-detail">It sees only a blinded point and returns an evaluation with a DLEQ proof.</p></article><article><span class="step">03</span><h2>Origin redeems</h2><p id="origin-detail">It privately re-evaluates the token input and records the nonce once.</p></article></section>
    <section class="ledgers" aria-label="Role ledgers"><article class="ledger"><div class="ledger-head"><p class="eyebrow">ISSUER LEDGER</p><span>What it received</span></div><div id="issuer-ledger" class="ledger-body" role="region" tabindex="0" aria-label="Issuer ledger"><p class="empty">No issuance yet.</p></div></article><article class="ledger"><div class="ledger-head"><p class="eyebrow">ORIGIN LEDGER</p><span>What it verified</span></div><div id="origin-ledger" class="ledger-body" role="region" tabindex="0" aria-label="Origin ledger"><p class="empty">No redemption yet.</p></div></article></section>
    <section class="verdicts" aria-label="Protocol verdicts"><div id="dleq" class="verdict neutral">DLEQ PROOF · waiting</div><div id="redeem-verdict" class="verdict neutral">REDEMPTION · waiting</div><div id="link-verdict" class="verdict neutral">COLLUSION CHECK · waiting</div></section>
    <p id="negative-claim" class="negative-claim" hidden>The DLEQ proof shows the issuer used the key it published to this client; it does not show it published the same key to every client. Key consistency is outside RFC 9578 and outside this page.</p>
    <details><summary>Inspect the real wire values and scope</summary><dl><dt>Published P-384 key</dt><dd id="pk">${hex(pointBytes(issuer.publicKey))}</dd><dt>RFC 9578 token key id</dt><dd id="key-id">${hex(keyId(issuer.publicKey))}</dd><dt>TokenRequest · 52 bytes</dt><dd id="wire-request">Issue a token to populate.</dd><dt>TokenResponse · 145 bytes</dt><dd id="wire-response">Issue a token to populate.</dd><dt>Token · 146 bytes</dt><dd id="wire-token">Issue a token to populate.</dd><dt>What this is not</dt><dd>No HTTP transport, attester, rate-limit model, key-consistency protocol, batched issuance, or Blind RSA implementation is included. This is not production crypto.</dd></dl></details>
    <section class="comparison"><h2>Type 0x0001 is not type 0x0002</h2><p>This page implements VOPRF(P-384, SHA-384), whose origin verifies with the issuer secret key. RFC 9474 Blind RSA tokens are publicly verifiable and use a different construction; see the Crypto Lab Blind Sign demo for that comparison.</p></section>
    <footer class="scripture-footer"><p>So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31</p></footer>`
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((input) => input.addEventListener('change', () => {
    mode = input.value as typeof mode
    issuance = undefined
    partitioned = []
    $('#redeem').setAttribute('disabled', '')
    $('#link').setAttribute('disabled', '')
    $('#replay').setAttribute('disabled', '')
    $('#issuer-ledger').innerHTML = '<p class="empty">Prior verdict retired after mode change.</p>'
    $('#origin-ledger').innerHTML = '<p class="empty">Prior verdict retired after mode change.</p>'
    $('#negative-claim').setAttribute('hidden', '')
    status('Prior result retired. Issue a new token for this mode.')
  }))
  $('#issue').addEventListener('click', issue)
  $('#redeem').addEventListener('click', redeem)
  $('#link').addEventListener('click', link)
  $('#replay').addEventListener('click', replay)
}

function issue(): void {
  try {
    if (mode === 'partitioned') {
      const aliceIssuer = new Issuer(0xaaa111n)
      const bobIssuer = new Issuer(0xbbb222n)
      partitioned = [
        { client: 'Alice', issuer: aliceIssuer, issuance: new Client().issue(aliceIssuer, challenge), origin: new Origin() },
        { client: 'Bob', issuer: bobIssuer, issuance: new Client().issue(bobIssuer, challenge), origin: new Origin() },
      ]
      $('#issuer-ledger').innerHTML = partitioned.map(({ client, issuer: clientIssuer }) => `<p><b>${client}</b> · proof verified</p><code>published key id: ${short(keyId(clientIssuer.publicKey))}</code>`).join('')
      $('#client-detail').textContent = 'Alice and Bob each receive a valid proof under the different key published to them.'
      $('#issuer-detail').textContent = 'BROKEN: the issuer partitions clients with two valid keys; neither client sees the inconsistency.'
      $('#dleq').className = 'verdict good'; $('#dleq').textContent = 'DLEQ PROOFS · BOTH VERIFIED'
      $('#negative-claim').removeAttribute('hidden')
      $('#redeem').removeAttribute('disabled'); $('#link').removeAttribute('disabled'); $('#replay').setAttribute('disabled', '')
      status('Both clients finalized valid tokens. The missing property is global key consistency.')
    } else {
      issuance = new Client().issue(issuer, challenge, { blindScalar: mode === 'unblinded' ? 1n : undefined })
      $('#issuer-ledger').innerHTML = `<p><b>Request received</b></p><code>blinded element: ${short(pointBytes(issuance.request.blinded))}</code><p>truncated key id: <b>${issuance.request.truncatedTokenKeyId}</b></p><p>It cannot see the nonce or challenge digest.</p>`
      $('#client-detail').textContent = mode === 'unblinded' ? 'BROKEN: blind = 1, so the issuer receives the raw hash-to-group point.' : 'Fresh random blind multiplied the hash-to-group token input.'
      $('#issuer-detail').textContent = 'Evaluated blinded point and generated a DLEQ proof under the published key.'
      $('#dleq').className = 'verdict good'; $('#dleq').textContent = 'DLEQ PROOF · VERIFIED'
      $('#wire-request').textContent = hex(serializeRequest(issuance.request))
      $('#wire-response').textContent = hex(serializeResponse(issuance.response))
      $('#wire-token').textContent = hex(serializeToken(issuance.token))
      $('#redeem').removeAttribute('disabled'); $('#link').removeAttribute('disabled'); $('#replay').removeAttribute('disabled')
      status(mode === 'unblinded' ? 'BROKEN mode issued: the request is directly linkable.' : 'Token finalized after the real DLEQ proof verified.')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    $('#dleq').className = 'verdict good'; $('#dleq').textContent = 'DLEQ PROOF · REJECTED AS DESIGNED'
    $('#issuer-ledger').innerHTML = '<p><b>BROKEN per-client key mode</b></p><p>The issuer answered with a key other than the one this client was told to trust.</p>'
    $('#client-detail').textContent = 'Client aborted before finalization.'
    status(`${message}. A careful client receives no token.`, true)
  }
}
function redeem(): void {
  if (partitioned.length) {
    const results = partitioned.map((entry) => ({ ...entry, result: entry.origin.redeem(entry.issuance.token, challenge, entry.issuer) }))
    $('#origin-ledger').innerHTML = results.map(({ client, issuance: clientIssuance, result }) => `<p><b>${client}</b> · ${result.ok ? 'verified' : 'refused'}</p><code>token key id: ${short(clientIssuance.token.tokenKeyId)}</code>`).join('')
    const allVerified = results.every(({ result }) => result.ok)
    $('#redeem-verdict').className = `verdict ${allVerified ? 'good' : 'alarm'}`
    $('#redeem-verdict').textContent = `REDEMPTIONS · ${allVerified ? 'BOTH VERIFIED' : 'REFUSED'}`
    $('#origin-detail').textContent = 'Both authenticators verify and both fresh nonces are accepted.'
    status(allVerified ? 'Both tokens redeemed successfully under their respective issuer keys.' : 'A partition fixture redemption failed.', allVerified)
    return
  }
  if (!issuance) return
  const result = origin.redeem(issuance.token, challenge, issuer)
  $('#origin-ledger').innerHTML = `<p><b>${result.ok ? 'Token redeemed' : 'Token refused'}</b></p><code>nonce: ${short(issuance.token.nonce)}</code><code>authenticator: ${short(issuance.token.authenticator)}</code><p>${result.reason}</p>`
  $('#origin-detail').textContent = result.reason
  $('#redeem-verdict').className = `verdict ${result.ok ? 'good' : 'alarm'}`
  $('#redeem-verdict').textContent = `REDEMPTION · ${result.ok ? 'VERIFIED' : 'REFUSED'}`
  status(result.reason, result.ok)
}
function link(): void {
  if (partitioned.length) {
    const buckets = new Set(partitioned.map(({ issuance: clientIssuance }) => hex(clientIssuance.token.tokenKeyId)))
    const linked = buckets.size === partitioned.length
    $('#link-verdict').className = `verdict ${linked ? 'alarm' : 'good'}`
    $('#link-verdict').textContent = linked ? 'PROOFS VERIFIED · AND PARTITIONED' : 'COLLUSION CHECK · NO PARTITION'
    status(linked ? 'ALARM: colluding issuer and origin sort both redemptions by the client-specific key id.' : 'No client-specific key partition was found.', !linked)
    return
  }
  if (!issuance) return
  const linked = issuerCanLink(issuance)
  $('#link-verdict').className = `verdict ${linked ? 'alarm' : 'good'}`
  $('#link-verdict').textContent = linked ? 'COLLUSION CHECK · LINKED: BLINDING WAS REMOVED' : 'COLLUSION CHECK · NO COMPUTABLE MATCH'
  status(linked ? 'ALARM: issuer hash-to-group value equals the origin-computable input point.' : 'Issuer and origin have no shared equality-testable value.', !linked)
}
function replay(): void { if (issuance) redeem() }

render()