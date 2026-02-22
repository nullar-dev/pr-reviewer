import {expect, test, describe} from '@jest/globals'
import {Prompts} from '../src/prompts'
import {Inputs} from '../src/inputs'

describe('Prompts', () => {
  describe('constructor', () => {
    test('should create prompts with default values', () => {
      const prompts = new Prompts()
      expect(prompts.summarize).toBe('')
      expect(prompts.summarizeReleaseNotes).toBe('')
    })

    test('should create prompts with custom values', () => {
      const prompts = new Prompts('Custom summarize', 'Custom release notes')
      expect(prompts.summarize).toBe('Custom summarize')
      expect(prompts.summarizeReleaseNotes).toBe('Custom release notes')
    })
  })

  describe('renderSummarizeFileDiff', () => {
    test('should render summarize file diff prompt without triage', () => {
      const prompts = new Prompts('Summarize', 'Release notes')
      const inputs = new Inputs()
      inputs.title = 'Test PR'
      inputs.description = 'Test description'
      inputs.fileDiff = 'diff content'

      const result = prompts.renderSummarizeFileDiff(inputs, false)

      expect(result).toContain('Test PR')
      expect(result).toContain('Test description')
      expect(result).toContain('diff content')
    })

    test('should render summarize file diff prompt with triage', () => {
      const prompts = new Prompts('Summarize', 'Release notes')
      const inputs = new Inputs()
      inputs.title = 'Test PR'
      inputs.description = 'Test description'
      inputs.fileDiff = 'diff content'

      const result = prompts.renderSummarizeFileDiff(inputs, true)

      expect(result).toContain('Test PR')
      expect(result).toContain('Test description')
      expect(result).toContain('diff content')
    })

    test('should include triage instructions when reviewSimpleChanges is false', () => {
      const prompts = new Prompts('Summarize', 'Release notes')
      const inputs = new Inputs()
      inputs.title = 'Test PR'

      const result = prompts.renderSummarizeFileDiff(inputs, false)

      expect(result).toContain('NEEDS_REVIEW')
      expect(result).toContain('APPROVED')
    })

    test('should not include triage when reviewSimpleChanges is true', () => {
      const prompts = new Prompts('Summarize', 'Release notes')
      const inputs = new Inputs()
      inputs.title = 'Test PR'

      const result = prompts.renderSummarizeFileDiff(inputs, true)

      expect(result).not.toContain('NEEDS_REVIEW')
      expect(result).not.toContain('APPROVED')
    })
  })

  describe('renderSummarizeChangesets', () => {
    test('should render summarize changesets prompt', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.rawSummary = 'file1.ts: changed function A\nfile2.ts: added function B'

      const result = prompts.renderSummarizeChangesets(inputs)

      expect(result).toContain('file1.ts')
      expect(result).toContain('function A')
    })

    test('should handle empty rawSummary', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()

      const result = prompts.renderSummarizeChangesets(inputs)

      expect(result).toContain('deduplicate')
    })
  })

  describe('renderSummarize', () => {
    test('should render summarize prompt with summarize template', () => {
      const prompts = new Prompts('Custom summarize template')
      const inputs = new Inputs()
      inputs.rawSummary = 'Changed files: src/a.ts, src/b.ts'
      inputs.shortSummary = 'Added new feature'

      const result = prompts.renderSummarize(inputs)

      expect(result).toContain('Custom summarize template')
      expect(result).toContain('Changed files')
    })

    test('should handle empty summarize template', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.rawSummary = 'Test summary'

      const result = prompts.renderSummarize(inputs)

      expect(result).toContain('Test summary')
    })
  })

  describe('renderSummarizeShort', () => {
    test('should render summarize short prompt', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.rawSummary = 'Files changed: src/index.ts'

      const result = prompts.renderSummarizeShort(inputs)

      expect(result).toContain('Files changed: src/index.ts')
      expect(result).toContain('concise summary')
    })

    test('should handle empty inputs', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()

      const result = prompts.renderSummarizeShort(inputs)

      expect(result).toContain('concise summary')
    })
  })

  describe('renderSummarizeReleaseNotes', () => {
    test('should render release notes summarize prompt', () => {
      const prompts = new Prompts('Summarize', 'Release notes template')
      const inputs = new Inputs()
      inputs.rawSummary = 'Changes: feature X, bugfix Y'

      const result = prompts.renderSummarizeReleaseNotes(inputs)

      expect(result).toContain('Release notes template')
      expect(result).toContain('Changes: feature X')
    })

    test('should handle empty release notes template', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.rawSummary = 'Changes'

      const result = prompts.renderSummarizeReleaseNotes(inputs)

      expect(result).toContain('Changes')
    })
  })

  describe('renderComment', () => {
    test('should render comment prompt with all inputs', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.title = 'PR Title'
      inputs.description = 'PR Description'
      inputs.shortSummary = 'Summary'
      inputs.fileDiff = 'Full diff'
      inputs.filename = 'src/test.ts'
      inputs.diff = 'Hunk diff'
      inputs.commentChain = 'Previous comments'
      inputs.comment = 'New comment'

      const result = prompts.renderComment(inputs)

      expect(result).toContain('PR Title')
      expect(result).toContain('PR Description')
      expect(result).toContain('Summary')
      expect(result).toContain('src/test.ts')
      expect(result).toContain('Hunk diff')
      expect(result).toContain('Previous comments')
      expect(result).toContain('New comment')
    })

    test('should handle empty comment inputs', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()

      const result = prompts.renderComment(inputs)

      expect(result).toContain('no title provided')
    })
  })

  describe('renderReviewFileDiff', () => {
    test('should render review file diff with all inputs', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.title = 'Fix bug'
      inputs.description = 'Fixed a bug'
      inputs.shortSummary = 'Bug fix'
      inputs.filename = 'src/bug.ts'
      inputs.patches = '@@ code @@'
      inputs.callerContext = 'Called by main()'

      const result = prompts.renderReviewFileDiff(inputs)

      expect(result).toContain('Fix bug')
      expect(result).toContain('src/bug.ts')
      expect(result).toContain('Called by main()')
    })
  })

  describe('renderLeaderValidation', () => {
    test('should render leader validation prompt with all inputs', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.title = 'PR Title'
      inputs.description = 'Description'
      inputs.shortSummary = 'Summary'
      inputs.allFindings = 'Finding 1\nFinding 2'
      inputs.patches = 'Patch content'

      const result = prompts.renderLeaderValidation(inputs)

      expect(result).toContain('PR Title')
      expect(result).toContain('Description')
      expect(result).toContain('Summary')
      expect(result).toContain('Finding 1')
      expect(result).toContain('Finding 2')
      expect(result).toContain('Patch content')
      expect(result).toContain('leader reviewer')
    })

    test('should include severity format in prompt', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.title = 'Test'

      const result = prompts.renderLeaderValidation(inputs)

      expect(result).toContain('critical')
      expect(result).toContain('major')
      expect(result).toContain('minor')
      expect(result).toContain('nit')
    })

    test('should include accepted and discarded sections', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.title = 'Test'

      const result = prompts.renderLeaderValidation(inputs)

      expect(result).toContain('### Accepted Findings')
      expect(result).toContain('### Discarded Findings')
    })

    test('should handle empty findings', () => {
      const prompts = new Prompts()
      const inputs = new Inputs()
      inputs.title = 'Test'
      inputs.allFindings = ''

      const result = prompts.renderLeaderValidation(inputs)

      expect(result).toContain('### Accepted Findings')
      expect(result).toContain('### Discarded Findings')
    })
  })
})
