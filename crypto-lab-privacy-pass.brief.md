# Privacy Pass — build brief for `crypto-lab-privacy-pass`

Save this file as `brief.md` at the root of `crypto-lab-privacy-pass`. The binding spec is the copy of `_MASTER-TEMPLATE.md` in this repo (status 2026-08-02); this brief supplies only the demo-specific facts. Where the two touch, the template wins; where the template and the catalog `CLAUDE.md` touch, `CLAUDE.md` wins. If `audits/kickoff.md` is also present in this repo, it may be used instead of the prompt below — it reads `./brief.md` itself.

## Kickoff prompt — paste this, with the template in the repo

```text
Build a new Crypto Lab browser demo (Vite + TypeScript, static site, no backend).

Read _MASTER-TEMPLATE.md (copied into this repo — check audits/ and the repo root) in
full and treat it as the BINDING spec. Build to every standard in it, in this order:

  1. §1 Build — real crypto only (WebCrypto or a named, justified library; hand-roll
     the inspectable teaching parts; NEVER simulate or fake math). Runnable tests that
     actually pass, including spec KATs (state the count). Mount content at id="app";
     define --accent on :root.
  2. §3 Look — add the standard top bar (copy the header from any existing lab and
     adapt it) and the standardized hero (short-name <h1> + spec subtitle + "Why it
     matters" box beside it; title size capped at clamp(1.6rem,3.8vw,2.7rem)); theme
     contract; scripture footer; head/favicon. Do NOT invent a new header design and do
     NOT add a theme toggle — match the fleet's cl-topbar.
  3. §2 Teach — SHOW the one headline mechanism (animate/step it, never assert it in
     prose or raw hex); add a plain-language "what is this / why it matters" intro and a
     break-it-yourself interaction against the real crypto; no decorative/idle animation;
     pitch to a college newcomer while rewarding an expert (progressive disclosure).
  4. §4 Accessibility — wire the WCAG 2.1 AA gate and author to its checklist.
     `npm run build` then `npm run test:a11y` MUST pass with zero violations.
  5. §5 README (the standard sections) and §6 Deploy (Actions-based Pages, a11y-gated).
  6. §6.1 + §6.2 Dependency automation — REQUIRED, not optional. Ship
     .github/dependabot.yml with the grouped config, add the dependabot-auto-merge job
     to whichever workflow runs the gate on pull_request, and have that job dispatch the
     deploy after it merges. Also: the workflow must trigger on pull_request as well as
     push, the deploy job must be gated to `github.event_name != 'pull_request'`, the concurrency
     group must include ${{ github.ref }}, and the deploy workflow must accept
     workflow_dispatch. Omitting any of these is how a lab starts opening one pull request
     per dependency with no CI signal on any of them.

Hard rules: do NOT dumb down the crypto to make a visual simpler; honest scoping in-page
and in the README ("not production", what's real vs simulated, what it does NOT prove).
Do NOT weaken a gate to get a green run — no skipped tests, no lowered coverage threshold,
no disabled lint rule, no re-recorded a11y baseline, no continue-on-error. If a bump or a
change cannot pass honestly, leave it failing and say so.
When done, report a one-line summary with the test count, and confirm all four of
grouping / auto-merge / PR gate / workflow_dispatch are present.

The rest of ./brief.md — the §1 sections, hero copy, claims suite, negative claim,
pre-build verification and citations below the DEMO BRIEF — is part of this brief.
Read it in full before building; run its pre-build checks first and report them.

DEMO BRIEF:
NEW DEMO BRIEF
- Repo name:         crypto-lab-privacy-pass
- Short name (H1):   Privacy Pass
- Subtitle:          Anonymous tokens · VOPRF(P-384, SHA-384) · RFC 9578 · RFC 9497
- One-liner:         Issues and redeems RFC 9578 type-0x0001 tokens with a real VOPRF(P-384, SHA-384) — blind, evaluate, DLEQ proof, finalize, redeem, double-spend check — across a Client, an Issuer and an Origin, then shows exactly which removed step lets the issuer link a redemption to an issuance.
- Concept to teach:  A token can prove "someone the issuer trusted asked for this" without the issuer, the origin, or both together being able to say which someone. Unlinkability is a property of the blinding, not of the token.
- Primitives/spec:   RFC 9497 (OPRF/VOPRF, ciphersuite P384-SHA384, Appendix A test vectors); RFC 9578 §5 (VOPRF issuance, token type 0x0001, Nk = 48, test vectors in its appendix); RFC 9577 (token and TokenChallenge structures); RFC 9576 (architecture and roles); RFC 9380 hash-to-curve for P-384 (suite and DST per RFC 9497). Group arithmetic and hash-to-curve from @noble/curves p384 (named, justified); Blind / BlindEvaluate / DLEQ generate and verify / Finalize hand-rolled; SHA-384 via WebCrypto or @noble/hashes. RFC 9474 (RSA blind signatures) for the comparison table only.
- Accent (--accent): #F2C14E
- Favicon emoji:     🎟️
- In scope:          Three-role stage in one page (Client, Issuer, Origin; all in memory, stated on the page). TokenChallenge → TokenRequest → TokenResponse → Token exactly per RFC 9578 §5, including token_input = token_type ‖ nonce ‖ challenge_digest ‖ token_key_id, the truncated key id, and the DLEQ proof the client must verify before finalizing. Redemption by the origin re-evaluating with skI (privately verifiable). Per-session nonce set for double-spend detection. Two ledgers — what the issuer saw at issuance, what the origin saw at redemption — with a "Try to link" action for the colluding issuer + origin. Broken modes, each visibly marked BROKEN and never default: (a) blinding removed (blind = 1) → the ledgers link; (b) issuer evaluates under a per-client key → the client's DLEQ check against the published key fails and issuance aborts, with a sub-panel showing what a client that skips the check gets; (c) replay of a redeemed token → origin rejects. A one-screen comparison of type 0x0002 Blind RSA (publicly verifiable, RFC 9474) against 0x0001, cross-linked to Blind Sign, not implemented.
- Non-goals:         HTTP transport and the RFC 9577 authentication headers (structures only, no HTTP); Blind RSA 0x0002 implementation; the Attester role and rate-limited / anonymous-origin deployment models; batched issuance; key-consistency protocols; any claim about a specific deployment's internals.
```

