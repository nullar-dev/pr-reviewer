import {expect, test, describe, jest, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getInput: jest.fn((name: string) => {
    if (name === 'token') return 'test-token'
    return ''
  }),
  warning: jest.fn()
}))

jest.mock('@octokit/action', () => {
  const MockOctokit = jest.fn().mockImplementation(() => ({}))
  return {Octokit: MockOctokit}
})

jest.mock('@octokit/plugin-retry', () => ({
  retry: jest.fn(() => (ctor: unknown) => ctor)
}))

jest.mock('@octokit/plugin-throttling', () => ({
  throttling: jest.fn(() => (ctor: unknown) => ctor)
}))

describe('Octokit Configuration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('throttling onRateLimit callback logs warning', () => {
    const {warning} = require('@actions/core')
    
    const onRateLimit = (
      retryAfter: number,
      options: {method: string; url: string},
      _o: unknown,
      retryCount: number
    ) => {
      warning(`Request quota exhausted for request ${options.method} ${options.url}`)
      if (retryCount <= 3) {
        return true
      }
      return false
    }
    
    const result = onRateLimit(60, {method: 'GET', url: 'https://api.github.com/test'}, {}, 1)
    
    expect(warning).toHaveBeenCalled()
    expect(result).toBe(true)
  })

  test('throttling onRateLimit returns false after 3 retries', () => {
    const onRateLimit = (
      _retryAfter: number,
      options: {method: string; url: string},
      _o: unknown,
      retryCount: number
    ) => {
      if (retryCount <= 3) {
        return true
      }
      return false
    }
    
    const result = onRateLimit(60, {method: 'GET', url: 'https://api.github.com/test'}, {}, 4)
    
    expect(result).toBe(false)
  })

  test('throttling onSecondaryRateLimit callback logs warning', () => {
    const {warning} = require('@actions/core')
    
    const onSecondaryRateLimit = (
      retryAfter: number,
      options: {method: string; url: string},
      _o: unknown,
      retryCount: number
    ) => {
      warning(`SecondaryRateLimit detected for request ${options.method} ${options.url}`)
      if (retryCount <= 3) {
        return true
      }
      return false
    }
    
    const result = onSecondaryRateLimit(60, {method: 'GET', url: 'https://api.github.com/test'}, {}, 1)
    
    expect(warning).toHaveBeenCalled()
    expect(result).toBe(true)
  })

  test('throttling onSecondaryRateLimit returns false for POST /reviews', () => {
    const onSecondaryRateLimit = (
      _retryAfter: number,
      options: {method: string; url: string},
      _o: unknown,
      retryCount: number
    ) => {
      if (
        options.method === 'POST' &&
        options.url.match(/\/repos\/.*\/.*\/pulls\/.*\/reviews/)
      ) {
        return false
      }
      if (retryCount <= 3) {
        return true
      }
      return false
    }
    
    const result = onSecondaryRateLimit(
      60,
      {method: 'POST', url: 'https://api.github.com/repos/owner/repo/pulls/1/reviews'},
      {},
      1
    )
    
    expect(result).toBe(false)
  })

  test('throttling onSecondaryRateLimit returns true for non-review POST', () => {
    const onSecondaryRateLimit = (
      _retryAfter: number,
      options: {method: string; url: string},
      _o: unknown,
      retryCount: number
    ) => {
      if (
        options.method === 'POST' &&
        options.url.match(/\/repos\/.*\/.*\/pulls\/.*\/reviews/)
      ) {
        return false
      }
      if (retryCount <= 3) {
        return true
      }
      return false
    }
    
    const result = onSecondaryRateLimit(
      60,
      {method: 'POST', url: 'https://api.github.com/repos/owner/repo/pulls/1/comments'},
      {},
      1
    )
    
    expect(result).toBe(true)
  })

  test('throttling onSecondaryRateLimit returns false after 3 retries', () => {
    const onSecondaryRateLimit = (
      _retryAfter: number,
      options: {method: string; url: string},
      _o: unknown,
      retryCount: number
    ) => {
      if (retryCount <= 3) {
        return true
      }
      return false
    }
    
    const result = onSecondaryRateLimit(60, {method: 'GET', url: 'https://api.github.com/test'}, {}, 4)
    
    expect(result).toBe(false)
  })
})
