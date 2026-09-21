import { p384 } from '@noble/curves/nist.js'
import { concatBytes, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { batchVectors, secretKeyHex, singleVectors } from '../kat/rfc9497.js'
import { blind, evaluate, finalize, pointBytes, proveDleq, proveDleqBatch, publicKey, scalarBytes, verifyDleq, verifyDleqBatch } from './voprf.js'

const scalar = (value: string): bigint => p384.Point.Fn.fromBytes(hexToBytes(value))
const secretKey = scalar(secretKeyHex)

describe('RFC 9497 Appendix A.4.2 P384-SHA384 vectors', () => {
  singleVectors.forEach((vector, index) => it(`matches single-element vector ${index + 1}`, () => {
    const input = hexToBytes(vector.input)
    const result = blind(input, scalar(vector.blind))
    const evaluated = evaluate(secretKey, result.blinded)
    const proof = proveDleq(secretKey, result.blinded, evaluated, scalar(vector.proofNonce))
    expect(pointBytes(result.blinded)).toEqual(hexToBytes(vector.blinded))
    expect(pointBytes(evaluated)).toEqual(hexToBytes(vector.evaluated))
    expect(concatBytes(scalarBytes(proof.c), scalarBytes(proof.s))).toEqual(hexToBytes(vector.proof))
    expect(verifyDleq(publicKey(secretKey), result.blinded, evaluated, proof)).toBe(true)
    expect(finalize(input, result.blind, evaluated)).toEqual(hexToBytes(vector.output))
  }))

  batchVectors.forEach((vector) => it(`matches ${vector.label}`, () => {
    const inputs = vector.inputs.map(hexToBytes)
    const blinds = vector.blinds.map(scalar)
    const blinded = inputs.map((input, index) => blind(input, blinds[index]).blinded)
    const evaluated = blinded.map((element) => evaluate(secretKey, element))
    const proof = proveDleqBatch(secretKey, blinded, evaluated, scalar(vector.proofNonce))
    expect(blinded.map(pointBytes)).toEqual(vector.blinded.map(hexToBytes))
    expect(evaluated.map(pointBytes)).toEqual(vector.evaluated.map(hexToBytes))
    expect(concatBytes(scalarBytes(proof.c), scalarBytes(proof.s))).toEqual(hexToBytes(vector.proof))
    expect(verifyDleqBatch(publicKey(secretKey), blinded, evaluated, proof)).toBe(true)
    expect(inputs.map((input, index) => finalize(input, blinds[index], evaluated[index]))).toEqual(singleVectors.map((single) => hexToBytes(single.output)))
  }))
})
