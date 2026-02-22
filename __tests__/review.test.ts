import {expect, describe, it, jest} from '@jest/globals'

jest.mock('@actions/core', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warning: jest.fn()
}))

jest.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'test', repo: 'test-repo' },
    payload: { pull_request: null }
  }
}))

jest.mock('../src/commenter', () => ({
  Commenter: jest.fn().mockImplementation(() => ({
    getDescription: jest.fn(() => ''),
    getRawSummary: jest.fn(() => ''),
    getShortSummary: jest.fn(() => ''),
    getReviewedCommitIdsBlock: jest.fn(() => ''),
    getHighestReviewedCommitId: jest.fn(() => ''),
    getAllCommitIds: jest.fn(() => []),
    findCommentWithTag: jest.fn(() => null),
    getCommentChainsWithinRange: jest.fn(() => ''),
    comment: jest.fn(),
    addReviewedCommitId: jest.fn(() => ''),
    updateDescription: jest.fn()
  }))
}))

jest.mock('../src/octokit', () => ({
  octokit: {
    repos: {
      compareCommits: jest.fn(),
      getContent: jest.fn()
    }
  }
}))

jest.mock('p-limit', () => ({
  default: jest.fn(() => jest.fn((fn: unknown) => fn as unknown))
}))

jest.mock('../src/tokenizer', () => ({
  getTokenCount: jest.fn(() => 100)
}))

import {
  splitPatch,
  patchStartEndLine,
  parsePatch,
  parseReview,
  sanitizeCodeBlock,
  parseLeaderAcceptedFindings,
  parseLeaderDiscardedFindings,
  capitalize,
  extractDefinitions
} from '../src/review'

describe('splitPatch', () => {
  it('should return empty array for null input', () => {
    expect(splitPatch(null)).toEqual([])
  })

  it('should return empty array for undefined input', () => {
    expect(splitPatch(undefined)).toEqual([])
  })

  it('should return empty array for empty string', () => {
    expect(splitPatch('')).toEqual([])
  })

  it('should split a single hunk patch', () => {
    const patch = `@@ -1,3 +1,4 @@
 context line
-old line
+new line
+added line`
    const result = splitPatch(patch)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('@@ -1,3 +1,4 @@')
  })

  it('should split a multi-hunk patch', () => {
    const patch = `@@ -1,3 +1,4 @@
 context
-old
+new
+added

@@ -10,3 +11,4 @@
 more context
-removed
+changed
+added`
    const result = splitPatch(patch)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('@@ -1,3 +1,4 @@')
    expect(result[1]).toContain('@@ -10,3 +11,4 @@')
  })

  it('should handle patch with three hunks', () => {
    const patch = `@@ -1,1 +1,2 @@
 a
+b

@@ -5,1 +6,2 @@
 c
+d

@@ -10,1 +11,2 @@
 e
+f`
    const result = splitPatch(patch)
    expect(result).toHaveLength(3)
  })
})

describe('patchStartEndLine', () => {
  it('should return null for invalid patch', () => {
    expect(patchStartEndLine('invalid')).toBeNull()
  })

  it('should parse hunk header correctly', () => {
    const patch = `@@ -10,5 +12,7 @@ context`
    const result = patchStartEndLine(patch)
    expect(result).not.toBeNull()
    expect(result?.oldHunk.startLine).toBe(10)
    expect(result?.oldHunk.endLine).toBe(14)
    expect(result?.newHunk.startLine).toBe(12)
    expect(result?.newHunk.endLine).toBe(18)
  })

  it('should handle single line hunk', () => {
    const patch = `@@ -5,1 +5,1 @@ context`
    const result = patchStartEndLine(patch)
    expect(result).not.toBeNull()
    expect(result?.oldHunk.startLine).toBe(5)
    expect(result?.oldHunk.endLine).toBe(5)
    expect(result?.newHunk.startLine).toBe(5)
    expect(result?.newHunk.endLine).toBe(5)
  })

  it('should handle zero-length hunk', () => {
    const patch = `@@ -5,0 +5,2 @@ context`
    const result = patchStartEndLine(patch)
    expect(result).not.toBeNull()
    expect(result?.oldHunk.startLine).toBe(5)
    expect(result?.oldHunk.endLine).toBe(4)
    expect(result?.newHunk.startLine).toBe(5)
    expect(result?.newHunk.endLine).toBe(6)
  })
})

