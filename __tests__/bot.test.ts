jest.mock('../src/fetch-polyfill', () => ({__esModule: true}), {virtual: true})

import {expect, test, describe, jest, beforeEach, afterEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  setFailed: jest.fn()
}))

jest.mock('p-retry', () => ({
  __esModule: true,
  default: jest.fn((fn: () => Promise<unknown>) => fn())
}))

const mockChatCompletions = {
  create: jest.fn()
}

const mockOpenAI = jest.fn().mockImplementation(() => ({
  chat: {
    completions: mockChatCompletions
  }
}))

jest.mock('openai', () => ({
  __esModule: true,
  default: mockOpenAI
}))

import {Bot} from '../src/bot'
import {Options} from '../src/options'
import {ProviderOptions} from '../src/options'
import {info, warning} from '@actions/core'

const createTestOptions = (overrides = {}) => {
  return new Options(
    false,
    false,
    false,
    '10',
    false,
    false,
    null,
    'You are a reviewer.',
    'gpt-4',
    'https://api.openai.com/v1',
    'OPENAI_API_KEY',
    '[]',
    'medium',
    '0.7',
    '3',
    '60000',
    '2',
    '2',
    'https://api.openai.com/v1',
    'en-US'
  )
}

const createProviderOptions = (baseUrl = 'https://api.openai.com/v1') => {
  return new ProviderOptions(
    'gpt-4',
    null,
    baseUrl,
    'OPENAI_API_KEY'
  )
}

describe('Bot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  describe('constructor', () => {
    test('should throw error when API key env is not set', () => {
      delete process.env.OPENAI_API_KEY
      
      expect(() => {
        new Bot(createTestOptions(), createProviderOptions())
      }).toThrow("Unable to initialize API client: environment variable 'OPENAI_API_KEY' is not set")
    })

    test('should throw error when API key is empty', () => {
      process.env.OPENAI_API_KEY = ''
      
      expect(() => {
        new Bot(createTestOptions(), createProviderOptions())
      }).toThrow("Unable to initialize API client: environment variable 'OPENAI_API_KEY' is not set")
    })

    test('should throw error when API key is whitespace only', () => {
      process.env.OPENAI_API_KEY = '   '
      
      expect(() => {
        new Bot(createTestOptions(), createProviderOptions())
      }).toThrow("Unable to initialize API client: environment variable 'OPENAI_API_KEY' is not set")
    })

    test('should initialize successfully with valid API key', () => {
      const bot = new Bot(createTestOptions(), createProviderOptions())

      expect(bot).toBeDefined()
      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        baseURL: 'https://api.openai.com/v1'
      })
    })

    test('should use custom base URL when provided', () => {
      process.env.OPENAI_API_KEY = 'custom-key'
      
      new Bot(createTestOptions(), createProviderOptions('https://custom.api.com/v1'))

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'custom-key',
        baseURL: 'https://custom.api.com/v1'
      })
    })
  })

  describe('chat', () => {
    let bot: Bot

    beforeEach(() => {
      jest.clearAllMocks()
      process.env.OPENAI_API_KEY = 'test-api-key'
      
      bot = new Bot(createTestOptions(), createProviderOptions())
    })

    test('should return empty string when message is empty', async () => {
      const result = await bot.chat('', {})

      expect(result).toEqual(['', {}])
      expect(mockChatCompletions.create).not.toHaveBeenCalled()
    })

    test('should call OpenAI API with correct parameters', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Test response'
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      const result = await bot.chat('Hello', {})

      expect(mockChatCompletions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          messages: expect.any(Array),
          temperature: 0.7,
          max_tokens: 4000
        }),
        {timeout: 60000}
      )
      expect(result[0]).toBe('Test response')
    })

    test('should include system message with language and date', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Response'
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      await bot.chat('Test message', {})

      const callArgs = mockChatCompletions.create.mock.calls[0][0] as {messages: Array<{role: string; content: string}>}
      expect(callArgs.messages[0]).toEqual({
        role: 'system',
        content: expect.stringContaining('You are a reviewer.')
      })
      expect(callArgs.messages[0]).toEqual({
        role: 'system',
        content: expect.stringContaining('en-US')
      })
    })

    test('should include previous messages in conversation', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Response'
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      const ids = {
        messages: [
          {role: 'user' as const, content: 'Previous message'},
          {role: 'assistant' as const, content: 'Previous response'}
        ]
      }

      await bot.chat('New message', ids)

      const callArgs = mockChatCompletions.create.mock.calls[0][0] as {messages: Array<{role: string; content: string}>}
      expect(callArgs.messages.length).toBeGreaterThan(2)
    })

    test('should log response time', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Test'
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      await bot.chat('Hello', {})

      expect(info).toHaveBeenCalledWith(expect.stringContaining('provider chat response time'))
    })

    test('should log response text in debug mode', async () => {
      const debugOptions = new Options(
        true,
        false,
        false,
        '10',
        false,
        false,
        null,
        'You are a reviewer.',
        'gpt-4',
        'https://api.openai.com/v1',
        'OPENAI_API_KEY',
        '[]',
        'medium',
        '0.7',
        '3',
        '60000',
        '2',
        '2',
        'https://api.openai.com/v1',
        'en-US'
      )
      const debugBot = new Bot(debugOptions, createProviderOptions())

      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Debug response'
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      await debugBot.chat('Hello', {})

      expect(info).toHaveBeenCalledWith(expect.stringContaining('provider response text'))
    })

    test('should warn when response is empty', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: ''
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      await bot.chat('Hello', {})

      expect(warning).toHaveBeenCalledWith('provider response is empty')
    })

    test('should handle non-string response content', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: null
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      const result = await bot.chat('Hello', {})

      expect(result[0]).toBe('')
    })

    test('should return updated ids with conversation history', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Assistant response'
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      const result = await bot.chat('User message', {})

      expect(result[1].messages).toBeDefined()
      expect(result[1].messages?.length).toBe(2)
      expect(result[1].messages?.[0]).toEqual({role: 'user', content: 'User message'})
      expect(result[1].messages?.[1]).toEqual({role: 'assistant', content: 'Assistant response'})
    })

    test('should catch errors and return empty string', async () => {
      mockChatCompletions.create.mockRejectedValue(new Error('API Error') as never)

      const result = await bot.chat('Hello', {})

      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Failed to chat'))
      expect(result).toEqual(['', {}])
    })

    test('should preserve existing messages when adding new ones', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'New response'
            }
          }
        ]
      }
      mockChatCompletions.create.mockResolvedValue(mockResponse as never)

      const existingMessages = [
        {role: 'user' as const, content: 'First message'},
        {role: 'assistant' as const, content: 'First response'}
      ]

      await bot.chat('New message', {messages: existingMessages})

      const callArgs = mockChatCompletions.create.mock.calls[0][0] as {messages: Array<{role: string; content: string}>}
      expect(callArgs.messages.length).toBe(4)
    })
  })
})