## Rules this brief follows — keep them while building

This brief asserts no counts about the catalog. Every "the catalog has / lacks X" sentence is written as a grep to run, because the author could not run it. Run each pre-build check and report the result before writing code. If a grep shows the headline mechanism is already taught by a live card, stop and report; do not build a duplicate.

In addition to this lab's own sections below:

1. Port: `grep -rhoE "localhost:[0-9]+" ../crypto-lab-*/playwright.config.ts | sort -u`, pick an unused port in 4600–4700, commit it (template §4.1). Never the Vite default 4173.
2. Accessibility gate: copy `e2e/gate.ts`, `contrast.ts`, `nontext.ts`, `nontext-baseline.ts`, `a11y.spec.ts` from `crypto-lab-schnorr-forge` and rewrite every lab-specific passage (§4.1). Do not copy the gate from any other lab.
3. Claims suite in `e2e/claims.spec.ts` (§4.1b), mutation discipline (§4.1c), and the negative claim with its evidence fixture (§4.1d). The twin-verdict wording in this brief is a shape, not a string to hard-code.
4. README per §5; deploy per §6 with `.github/dependabot.yml`, the auto-merge job, the deploy dispatch, `timeout-minutes` on the job, `LICENSE`, `.gitignore`.
5. After the lab is live: the catalog card, then the five checkers run from the catalog repo (`readme-sync`, `corpus-sync`, `concept-sync`, `theme-sync`, `fleet-sync`). That step is done in `crypto-lab/`, not here; do not edit shared catalog files from this repo.
6. Category placement below is a proposal. Check the live chip list and section list before adding a chip; if a proposed chip does not exist, report the resulting chip-bar split rather than creating it silently. If the catalog keeps a concept-coverage document, the new concept boundary is added there in the same commit as the card.
7. Each non-goal in the SCOPE list gets its one-line "what this isn't" note in the UI (§1).
8. No emoji anywhere in content; the favicon data-URI is the only sanctioned use.
9. Every hard citation below was checked against its primary source on 2026-09-10 except where marked "verify" — resolve those before the README cites them. Do not cite anything the README cannot link.

**Accent.** This lab's `--accent` is ``#F2C14E``, assigned centrally for the seven-lab batch of 2026-09-10. The other six batch accents are reserved — do not use them:

| Lab | Repo | `--accent` |
|---|---|---|
| Hidden Bit | crypto-lab-hidden-bit | ``#E4572E`` |
| Order Leak | crypto-lab-order-leak | ``#A06CD5`` |
| Split Point | crypto-lab-split-point | ``#4CC9F0`` |
| Proof Tally | crypto-lab-proof-tally | ``#7BE495`` |
| PQXDH Wire | crypto-lab-pqxdh-wire | ``#FF7EB6`` |
| Fold Gate | crypto-lab-fold-gate | ``#5E7CE2`` |

If `theme-sync` reports an adjacent-card collision after the card is placed, change this lab's accent, never the neighbour's, and record the change in the batch document.

## Hero

- Title: `Privacy Pass`
- Subtitle: `Anonymous tokens · VOPRF · RFC 9578`
- Description: Blind a token request, have the issuer evaluate it under a key it must prove it used, redeem it somewhere else, and then let issuer and origin pool their ledgers and fail to match a single entry.
- Why it matters: This is the token in front of the CAPTCHA-free web — anti-bot, rate-limit and "prove you're a real device" systems that never learn who you are. When the blinding goes, the whole guarantee goes with it, and nothing on the wire looks different.

