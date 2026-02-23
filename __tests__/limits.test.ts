import {expect, test, describe} from '@jest/globals'
import {TokenLimits} from '../src/limits'

describe('TokenLimits', () => {
  describe('constructor', () => {
    test('should use default model MiniMax-M2.5 when no model provided', () => {
      const limits = new TokenLimits()
      expect(limits.maxTokens).toBe(200000)
      expect(limits.responseTokens).toBe(80000)
      expect(limits.requestTokens).toBe(200000 - 80000 - 100)
    })

    test('should set correct tokens for MiniMax-M2.5', () => {
      const limits = new TokenLimits('MiniMax-M2.5')
      expect(limits.maxTokens).toBe(200000)
      expect(limits.responseTokens).toBe(80000)
      expect(limits.requestTokens).toBe(200000 - 80000 - 100)
    })

    test('should set correct tokens for GLM-4.7', () => {
      const limits = new TokenLimits('GLM-4.7')
      expect(limits.maxTokens).toBe(200000)
      expect(limits.responseTokens).toBe(80000)
      expect(limits.requestTokens).toBe(200000 - 80000 - 100)
    })

    test('should set correct tokens for glm-4.7 lowercase', () => {
      const limits = new TokenLimits('glm-4.7')
      expect(limits.maxTokens).toBe(200000)
      expect(limits.responseTokens).toBe(80000)
      expect(limits.requestTokens).toBe(200000 - 80000 - 100)
    })

    test('should default to MiniMax-M2.5 limits for unknown models', () => {
      const limits = new TokenLimits('unknown-model')
      expect(limits.maxTokens).toBe(200000)
      expect(limits.responseTokens).toBe(80000)
    })

    test('should set knowledgeCutOff', () => {
      const limits = new TokenLimits('MiniMax-M2.5')
      expect(limits.knowledgeCutOff).toBe('2024-01-01')
    })
  })

  describe('string', () => {
    test('should return formatted string', () => {
      const limits = new TokenLimits('MiniMax-M2.5')
      const result = limits.string()
      expect(result).toContain('max_tokens=200000')
      expect(result).toContain('response_tokens=80000')
      expect(result).toContain('request_tokens=')
    })
  })
})
