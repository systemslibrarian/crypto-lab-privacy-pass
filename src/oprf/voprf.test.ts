import { p384 } from '@noble/curves/nist.js'
import { concatBytes, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { blind, evaluate, finalize, pointBytes, proveDleq, proveDleqBatch, publicKey, scalarBytes, verifyDleq, verifyDleqBatch } from './voprf.js'

const scalar = (value: string): bigint => p384.Point.Fn.fromBytes(hexToBytes(value))
const secretKey = scalar('051646b9e6e7a71ae27c1e1d0b87b4381db6d3595eeeb1adb41579adbf992f4278f9016eafc944edaa2b43183581779d')
const commonBlind = '504650f53df8f16f6861633388936ea23338fa65ec36e0290022b48eb562889d89dbfa691d1cde91517fa222ed7ad364'
const commonProofNonce = '803d955f0e073a04aa5d92b3fb739f56f9db001266677f62c095021db018cd8cbb55941d4073698ce45c405d1348b7b1'

const vectors = [
  {
    input: '00',
    blind: commonBlind,
    blinded: '02d338c05cbecb82de13d6700f09cb61190543a7b7e2c6cd4fca56887e564ea82653b27fdad383995ea6d02cf26d0e24d9',
    evaluated: '02a7bba589b3e8672aa19e8fd258de2e6aae20101c8d761246de97a6b5ee9cf105febce4327a326255a3c604f63f600ef6',
    proof: 'bfc6cf3859127f5fe25548859856d6b7fa1c7459f0ba5712a806fc091a3000c42d8ba34ff45f32a52e40533efd2a03bc87f3bf4f9f58028297ccb9ccb18ae7182bcd1ef239df77e3be65ef147f3acf8bc9cbfc5524b702263414f043e3b7ca2e',
    proofNonce: commonProofNonce,
    output: '3333230886b562ffb8329a8be08fea8025755372817ec969d114d1203d026b4a622beab60220bf19078bca35a529b35c',
  },
  {
    input: '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a',
    blind: commonBlind,
    blinded: '02f27469e059886f221be5f2cca03d2bdc61e55221721c3b3e56fc012e36d31ae5f8dc058109591556a6dbd3a8c69c433b',
    evaluated: '03f16f903947035400e96b7f531a38d4a07ac89a80f89d86a1bf089c525a92c7f4733729ca30c56ce78b1ab4f7d92db8b4',
    proof: 'd005d6daaad7571414c1e0c75f7e57f2113ca9f4604e84bc90f9be52da896fff3bee496dcde2a578ae9df315032585f801fb21c6080ac05672b291e575a40295b306d967717b28e08fcc8ad1cab47845d16af73b3e643ddcc191208e71c64630',
    proofNonce: commonProofNonce,
    output: 'b91c70ea3d4d62ba922eb8a7d03809a441e1c3c7af915cbc2226f485213e895942cd0f8580e6d99f82221e66c40d274f',
  },
]

describe('RFC 9497 Appendix A.4.2 P384-SHA384 vectors', () => {
  vectors.forEach((vector, index) => it(`matches single-element vector ${index + 1}`, () => {
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

  it('matches batch-size-two vector 3', () => {
    const inputs = [hexToBytes('00'), hexToBytes('5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a')]
    const blinds = [scalar(commonBlind), scalar(commonProofNonce)]
    const expectedBlinded = [
      '02d338c05cbecb82de13d6700f09cb61190543a7b7e2c6cd4fca56887e564ea82653b27fdad383995ea6d02cf26d0e24d9',
      '02fa02470d7f151018b41e82223c32fad824de6ad4b5ce9f8e9f98083c9a726de9a1fc39d7a0cb6f4f188dd9cea01474cd',
    ]
    const expectedEvaluated = [
      '02a7bba589b3e8672aa19e8fd258de2e6aae20101c8d761246de97a6b5ee9cf105febce4327a326255a3c604f63f600ef6',
      '028e9e115625ff4c2f07bf87ce3fd73fc77994a7a0c1df03d2a630a3d845930e2e63a165b114d98fe34e61b68d23c0b50a',
    ]
    const expectedProof = '6d8dcbd2fc95550a02211fb78afd013933f307d21e7d855b0b1ed0af78076d8137ad8b0a1bfa05676d325249c1dbb9a52bd81b1c2b7b0efc77cf7b278e1c947f6283f1d4c513053fc0ad19e026fb0c30654b53d9cea4b87b037271b5d2e2d0ea'
    const proofNonce = scalar('a097e722ed2427de86966910acba9f5c350e8040f828bf6ceca27405420cdf3d63cb3aef005f40ba51943c8026877963')
    const blinded = inputs.map((input, index) => blind(input, blinds[index]).blinded)
    const evaluated = blinded.map((element) => evaluate(secretKey, element))
    const proof = proveDleqBatch(secretKey, blinded, evaluated, proofNonce)
    expect(blinded.map(pointBytes)).toEqual(expectedBlinded.map(hexToBytes))
    expect(evaluated.map(pointBytes)).toEqual(expectedEvaluated.map(hexToBytes))
    expect(concatBytes(scalarBytes(proof.c), scalarBytes(proof.s))).toEqual(hexToBytes(expectedProof))
    expect(verifyDleqBatch(publicKey(secretKey), blinded, evaluated, proof)).toBe(true)
    expect(inputs.map((input, index) => finalize(input, blinds[index], evaluated[index]))).toEqual(vectors.map((vector) => hexToBytes(vector.output)))
  })
})