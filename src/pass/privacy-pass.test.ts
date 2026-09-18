import { describe, expect, it } from 'vitest'
import { publicKey } from '../oprf/voprf.js'
import { Client, Issuer, Origin } from './privacy-pass.js'

const challenge = { issuerName: 'issuer.example', redemptionContext: 'origin.example' }
const issuer = () => new Issuer(0x123456789abcdef123456789abcdef123456789abcdef123456789abcdefn)

describe('RFC 9578 type 0x0001 teaching implementation', () => {
  it('blindly issues a token the origin can privately verify', () => {
    const activeIssuer = issuer()
    const issuance = new Client().issue(activeIssuer, challenge, { blindScalar: 17n })
    expect(new Origin().redeem(issuance.token, challenge, activeIssuer)).toMatchObject({ ok: true })
    expect(issuance.token.tokenKeyId).toHaveLength(32)
    expect(activeIssuer.received[0].blinded.equals(publicKey(1n))).toBe(false)
  })

  it('fails closed when the issuer proof is tampered', () => {
    expect(() => new Client().issue(issuer(), challenge, { tamperProof: true })).toThrow('DLEQ proof verification failed')
  })

  it('fails closed when DLEQ is checked against a different published key', () => {
    const activeIssuer = issuer()
    expect(() => new Client().issue(activeIssuer, challenge, { verifyKey: publicKey(19n) })).toThrow('DLEQ proof verification failed')
  })

  it('refuses replay of a redeemed nonce', () => {
    const activeIssuer = issuer()
    const token = new Client().issue(activeIssuer, challenge).token
    const origin = new Origin()
    expect(origin.redeem(token, challenge, activeIssuer).ok).toBe(true)
    expect(origin.redeem(token, challenge, activeIssuer)).toMatchObject({ ok: false, reason: expect.stringContaining('Replay refused') })
  })
})