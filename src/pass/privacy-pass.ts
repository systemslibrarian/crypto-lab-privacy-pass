import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { blind, directEvaluate, equal, evaluate, finalize, keyId, type Point, proveDleq, publicKey, randomNonce, TOKEN_TYPE, truncatedKeyId, verifyDleq, type Proof } from '../oprf/voprf.js'

export type Challenge = { issuerName: string; redemptionContext: string }
export type Token = { nonce: Uint8Array; challengeDigest: Uint8Array; tokenKeyId: Uint8Array; authenticator: Uint8Array }
export type Request = { blinded: Point; truncatedTokenKeyId: number }
export type Response = { evaluated: Point; proof: Proof }
export type Issuance = { token: Token; request: Request; response: Response; input: Uint8Array }

const u8 = (value: string): Uint8Array => utf8ToBytes(value)
export const challengeDigest = (challenge: Challenge): Uint8Array =>
  sha256(concatBytes(u8(challenge.issuerName), new Uint8Array([0]), u8(challenge.redemptionContext)))
export const tokenInput = (nonce: Uint8Array, challenge: Challenge, issuerPublicKey: Point): Uint8Array =>
  concatBytes(TOKEN_TYPE, nonce, challengeDigest(challenge), keyId(issuerPublicKey))

export class Issuer {
  readonly publicKey: Point
  readonly received: Request[] = []
  constructor(readonly secretKey: bigint) { this.publicKey = publicKey(secretKey) }

  respond(request: Request): Response {
    if (request.truncatedTokenKeyId !== truncatedKeyId(this.publicKey)) throw new Error('Truncated token key id mismatch')
    this.received.push(request)
    const evaluated = evaluate(this.secretKey, request.blinded)
    return { evaluated, proof: proveDleq(this.secretKey, request.blinded, evaluated) }
  }
}

export class Client {
  issue(issuer: Issuer, challenge: Challenge, options: { blindScalar?: bigint; verifyKey?: Point; tamperProof?: boolean } = {}): Issuance {
    const nonce = randomNonce()
    const input = tokenInput(nonce, challenge, issuer.publicKey)
    const requestBlind = blind(input, options.blindScalar)
    const request = { blinded: requestBlind.blinded, truncatedTokenKeyId: truncatedKeyId(issuer.publicKey) }
    const response = issuer.respond(request)
    if (options.tamperProof) response.proof = { ...response.proof, s: response.proof.s + 1n }
    if (!verifyDleq(options.verifyKey ?? issuer.publicKey, request.blinded, response.evaluated, response.proof)) {
      throw new Error('DLEQ proof verification failed: no token was finalized')
    }
    return {
      input,
      request,
      response,
      token: {
        nonce,
        challengeDigest: challengeDigest(challenge),
        tokenKeyId: keyId(issuer.publicKey),
        authenticator: finalize(input, requestBlind.blind, response.evaluated),
      },
    }
  }
}

export class Origin {
  private readonly spent = new Set<string>()
  redeem(token: Token, challenge: Challenge, issuer: Issuer): { ok: boolean; reason: string } {
    if (!equal(token.tokenKeyId, keyId(issuer.publicKey))) return { ok: false, reason: 'Token key id does not match the issuer public key' }
    if (!equal(token.challengeDigest, challengeDigest(challenge))) return { ok: false, reason: 'Token challenge digest does not match this origin challenge' }
    const nonceId = Array.from(token.nonce).join(',')
    if (this.spent.has(nonceId)) return { ok: false, reason: 'Replay refused: this nonce was already redeemed in this session' }
    const expected = directEvaluate(issuer.secretKey, tokenInput(token.nonce, challenge, issuer.publicKey))
    if (!equal(token.authenticator, expected)) return { ok: false, reason: 'Authenticator did not verify' }
    this.spent.add(nonceId)
    return { ok: true, reason: 'Authenticator verified; nonce recorded as spent' }
  }
}