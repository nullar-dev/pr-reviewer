import {expect, test, describe, jest} from '@jest/globals'

jest.mock('@actions/core', () => ({
  getBooleanInput: jest.fn(() => false),
  getInput: jest.fn(() => ''),
  getMultilineInput: jest.fn(() => ['!dist/**']),
  info: jest.fn(),
  warning: jest.fn(),
  setFailed: jest.fn()
}))

import {Options} from '../src/options'
import {Prompts} from '../src/prompts'
import {Inputs} from '../src/inputs'

describe('Options Configuration Tests', () => {
  test('should parse default options correctly', () => {
    const options = new Options(
      true,
      false,
      false,
      '10',
      false,
      false,
      ['!dist/**'],
      'You are a reviewer.',
      'MiniMax-M2.5',
      'https://api.minimax.io/v1',
      'AI_API_KEY',
      '[]',
      'medium',
      '0.1',
      '3',
      '60000',
      '2',
      '2',
      'https://api.minimax.io/v1',
      'en-US'
    )

    expect(options.debug).toBe(true)
    expect(options.maxFiles).toBe(10)
    expect(options.contextDepth).toBe('medium')
    expect(options.llmConcurrencyLimit).toBe(2)
    expect(options.language).toBe('en-US')
  })

  test('should parse shallow context depth', () => {
    const options = new Options(
      false, false, false, '0', false, false, null, '', '', '', '',
      '', 'shallow'
    )
    expect(options.contextDepth).toBe('shallow')
  })

  test('should parse deep context depth', () => {
    const options = new Options(
      false, false, false, '0', false, false, null, '', '', '', '',
      '', 'deep'
    )
    expect(options.contextDepth).toBe('deep')
  })

  test('should default context_depth to medium for invalid values', () => {
    const options = new Options(
      false, false, false, '0', false, false, null, '', '', '', '',
      '', 'invalid'
    )
    expect(options.contextDepth).toBe('medium')
  })
})

describe('Prompts and Inputs Tests', () => {
  const prompts = new Prompts(
    'Summarize the changes.',
    'Create release notes.'
  )

  test('should create prompts with templates', () => {
    expect(prompts.summarize).toBe('Summarize the changes.')
    expect(prompts.summarizeReleaseNotes).toBe('Create release notes.')
  })

  test('should render review prompt with file diff', () => {
    const inputs = new Inputs()
    inputs.filename = 'src/index.ts'
    inputs.title = 'Test PR: Add feature'
    inputs.description = 'Adding new feature'
    inputs.patches = '@@ code diff @@'
    inputs.systemMessage = 'You are a code reviewer.'

    const prompt = prompts.renderReviewFileDiff(inputs)

    expect(prompt).toContain('src/index.ts')
    expect(prompt).toContain('Test PR: Add feature')
  })

  test('should render summarize prompt with summary', () => {
    const inputs = new Inputs()
    inputs.rawSummary = 'Changed files: src/index.ts, src/utils.ts'
    inputs.shortSummary = 'Added new utility functions'

    const prompt = prompts.renderSummarize(inputs)

    expect(prompt).toContain('Changed files: src/index.ts, src/utils.ts')
    expect(prompt).toContain('Here is the summary')
  })

  test('should handle caller context in prompt', () => {
    const inputs = new Inputs()
    inputs.filename = 'src/utils.ts'
    inputs.title = 'Test PR'
    inputs.description = 'Test'
    inputs.patches = 'diff content'
    inputs.systemMessage = 'You are a reviewer.'
    inputs.callerContext = `## Caller Context

The function calculate() is called by:
- src/main.ts: processData()
- src/handler.ts: handleCalculation()

Consider how changes might affect these callers.`

    const prompt = prompts.renderReviewFileDiff(inputs)

    expect(prompt).toContain('## Caller Context')
    expect(prompt).toContain('src/main.ts: processData()')
    expect(prompt).toContain('handleCalculation()')
  })

  test('should replace caller context placeholder when provided', () => {
    const inputs = new Inputs()
    inputs.filename = 'src/index.ts'
    inputs.patches = 'diff'
    inputs.callerContext = 'Caller info here'

    const prompt = prompts.renderReviewFileDiff(inputs)

    expect(prompt).toContain('Caller info here')
    expect(prompt).not.toContain('$caller_context')
  })
})

describe('Mock PR Data Simulation', () => {
  test('should simulate PR with TypeScript changes', () => {
    const mockPR = {
      number: 1,
      title: 'feat: Add calculate and multiply utilities',
      body: 'This PR adds two new utility functions for math operations.',
      base: {sha: 'abc123', ref: 'main'},
      head: {sha: 'def456', ref: 'feature/math'}
    }

    const mockFiles = [
      {
        filename: 'src/utils.ts',
        status: 'added',
        patch: `@@ -0,0 +1,25 @@
+export function calculate(a: number, b: number): number {
+  return a + b;
+}`
      },
      {
        filename: 'src/index.ts',
        status: 'modified',
        patch: `@@ -1,5 +1,8 @@
-const result = 1;
+import {calculate} from './utils';`
      }
    ]

    expect(mockPR.number).toBe(1)
    expect(mockFiles).toHaveLength(2)
    expect(mockFiles[0].filename).toBe('src/utils.ts')
    expect(mockFiles[1].filename).toBe('src/index.ts')
  })

  test('should verify context-aware review structure', () => {
    const callerContext = `## Caller Context

Changed functions:
- src/utils.ts: calculate, multiply

These functions are used in:
- src/index.ts: sum, product

Review tip: Consider input validation for edge cases.`

    const prompt = `## Changes made to src/utils.ts

@@ code diff @@

${callerContext}`

    expect(prompt).toContain('## Caller Context')
    expect(prompt).toContain('calculate, multiply')
    expect(prompt).toContain('Review tip')
  })
})