describe('parsePatch', () => {
  it('should return null for invalid patch', () => {
    expect(parsePatch('invalid')).toBeNull()
  })

  it('should parse simple patch with additions', () => {
    const patch = `@@ -1,2 +1,3 @@
 context
-old
+new
+added`
    const result = parsePatch(patch)
    expect(result).not.toBeNull()
    expect(result?.oldHunk).toContain('context')
    expect(result?.oldHunk).toContain('old')
    expect(result?.newHunk).toContain('added')
  })

  it('should parse patch with deletions only', () => {
    const patch = `@@ -1,3 +1,2 @@
 context
-old1
-old2
+new`
    const result = parsePatch(patch)
    expect(result).not.toBeNull()
    expect(result?.oldHunk).toContain('old1')
    expect(result?.oldHunk).toContain('old2')
  })

  it('should add line numbers to new hunk', () => {
    const patch = `@@ -1,1 +1,2 @@
 existing
+new line`
    const result = parsePatch(patch)
    expect(result?.newHunk).toMatch(/\d+: new line/)
  })
})

describe('parseReview', () => {
  it('should return empty array for empty response', () => {
    expect(parseReview('', [])).toEqual([])
  })

  it('should parse simple review with line range', () => {
    const response = `5-10:
This is a comment
---`
    const patches: Array<[number, number, string]> = [[5, 20, 'patch content']]
    const result = parseReview(response, patches)
    expect(result).toHaveLength(1)
    expect(result[0].startLine).toBe(5)
    expect(result[0].endLine).toBe(10)
    expect(result[0].comment).toContain('This is a comment')
  })

  it('should parse multiple reviews', () => {
    const response = `5-7:
First comment
---
10-12:
Second comment
---`
    const patches: Array<[number, number, string]> = [[1, 30, 'patch content']]
    const result = parseReview(response, patches)
    expect(result).toHaveLength(2)
    expect(result[0].startLine).toBe(5)
    expect(result[1].startLine).toBe(10)
  })

  it('should handle multiline comments', () => {
    const response = `5-5:
Consider using a constant here
This is a more detailed explanation
of the comment spanning multiple lines.
---`
    const patches: Array<[number, number, string]> = [[1, 10, 'patch content']]
    const result = parseReview(response, patches)
    expect(result).toHaveLength(1)
    expect(result[0].comment).toContain('Consider using a constant')
    expect(result[0].comment).toContain('spanning multiple lines')
  })

  it('should map review outside patch to nearest patch', () => {
    const response = `100-105:
Review outside patch
---`
    const patches: Array<[number, number, string]> = [[1, 50, 'patch content']]
    const result = parseReview(response, patches)
    expect(result).toHaveLength(1)
    expect(result[0].comment).toContain('outside of the patch')
    expect(result[0].startLine).toBe(1)
    expect(result[0].endLine).toBe(50)
  })
})

describe('sanitizeCodeBlock', () => {
  it('should remove line numbers from suggestion blocks', () => {
    const input = `Some text
\`\`\`suggestion
1: const x = 1
2: const y = 2
\`\`\`
More text`
    const result = sanitizeCodeBlock(input, 'suggestion')
    expect(result).not.toContain('1: ')
    expect(result).not.toContain('2: ')
    expect(result).toContain('const x = 1')
    expect(result).toContain('const y = 2')
  })

  it('should remove line numbers from diff blocks', () => {
    const input = `\`\`\`diff
1: -old
2: +new
\`\`\``
    const result = sanitizeCodeBlock(input, 'diff')
    expect(result).not.toMatch(/^\d+: /m)
  })

  it('should handle multiple code blocks', () => {
    const input = `First block:
\`\`\`suggestion
1: code1
\`\`\`

Second block:
\`\`\`diff
1: code2
\`\`\``
    const result = sanitizeCodeBlock(sanitizeCodeBlock(input, 'suggestion'), 'diff')
    expect(result).not.toMatch(/^\d+: /m)
  })

  it('should not modify text without line numbers', () => {
    const input = `Some text without line numbers`
    const result = sanitizeCodeBlock(input, 'suggestion')
    expect(result).toBe(input)
  })

  it('should handle empty code blocks', () => {
    const input = `\`\`\`suggestion
\`\`\``
    const result = sanitizeCodeBlock(input, 'suggestion')
    expect(result).toBe(input)
  })
})

describe('parseLeaderAcceptedFindings', () => {
  it('should return empty array when no accepted findings section', () => {
    expect(parseLeaderAcceptedFindings('No findings here')).toEqual([])
  })

  it('should return empty array for empty accepted section', () => {
    const response = `### Accepted Findings

None`
    expect(parseLeaderAcceptedFindings(response)).toEqual([])
  })

  it('should parse accepted findings with all fields', () => {
    const response = `### Accepted Findings
---
[SEVERITY]: critical
[FILE]: src/index.ts
[LINES]: 10-15
[TITLE]: Security issue
[DETAILS]: Found a vulnerability
---
[SEVERITY]: major
[FILE]: src/utils.ts
[LINES]: 20-25
[TITLE]: Performance issue
[DETAILS]: Should optimize this

### Discarded Findings
None`
    const result = parseLeaderAcceptedFindings(response)
    expect(result).toHaveLength(2)
    expect(result[0].severity).toBe('critical')
    expect(result[0].file).toBe('src/index.ts')
    expect(result[0].lines).toBe('10-15')
    expect(result[0].title).toBe('Security issue')
    expect(result[1].severity).toBe('major')
  })

  it('should handle case-insensitive severity', () => {
    const response = `### Accepted Findings
---
[SEVERITY]: MAJOR
[FILE]: test.js
[LINES]: 1-5
[TITLE]: Test
[DETAILS]: Details

### Discarded Findings
None`
    const result = parseLeaderAcceptedFindings(response)
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('major')
  })

  it('should filter out incomplete findings', () => {
    const response = `### Accepted Findings
---
[SEVERITY]: critical
[FILE]: src.ts
[LINES]: 1-5
---`
    const result = parseLeaderAcceptedFindings(response)
    expect(result).toHaveLength(0)
  })
})

