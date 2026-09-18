import { describe, expect, it } from 'vitest'
import { p384 } from '@noble/curves/nist.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { blind, evaluate, finalize, pointBytes, proveDleq, publicKey, verifyDleq } from '../oprf/voprf.js'
import { Client, deserializeResponse, deserializeToken, Issuer, Origin, issuerCanLink, serializeChallenge, serializeRequest, serializeResponse, serializeToken, tokenInput } from './privacy-pass.js'

const challenge = { issuerName: 'issuer.example', originInfo: 'origin.example', redemptionContext: new Uint8Array() }
const issuer = () => new Issuer(0x123456789abcdef123456789abcdef123456789abcdef123456789abcdefn)

describe('RFC 9578 type 0x0001 teaching implementation', () => {
  it('matches RFC 9497 Appendix A.4.2.1 VOPRF(P-384, SHA-384)', () => {
    const secretKey = p384.Point.Fn.fromBytes(hexToBytes('051646b9e6e7a71ae27c1e1d0b87b4381db6d3595eeeb1adb41579adbf992f4278f9016eafc944edaa2b43183581779d'))
    const blindScalar = p384.Point.Fn.fromBytes(hexToBytes('504650f53df8f16f6861633388936ea23338fa65ec36e0290022b48eb562889d89dbfa691d1cde91517fa222ed7ad364'))
    const proofNonce = p384.Point.Fn.fromBytes(hexToBytes('803d955f0e073a04aa5d92b3fb739f56f9db001266677f62c095021db018cd8cbb55941d4073698ce45c405d1348b7b1'))
    const input = hexToBytes('00')
    const expectedBlinded = '02d338c05cbecb82de13d6700f09cb61190543a7b7e2c6cd4fca56887e564ea82653b27fdad383995ea6d02cf26d0e24d9'
    const expectedEvaluated = '02a7bba589b3e8672aa19e8fd258de2e6aae20101c8d761246de97a6b5ee9cf105febce4327a326255a3c604f63f600ef6'
    const expectedOutput = '3333230886b562ffb8329a8be08fea8025755372817ec969d114d1203d026b4a622beab60220bf19078bca35a529b35c'
    const result = blind(input, blindScalar)
    const evaluated = evaluate(secretKey, result.blinded)
    const proof = proveDleq(secretKey, result.blinded, evaluated, proofNonce)

    expect(pointBytes(result.blinded)).toEqual(hexToBytes(expectedBlinded))
    expect(pointBytes(evaluated)).toEqual(hexToBytes(expectedEvaluated))
    expect(verifyDleq(publicKey(secretKey), result.blinded, evaluated, proof)).toBe(true)
    expect(finalize(input, result.blind, evaluated)).toEqual(hexToBytes(expectedOutput))
  })

  it('matches RFC 9578 Appendix A.1 test vector 1 TokenChallenge and request', () => {
    const issuerPublicKey = p384.Point.fromBytes(hexToBytes('02d45bf522425cdd2227d3f27d245d9d563008829252172d34e48469290c21da1a46d42ca38f7beabdf05c074aee1455bf'))
    const nonce = hexToBytes('6aa422c41b59d3e44a136dd439df2454e3587ee5f3697798cdc05fafe73073b8')
    const blindScalar = p384.Point.Fn.fromBytes(hexToBytes('8e7fd80970b8a00b0931b801a2e22d9903d83bd5597c6a4dc1496ed2b17ef820445ef3bd223f3ab2c4f54c5d1c956909'))
    const vectorChallenge = { issuerName: 'issuer.example', originInfo: 'origin.example', redemptionContext: hexToBytes('5de58a52fcdaef25ca3f65448d04e040fb1924e8264acfccfc6c5ad451d582b3') }
    const expectedChallenge = '0001000e6973737565722e6578616d706c65205de58a52fcdaef25ca3f65448d04e040fb1924e8264acfccfc6c5ad451d582b3000e6f726967696e2e6578616d706c65'
    const expectedRequest = '0001f4030ab3e23181d1e213f24315f5775983c678ce22eff9427610832ab3900f2cd12d6829a07ec8a6813cf0b5b886f4cc4979'

    expect(serializeChallenge(vectorChallenge)).toEqual(hexToBytes(expectedChallenge))
    const request = { blinded: blind(tokenInput(nonce, vectorChallenge, issuerPublicKey), blindScalar).blinded, truncatedTokenKeyId: 0xf4 }
    expect(serializeRequest(request)).toEqual(hexToBytes(expectedRequest))
  })

  it('serializes complete response and token wire structures', () => {
    const activeIssuer = issuer()
    const issuance = new Client().issue(activeIssuer, challenge, { blindScalar: 17n, nonce: new Uint8Array(32).fill(7) })
    expect(serializeRequest(issuance.request)).toHaveLength(52)
    expect(serializeResponse(issuance.response)).toHaveLength(145)
    expect(serializeToken(issuance.token)).toHaveLength(146)
    expect(serializeToken(issuance.token).slice(0, 2)).toEqual(new Uint8Array([0, 1]))
    expect(serializeResponse(deserializeResponse(serializeResponse(issuance.response)))).toEqual(serializeResponse(issuance.response))
    expect(serializeToken(deserializeToken(serializeToken(issuance.token)))).toEqual(serializeToken(issuance.token))
    expect(() => deserializeResponse(new Uint8Array(144))).toThrow('exactly 145 bytes')
    expect(() => deserializeToken(new Uint8Array(145))).toThrow('exactly 146 bytes')
  })

  it('derives ledger linkability from the request point instead of mode state', () => {
    const activeIssuer = issuer()
    expect(issuerCanLink(new Client().issue(activeIssuer, challenge, { blindScalar: 1n }))).toBe(true)
    expect(issuerCanLink(new Client().issue(activeIssuer, challenge, { blindScalar: 17n }))).toBe(false)
  })

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