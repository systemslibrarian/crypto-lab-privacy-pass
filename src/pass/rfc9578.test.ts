import { hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { issuanceVectors } from '../kat/rfc9578.js'
import { blind, finalize, pointFromBytes, verifyDleq } from '../oprf/voprf.js'
import { deserializeResponse, deserializeToken, serializeRequest, serializeToken, tokenInputFromChallenge } from './privacy-pass.js'

describe('RFC 9578 Appendix A.1 type 0x0001 vectors', () => {
  issuanceVectors.forEach((vector, index) => it(`matches issuance vector ${index + 1}`, () => {
    const issuerPublicKey = pointFromBytes(hexToBytes(vector.pk))
    const nonce = hexToBytes(vector.nonce)
    const input = tokenInputFromChallenge(nonce, hexToBytes(vector.challenge), issuerPublicKey)
    const request = {
      blinded: blind(input, BigInt(`0x${vector.blind}`)).blinded,
      truncatedTokenKeyId: Number.parseInt(vector.request.slice(4, 6), 16),
    }
    const response = deserializeResponse(hexToBytes(vector.response))
    const expectedToken = deserializeToken(hexToBytes(vector.token))
    expect(serializeRequest(request)).toEqual(hexToBytes(vector.request))
    expect(verifyDleq(issuerPublicKey, request.blinded, response.evaluated, response.proof)).toBe(true)
    expect(finalize(input, BigInt(`0x${vector.blind}`), response.evaluated)).toEqual(expectedToken.authenticator)
    expect(serializeToken(expectedToken)).toEqual(hexToBytes(vector.token))
  }))
})