describe('parseLeaderDiscardedFindings', () => {
  it('should return empty array when no discarded findings section', () => {
    expect(parseLeaderDiscardedFindings('No findings here')).toEqual([])
  })

  it('should return empty array for empty discarded section', () => {
    const response = `### Discarded Findings

None`
    expect(parseLeaderDiscardedFindings(response)).toEqual([])
  })

  it('should parse discarded findings with all fields', () => {
    const response = `### Discarded Findings
---
[REASON]: Not actionable
[ORIGINAL]: Some original finding
---
[REASON]: Already fixed
[ORIGINAL]: Another finding`
    const result = parseLeaderDiscardedFindings(response)
    expect(result).toHaveLength(2)
    expect(result[0].reason).toBe('Not actionable')
    expect(result[0].original).toBe('Some original finding')
    expect(result[1].reason).toBe('Already fixed')
  })

  it('should filter out incomplete discarded findings', () => {
    const response = `### Discarded Findings
---
[REASON]: Just a reason`
    const result = parseLeaderDiscardedFindings(response)
    expect(result).toHaveLength(0)
  })
})

describe('capitalize', () => {
  it('should capitalize first letter', () => {
    expect(capitalize('hello')).toBe('Hello')
  })

  it('should handle empty string', () => {
    expect(capitalize('')).toBe('')
  })

  it('should handle single character', () => {
    expect(capitalize('a')).toBe('A')
  })

  it('should not change already capitalized', () => {
    expect(capitalize('Hello')).toBe('Hello')
  })

  it('should handle all caps', () => {
    expect(capitalize('HELLO')).toBe('HELLO')
  })
})

describe('extractDefinitions', () => {
  it('should extract TypeScript function definitions', () => {
    const content = `function myFunction() {}
export async function anotherFunction() {}
const arrowFn = () => {}`
    const result = extractDefinitions(content, 'test.ts')
    expect(result).toContain('myFunction')
    expect(result).toContain('anotherFunction')
  })

  it('should extract class definitions', () => {
    const content = `class MyClass {}
export class AnotherClass {}`
    const result = extractDefinitions(content, 'test.ts')
    expect(result).toContain('MyClass')
    expect(result).toContain('AnotherClass')
  })

  it('should filter out private definitions', () => {
    const content = `function _private() {}
function public() {}`
    const result = extractDefinitions(content, 'test.ts')
    expect(result).toContain('public')
    expect(result).not.toContain('_private')
  })

  it('should extract Python definitions', () => {
    const content = `def my_function():
    pass

class MyClass:
    pass`
    const result = extractDefinitions(content, 'test.py')
    expect(result).toContain('my_function')
    expect(result).toContain('MyClass')
  })

  it('should extract Go definitions', () => {
    const content = `func myFunc() {}
func (t Type) Method() {}
type MyStruct struct {}`
    const result = extractDefinitions(content, 'test.go')
    expect(result).toContain('myFunc')
    expect(result).toContain('Method')
    expect(result).toContain('MyStruct')
  })

  it('should extract Rust definitions', () => {
    const content = `fn my_function() {}
pub async fn another_fn() {}
struct MyStruct {}
enum MyEnum {}`
    const result = extractDefinitions(content, 'test.rs')
    expect(result).toContain('my_function')
    expect(result).toContain('another_fn')
    expect(result).toContain('MyStruct')
    expect(result).toContain('MyEnum')
  })

  it('should extract Java definitions', () => {
    const content = `public class MyClass {
    public void myMethod() {}
    private static String staticMethod() {}
}`
    const result = extractDefinitions(content, 'test.java')
    expect(result).toContain('MyClass')
    expect(result).toContain('myMethod')
    expect(result).toContain('staticMethod')
  })

  it('should return empty array for unknown file type', () => {
    const content = `some code`
    const result = extractDefinitions(content, 'test.unknown')
    expect(result).toEqual([])
  })

  it('should return unique definitions only', () => {
    const content = `function foo() {}
function foo() {}`
    const result = extractDefinitions(content, 'test.ts')
    expect(result.filter(d => d === 'foo')).toHaveLength(1)
  })
})
