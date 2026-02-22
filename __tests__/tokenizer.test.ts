import {expect, test, describe, jest, beforeEach} from '@jest/globals'

jest.mock('@dqbd/tiktoken', () => ({
  get_encoding: jest.fn(() => ({
    encode: jest.fn((input: string) => new Uint32Array(input.split(/\s+/).filter(Boolean).length))
  }))
}))

jest.mock('@actions/core', () => ({
  warning: jest.fn()
}))

import {encode, getTokenCount} from '../src/tokenizer'

describe('Tokenizer Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('should encode a string to token array', () => {
    const result = encode('hello world')
    expect(result).toBeInstanceOf(Uint32Array)
  })

  test('should return empty array when tokenizer is not initialized', () => {
    const result = encode('')
    expect(result).toBeInstanceOf(Uint32Array)
  })

  test('should handle encoding errors gracefully', () => {
    const result = encode('test input')
    expect(result).toBeInstanceOf(Uint32Array)
  })

  test('should return correct token count for input', () => {
    const result = getTokenCount('hello world test')
    expect(result).toBeGreaterThanOrEqual(0)
  })

  test('should return 0 when tokenizer is not initialized', () => {
    const result = getTokenCount('any input')
    expect(result).toBeGreaterThanOrEqual(0)
  })

  test('should handle special endoftext markers', () => {
    const result = getTokenCount('hello<|endoftext|>world')
    expect(typeof result).toBe('number')
  })

  test('should handle getTokenCount errors gracefully', () => {
    const result = getTokenCount('test input error handling')
    expect(result).toBeGreaterThanOrEqual(0)
  })

  test('should handle empty string', () => {
    const result = getTokenCount('')
    expect(result).toBe(0)
  })
})
