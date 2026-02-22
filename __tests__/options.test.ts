import {expect, test, describe, jest, beforeEach, afterEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

import {Options} from '../src/options'
import {info, warning} from '@actions/core'

describe('Options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('print', () => {
    test('should call info for each option', () => {
      const options = new Options(
        false, // debug
        false, // disableReview
        false, // disableReleaseNotes
        '10', // maxFiles
        true, // reviewSimpleChanges
        true, // reviewCommentLGTM
        null, // pathFilters
        'Test system message', // systemMessage
        'gpt-4', // leaderModel
        'https://api.openai.com/v1', // leaderApiBaseUrl
        'OPENAI_API_KEY', // leaderApiKeyEnv
        '', // helperModels
        'deep', // contextDepth
        '0.5', // modelTemperature
        '5', // apiRetries
        '60000', // apiTimeoutMS
        '4', // llmConcurrencyLimit
        '4', // githubConcurrencyLimit
        '', // apiBaseUrl
        'en-US' // language
      )

      options.print()

      // Verify info was called for each option
      expect(info).toHaveBeenCalledWith(expect.stringContaining('debug: false'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('disable_review: false'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('disable_release_notes: false'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('max_files: 10'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('review_simple_changes: true'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('review_comment_lgtm: true'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('system_message:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('leader_model: gpt-4'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('leader_api_base_url:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('leader_api_key_env:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('helper_models:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('model_temperature:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('api_retries:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('api_timeout_ms:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('llm_concurrency_limit:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('github_concurrency_limit:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('leader_token_limits:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('api_base_url:'))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('language: en-US'))
    })

    test('should call info with debug mode enabled', () => {
      const options = new Options(
        true, // debug
        false,
        false,
        '5',
        false,
        false,
        null,
        '',
        'gpt-4',
        'https://api.openai.com/v1',
        'OPENAI_API_KEY',
        '',
        'medium',
        '0.0',
        '3',
        '120000',
        '6',
        '6',
        '',
        'en-US'
      )

      options.print()

      expect(info).toHaveBeenCalledWith(expect.stringContaining('debug: true'))
    })
  })

  describe('parseHelperConfigs', () => {
    test('should return empty array for empty string', () => {
      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', '',
        'medium', '0.0', '3', '120000', '6', '6', '', 'en-US'
      )

      expect(options.helperConfigs).toEqual([])
    })

    test('should return empty array for whitespace-only string', () => {
      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', '   ',
        'medium', '0.0', '3', '120000', '6', '6', '', 'en-US'
      )

      expect(options.helperConfigs).toEqual([])
    })

    test('should parse valid JSON array with helper configs', () => {
      const helperModelsJson = JSON.stringify([
        {model: 'gpt-3.5-turbo', apiBaseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_KEY'},
        {model: 'claude-3', apiKeyEnv: 'ANTHROPIC_KEY'}
      ])

      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', helperModelsJson,
        'medium', '0.0', '3', '120000', '6', '6', 'https://api.openai.com/v1', 'en-US'
      )

      expect(options.helperConfigs).toHaveLength(2)
      expect(options.helperConfigs[0].model).toBe('gpt-3.5-turbo')
      expect(options.helperConfigs[0].apiBaseUrl).toBe('https://api.openai.com/v1')
      expect(options.helperConfigs[0].apiKeyEnv).toBe('OPENAI_KEY')
      expect(options.helperConfigs[1].model).toBe('claude-3')
      expect(options.helperConfigs[1].apiBaseUrl).toBe('https://api.openai.com/v1') // default
      expect(options.helperConfigs[1].apiKeyEnv).toBe('ANTHROPIC_KEY')
    })

    test('should use default baseUrl when not provided', () => {
      const helperModelsJson = JSON.stringify([
        {model: 'test-model'}
      ])

      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', helperModelsJson,
        'medium', '0.0', '3', '120000', '6', '6', 'https://custom.api.com/v1', 'en-US'
      )

      expect(options.helperConfigs).toHaveLength(1)
      expect(options.helperConfigs[0].model).toBe('test-model')
      expect(options.helperConfigs[0].apiBaseUrl).toBe('https://custom.api.com/v1')
      expect(options.helperConfigs[0].apiKeyEnv).toBe('AI_API_KEY') // default
    })

    test('should return empty array for invalid JSON', () => {
      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', 'not valid json',
        'medium', '0.0', '3', '120000', '6', '6', '', 'en-US'
      )

      expect(options.helperConfigs).toEqual([])
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Failed to parse helper_models JSON'))
    })

    test('should return empty array when JSON is not an array', () => {
      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', '{"model": "test"}',
        'medium', '0.0', '3', '120000', '6', '6', '', 'en-US'
      )

      expect(options.helperConfigs).toEqual([])
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('must be a JSON array'))
    })

    test('should filter out non-object items in array', () => {
      const helperModelsJson = JSON.stringify([
        'not an object',
        123,
        null,
        {model: 'valid-model'}
      ])

      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', helperModelsJson,
        'medium', '0.0', '3', '120000', '6', '6', '', 'en-US'
      )

      expect(options.helperConfigs).toHaveLength(1)
      expect(options.helperConfigs[0].model).toBe('valid-model')
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('is not an object'))
    })

    test('should filter out items with missing or empty model', () => {
      const helperModelsJson = JSON.stringify([
        {model: ''},
        {model: '   '},
        {model: 'valid-model'}
      ])

      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', helperModelsJson,
        'medium', '0.0', '3', '120000', '6', '6', '', 'en-US'
      )

      expect(options.helperConfigs).toHaveLength(1)
      expect(options.helperConfigs[0].model).toBe('valid-model')
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('.model is required'))
    })

    test('should trim model and apiBaseUrl values', () => {
      const helperModelsJson = JSON.stringify([
        {model: '  gpt-4  ', apiBaseUrl: '  https://api.example.com  ', apiKeyEnv: '  KEY  '}
      ])

      const options = new Options(
        false, false, false, '0', false, false, null, '', '', '', '', helperModelsJson,
        'medium', '0.0', '3', '120000', '6', '6', '', 'en-US'
      )

      expect(options.helperConfigs).toHaveLength(1)
      expect(options.helperConfigs[0].model).toBe('gpt-4')
      expect(options.helperConfigs[0].apiBaseUrl).toBe('https://api.example.com')
      expect(options.helperConfigs[0].apiKeyEnv).toBe('KEY')
    })
  })
})

