import { p384, p384_hasher } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha384 } from '@noble/hashes/sha2.js'
import { concatBytes, randomBytes } from '@noble/hashes/utils.js'

export const TOKEN_TYPE = new Uint8Array([0, 1])
export const CONTEXT = 'OPRFV1--P384-SHA384'
const encoder = new TextEncoder()
const order = p384.Point.Fn.ORDER

export type Point = InstanceType<typeof p384.Point>
export type Proof = { c: bigint; s: bigint }
export type BlindResult = { blind: bigint; blinded: Point }

export const bytes = (value: string): Uint8Array => encoder.encode(value)
export const equal = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])
export const hex = (value: Uint8Array): string => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
export const scalar = (): bigint => p384.Point.Fn.fromBytes(p384.utils.randomSecretKey())
export const pointBytes = (point: Point): Uint8Array => point.toBytes(true)
export const scalarBytes = (value: bigint): Uint8Array => p384.Point.Fn.toBytes(value)
export const publicKey = (secretKey: bigint): Point => p384.Point.BASE.multiply(secretKey)
export const keyId = (issuerPublicKey: Point): Uint8Array => sha256(pointBytes(issuerPublicKey))
export const truncatedKeyId = (issuerPublicKey: Point): number => keyId(issuerPublicKey).at(-1)!

const i2osp = (value: number): Uint8Array => new Uint8Array([(value >>> 8) & 0xff, value & 0xff])
const mod = (value: bigint): bigint => ((value % order) + order) % order
const invert = (value: bigint): bigint => {
  let oldR = value
  let remainder = order
  let oldS = 1n
  let coefficient = 0n
  while (remainder !== 0n) {
    const quotient = oldR / remainder
    ;[oldR, remainder] = [remainder, oldR - quotient * remainder]
    ;[oldS, coefficient] = [coefficient, oldS - quotient * coefficient]
  }
  if (oldR !== 1n) throw new Error('Blind scalar is not invertible')
  return mod(oldS)
}
const hashScalar = (input: Uint8Array): bigint =>
  p384_hasher.hashToScalar(input, { DST: bytes(`HashToScalar-${CONTEXT}`) })

export const hashToGroup = (input: Uint8Array): Point =>
  p384_hasher.hashToCurve(input, { DST: bytes(`HashToGroup-${CONTEXT}`) })

export const blind = (input: Uint8Array, blindScalar = scalar()): BlindResult => {
  if (blindScalar === 0n) throw new Error('Blind scalar must be non-zero')
  const inputElement = hashToGroup(input)
  if (inputElement.equals(p384.Point.ZERO)) throw new Error('Hash-to-group returned identity')
  return { blind: blindScalar, blinded: inputElement.multiply(blindScalar) }
}

export const evaluate = (secretKey: bigint, blinded: Point): Point => blinded.multiply(secretKey)

const frame = (value: Uint8Array): Uint8Array => concatBytes(i2osp(value.length), value)
const composite = (issuerPublicKey: Point, blinded: Point, evaluated: Point): { m: Point; z: Point } => {
  const pk = pointBytes(issuerPublicKey)
  const seedDst = bytes(`Seed-${CONTEXT}`)
  const seed = sha384(concatBytes(frame(pk), frame(seedDst)))
  const coefficient = hashScalar(concatBytes(frame(seed), i2osp(0), frame(pointBytes(blinded)), frame(pointBytes(evaluated)), bytes('Composite')))
  return { m: blinded.multiply(coefficient), z: evaluated.multiply(coefficient) }
}
const challenge = (issuerPublicKey: Point, m: Point, z: Point, t2: Point, t3: Point): bigint =>
  hashScalar(concatBytes(frame(pointBytes(issuerPublicKey)), frame(pointBytes(m)), frame(pointBytes(z)), frame(pointBytes(t2)), frame(pointBytes(t3)), bytes('Challenge')))

export const proveDleq = (secretKey: bigint, blinded: Point, evaluated: Point, nonce = scalar()): Proof => {
  const pk = publicKey(secretKey)
  const { m } = composite(pk, blinded, evaluated)
  const a = publicKey(nonce)
  const b = m.multiply(nonce)
  const c = challenge(pk, m, m.multiply(secretKey), a, b)
  return { c, s: mod(nonce - c * secretKey) }
}

export const verifyDleq = (issuerPublicKey: Point, blinded: Point, evaluated: Point, proof: Proof): boolean => {
  if (proof.c === 0n || proof.s === 0n) return false
  const { m, z } = composite(issuerPublicKey, blinded, evaluated)
  const a = publicKey(proof.s).add(issuerPublicKey.multiply(proof.c))
  const b = m.multiply(proof.s).add(z.multiply(proof.c))
  return challenge(issuerPublicKey, m, z, a, b) === proof.c
}

export const finalize = (input: Uint8Array, blindScalar: bigint, evaluated: Point): Uint8Array => {
  const unblinded = evaluated.multiply(invert(blindScalar))
  const serialized = pointBytes(unblinded)
  return sha384(concatBytes(i2osp(input.length), input, i2osp(serialized.length), serialized, bytes('Finalize')))
}

export const directEvaluate = (secretKey: bigint, input: Uint8Array): Uint8Array => {
  const evaluated = hashToGroup(input).multiply(secretKey)
  const serialized = pointBytes(evaluated)
  return sha384(concatBytes(i2osp(input.length), input, i2osp(serialized.length), serialized, bytes('Finalize')))
}

export const randomNonce = (): Uint8Array => randomBytes(32)