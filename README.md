# Privacy Pass

## What It Is

An in-browser teaching demo of RFC 9578 token type `0x0001`: VOPRF(P-384, SHA-384). It performs real P-384 group arithmetic and RFC 9380 hash-to-curve through `@noble/curves`, while the blind, evaluation, DLEQ proof, finalization, token construction, and private redemption checks are visible in this repository. It is not production crypto: it has no HTTP transport, attester, rate-limit deployment model, key-consistency protocol, batching, or server-side protection.

## Exhibits

1. Issue a token to watch the client blind its token input, the issuer evaluate it, and the client reject or accept the DLEQ proof before finalizing.
2. Redeem the token at a separate origin. The origin recomputes the VOPRF output with the issuer key and rejects a reused nonce in the browser-session spent set.
3. Pool the issuer and origin ledgers. Correct blinding leaves no equality-testable link; choosing `BROKEN: remove blinding` makes the matching input point visible and triggers an alarm.
4. Choose `BROKEN: per-client published key` to give Alice and Bob different issuer keys. Both DLEQ proofs verify and both tokens redeem, but a colluding issuer and origin can partition the redemptions by key id.
5. Choose `BROKEN: unpublished issuer key` to have the issuer answer under a key it never published. The DLEQ proof is valid under the issuer's own key and worthless against the published one, so the careful client aborts before finalizing, and the sub-panel shows the origin refusing the token a client that skipped that check would have kept.

## When to Use It

Use this to learn why Privacy Pass can convey an issuer's authorization without carrying an account identity into a different origin. Do not use this page as an implementation, interoperability target, or evidence that a deployment provides anonymity: deployment policy and key consistency are outside its scope.

## Live Demo

https://systemslibrarian.github.io/crypto-lab-privacy-pass/

Issue, redeem, replay, and deliberately break a token flow in one browser session. The three roles are local teaching objects, not network services.

## What Can Go Wrong

Removing the blind makes an issuer's input point directly comparable with a redemption. Skipping DLEQ verification lets an issuer evaluate under a different key than the one it published. A valid DLEQ proof for one client does not prove the issuer used that same key for every client; key consistency is deliberately not implemented here.

## Real-World Usage

Privacy Pass protocols support anonymous authorization tokens for applications such as challenge and abuse mitigation. RFC 9576 defines the architecture, RFC 9577 defines common token structures, and RFC 9578 defines this VOPRF token type. Type `0x0002` uses [Blind RSA](https://www.rfc-editor.org/rfc/rfc9474), is publicly verifiable, and is not implemented here.

## How to Run Locally

```bash
npm install
npm run dev
```

## Related Demos

See the Crypto Lab [Blind Sign](https://crypto-lab.systemslibrarian.dev/) and OPAQUE demonstrations for adjacent ideas. Blind RSA signatures and password OPRFs are different constructions with different privacy properties.

## Build & Verify

```bash
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:a11y
```

The unit suite has 16 tests, including all 3 RFC 9497 Appendix A.4.2 P-384 VOPRF vectors and all 5 RFC 9578 Appendix A.1 type-`0x0001` issuance vectors. It also covers complete wire parsing and serialization, batch proofs, value-derived linkability, proof failures, and replay rejection. The Playwright gate runs 12 tests from 11 declarations — the overflow check runs at two viewports — covering WCAG 2.1 A/AA on every reachable protocol state, arithmetic palette contrast, responsive overflow, complete rendered wire lengths, all three broken modes, visual link counts, the fail-closed abort, replay, verdict retirement, and `[hidden]` behavior. The implementation follows [RFC 9497](https://www.rfc-editor.org/rfc/rfc9497), [RFC 9578](https://www.rfc-editor.org/rfc/rfc9578), and [RFC 9380](https://www.rfc-editor.org/rfc/rfc9380).

## Performance

P-384 hash-to-curve and scalar multiplication run on demand when an experiment button is pressed. No secrets or spent-token state are persisted beyond the current page session.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*