## §1 sections

**SCOPE** — as in the brief.

**SECURITY / CORRECTNESS INVARIANTS**
1. Group, hash, DST and contextString per RFC 9497 for P384-SHA384; RFC 9497 Appendix A VOPRF vectors pass; RFC 9578 §5 vectors pass. State both counts.
2. The issuer module receives only the blinded element and the truncated key id. A test asserts the bytes the issuer receives never equal the serialized hash-to-group of token_input.
3. DLEQ verification failure aborts issuance fail-closed; the client never produces a Token in that branch (test).
4. The origin verifies by Evaluate over token_type ‖ nonce ‖ challenge_digest ‖ token_key_id with skI and compares the authenticator byte-for-byte; token_key_id is recomputed as the hash of the serialized public key per RFC 9578 and compared to the token's field.
5. Double spend: a redeemed nonce is refused on replay; the set is per session, in memory.
6. Broken modes never default, each marked BROKEN with its "what this isn't" line.

**ARCHITECTURE** — `src/oprf/{group,voprf,dleq}.ts`, `src/pass/{challenge,issuance,token,origin}.ts`, `src/attack/{unblinded,key-partition,replay}.ts`, `src/ui/`.

**UI** — Central metaphor: two ledgers. Left, the issuer's ledger (blinded element, proof, timestamp); right, the origin's ledger (nonce, authenticator, verdict). "Try to link" draws a line between entries only when a computable link exists. Steps: origin issues a challenge → client blinds → issuer evaluates and proves → client verifies the proof and finalizes → client redeems → "Try to link" draws nothing. Toggle "remove blinding" → lines. Toggle "per-client issuer key" → the client aborts (correct), and the sub-panel shows the lines a careless client would have earned. Replay → refused.

**VISUAL SEMANTICS** — A link line is ALARM (red, icon, "LINKED"). The client's DLEQ abort renders green "REJECTED AS DESIGNED" (colour tracks integrity, not the return value). Replay refusal is green. The BROKEN badge is always visible in a broken mode. Icon + text + colour throughout.

**EDGE CASES** — hash-to-group yields the identity (abort per RFC 9497); blind = 0 (reject); TokenResponse of the wrong length; truncated key id mismatch; challenge_digest mismatch; nonce reuse; DLEQ verified against the wrong pkI; malformed TokenChallenge fields.

**EXTENSION SEAMS** — the token-type registry (0x0002, and the ristretto255 type from the batched-tokens draft); an Attester role; key-consistency checking.

## Claims suite and negative claim

`e2e/claims.spec.ts`: recompute token_key_id from the displayed serialized pkI and assert it matches the token's field; assert ledger entry counts equal the issuance count; assert link-line count equals the token count in unblinded mode and zero otherwise; assert the replay path names the cause; retirement (re-issue clears stale lines and says so); no-op guard; `[hidden]` probe; KAT counter cross-checked against the KAT panel.

**Negative claim (§4.1d):** "The DLEQ proof shows the issuer used the key it published to this client; it does not show it published the same key to every client. Key consistency is outside RFC 9578 and outside this page." **Fixture:** the issuer publishes pkA to Alice and pkB to Bob; both proofs verify, both tokens finalize, both redeem, no replay; the origin (colluding with the issuer) sorts redemptions by which key verifies them and the ledgers link → "PROOFS VERIFIED — AND PARTITIONED". Every rendered verdict in that state is green except the link, which is ALARM and carries the negative-claim text. Delete the text and the test fails; break a proof inside the fixture and it fails.

## Pre-build verification

- Grep card copy for `VOPRF`, `Privacy Pass`, `OPRF`, `anonymous token`. OPAQUE Gate carries an OPRF: cross-link it and do not re-teach blind / evaluate / unblind from scratch; this lab's new material is the verifiable proof, the token structure and the ledger argument.
- Confirm @noble/curves exposes hash-to-curve for P-384 with the RFC 9380 suite RFC 9497 names, and that the DST it produces matches the RFC's contextString rule. If it does not, implement RFC 9380 for P-384 by hand and test it against RFC 9380's own P-384 vectors; do not downgrade to P-256 — RFC 9578 type 0x0001 is P-384.
- Proposed section: Privacy & Advanced. Proposed chip: PRIVACY. Verify.

## Citations (checked)

RFC 9497, RFC 9576, RFC 9577, RFC 9578 (token types 0x0001 VOPRF(P-384, SHA-384), Nk 48, and 0x0002 Blind RSA 2048-bit, confirmed 2026-09-10), RFC 9380, RFC 9474. Davidson, Goldberg, Sullivan, Tankersley, Valsorda, "Privacy Pass: Bypassing Internet Challenges Anonymously", PoPETs 2018(3) — verify issue number.

---

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
