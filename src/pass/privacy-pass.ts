import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { blind, directEvaluate, equal, evaluate, finalize, hashToGroup, keyId, pointBytes, type Point, proveDleq, publicKey, randomNonce, scalarBytes, TOKEN_TYPE, truncatedKeyId, verifyDleq, type Proof } from '../oprf/voprf.js'

export type Challenge = { issuerName: string; originInfo: string; redemptionContext: Uint8Array }
export type Token = { nonce: Uint8Array; challengeDigest: Uint8Array; tokenKeyId: Uint8Array; authenticator: Uint8Array }
export type Request = { blinded: Point; truncatedTokenKeyId: number }
export type Response = { evaluated: Point; proof: Proof }
export type Issuance = { token: Token; request: Request; response: Response; input: Uint8Array }

const u8 = (value: string): Uint8Array => utf8ToBytes(value)
const i2osp = (value: number): Uint8Array => new Uint8Array([(value >>> 8) & 0xff, value & 0xff])
export const serializeChallenge = (challenge: Challenge): Uint8Array => {
  const issuerName = u8(challenge.issuerName)
  const originInfo = u8(challenge.originInfo)
  const redemptionContext = challenge.redemptionContext
  if (issuerName.length === 0 || issuerName.length > 0xffff || !/^[\x20-\x7e]+$/.test(challenge.issuerName)) {
    throw new Error('TokenChallenge issuer name must be non-empty ASCII')
  }
  if (redemptionContext.length !== 0 && redemptionContext.length !== 32) {
    throw new Error('TokenChallenge redemption context must be empty or 32 bytes')
  }
  if (originInfo.length > 0xffff) throw new Error('TokenChallenge origin information is too long')
  return concatBytes(TOKEN_TYPE, i2osp(issuerName.length), issuerName, new Uint8Array([redemptionContext.length]), redemptionContext, i2osp(originInfo.length), originInfo)
}
export const challengeDigest = (challenge: Challenge): Uint8Array =>
  sha256(serializeChallenge(challenge))
export const tokenInput = (nonce: Uint8Array, challenge: Challenge, issuerPublicKey: Point): Uint8Array =>
  concatBytes(TOKEN_TYPE, nonce, challengeDigest(challenge), keyId(issuerPublicKey))
export const serializeRequest = (request: Request): Uint8Array =>
  concatBytes(TOKEN_TYPE, new Uint8Array([request.truncatedTokenKeyId]), pointBytes(request.blinded))
export const serializeResponse = (response: Response): Uint8Array =>
  concatBytes(pointBytes(response.evaluated), scalarBytes(response.proof.c), scalarBytes(response.proof.s))
export const serializeToken = (token: Token): Uint8Array =>
  concatBytes(TOKEN_TYPE, token.nonce, token.challengeDigest, token.tokenKeyId, token.authenticator)
export const issuerCanLink = (issuance: Issuance): boolean =>
  hashToGroup(issuance.input).equals(issuance.request.blinded)

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
  issue(issuer: Issuer, challenge: Challenge, options: { blindScalar?: bigint; nonce?: Uint8Array; verifyKey?: Point; tamperProof?: boolean } = {}): Issuance {
    const nonce = options.nonce ?? randomNonce()
    if (nonce.length !== 32) throw new Error('Token nonce must be 32 bytes')
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