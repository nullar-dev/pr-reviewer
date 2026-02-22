import {expect, describe, test, jest, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  getInput: jest.fn((name: string) => {
    if (name === 'bot_icon') return '🤖'
    return ''
  })
}))

jest.mock('@actions/github', () => ({
  context: {
    repo: {owner: 'test-owner', repo: 'test-repo'},
    payload: {
      pull_request: {number: 123},
      issue: null
    }
  }
}))

jest.mock('../src/octokit', () => ({
  octokit: {
    issues: {
      createComment: jest.fn(),
      updateComment: jest.fn(),
      listComments: jest.fn()
    },
    pulls: {
      get: jest.fn(),
      update: jest.fn(),
      listReviews: jest.fn(),
      deletePendingReview: jest.fn(),
      createReview: jest.fn(),
      submitReview: jest.fn(),
      deleteReviewComment: jest.fn(),
      createReviewComment: jest.fn(),
      createReplyForReviewComment: jest.fn(),
      updateReviewComment: jest.fn(),
      listReviewComments: jest.fn(),
      listCommits: jest.fn()
    }
  }
}))

import {Commenter} from '../src/commenter'
import {
  COMMENT_TAG,
  COMMENT_REPLY_TAG,
  SUMMARIZE_TAG,
  COMMENT_GREETING,
  RAW_SUMMARY_START_TAG,
  RAW_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  DESCRIPTION_START_TAG,
  DESCRIPTION_END_TAG,
  COMMIT_ID_START_TAG,
  COMMIT_ID_END_TAG,
  IN_PROGRESS_START_TAG,
  IN_PROGRESS_END_TAG
} from '../src/commenter'

describe('Commenter constants', () => {
  test('COMMENT_TAG should be defined', () => {
    expect(COMMENT_TAG).toBe('<!-- This is an auto-generated comment by OSS NullarAI -->')
  })

  test('COMMENT_REPLY_TAG should be defined', () => {
    expect(COMMENT_REPLY_TAG).toBe('<!-- This is an auto-generated reply by OSS NullarAI -->')
  })

  test('SUMMARIZE_TAG should be defined', () => {
    expect(SUMMARIZE_TAG).toBe('<!-- This is an auto-generated comment: summarize by OSS NullarAI -->')
  })

  test('COMMENT_GREETING should be defined', () => {
    expect(COMMENT_GREETING).toBe('🤖   NullarAI')
  })

  test('RAW_SUMMARY_START_TAG and RAW_SUMMARY_END_TAG should be defined', () => {
    expect(RAW_SUMMARY_START_TAG).toContain('raw summary')
    expect(RAW_SUMMARY_END_TAG).toContain('raw summary')
  })

  test('SHORT_SUMMARY_START_TAG and SHORT_SUMMARY_END_TAG should be defined', () => {
    expect(SHORT_SUMMARY_START_TAG).toContain('short summary')
    expect(SHORT_SUMMARY_END_TAG).toContain('short summary')
  })

  test('DESCRIPTION_START_TAG and DESCRIPTION_END_TAG should be defined', () => {
    expect(DESCRIPTION_START_TAG).toContain('release notes')
    expect(DESCRIPTION_END_TAG).toContain('release notes')
  })

  test('COMMIT_ID_START_TAG and COMMIT_ID_END_TAG should be defined', () => {
    expect(COMMIT_ID_START_TAG).toBe('<!-- commit_ids_reviewed_start -->')
    expect(COMMIT_ID_END_TAG).toBe('<!-- commit_ids_reviewed_end -->')
  })

  test('IN_PROGRESS_START_TAG and IN_PROGRESS_END_TAG should be defined', () => {
    expect(IN_PROGRESS_START_TAG).toContain('in progress')
    expect(IN_PROGRESS_END_TAG).toContain('in progress')
  })
})

describe('Commenter - getContentWithinTags', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should extract content between tags', () => {
    const content = `before ${DESCRIPTION_START_TAG} extracted content ${DESCRIPTION_END_TAG} after`
    const result = commenter.getContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe(' extracted content ')
  })

  test('should return empty string when start tag not found', () => {
    const content = `before extracted content ${DESCRIPTION_END_TAG} after`
    const result = commenter.getContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('')
  })

  test('should return empty string when end tag not found', () => {
    const content = `before ${DESCRIPTION_START_TAG} extracted content after`
    const result = commenter.getContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('')
  })

  test('should return empty string when neither tag is found', () => {
    const content = 'just some text without tags'
    const result = commenter.getContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('')
  })

  test('should handle empty content', () => {
    const result = commenter.getContentWithinTags('', DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('')
  })

  test('should extract raw summary content', () => {
    const content = `${RAW_SUMMARY_START_TAG}This is the raw summary${RAW_SUMMARY_END_TAG}`
    const result = commenter.getContentWithinTags(content, RAW_SUMMARY_START_TAG, RAW_SUMMARY_END_TAG)
    expect(result).toBe('This is the raw summary')
  })

  test('should extract short summary content', () => {
    const content = `${SHORT_SUMMARY_START_TAG}Brief summary${SHORT_SUMMARY_END_TAG}`
    const result = commenter.getContentWithinTags(content, SHORT_SUMMARY_START_TAG, SHORT_SUMMARY_END_TAG)
    expect(result).toBe('Brief summary')
  })

  test('should handle multiple occurrences - returns first match', () => {
    const content = `${DESCRIPTION_START_TAG}first${DESCRIPTION_END_TAG} middle ${DESCRIPTION_START_TAG}second${DESCRIPTION_END_TAG}`
    const result = commenter.getContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('first')
  })
})

describe('Commenter - removeContentWithinTags', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should remove content between tags', () => {
    const content = `before ${DESCRIPTION_START_TAG} removed content ${DESCRIPTION_END_TAG} after`
    const result = commenter.removeContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('before  after')
  })

  test('should return original content when start tag not found', () => {
    const content = 'before removed content end after'
    const result = commenter.removeContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('before removed content end after')
  })

  test('should return original content when end tag not found', () => {
    const content = `before ${DESCRIPTION_START_TAG} removed content after`
    const result = commenter.removeContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe(`before ${DESCRIPTION_START_TAG} removed content after`)
  })

  test('should use lastIndexOf for end tag', () => {
    const content = `${DESCRIPTION_START_TAG}first${DESCRIPTION_END_TAG} middle ${DESCRIPTION_START_TAG}second${DESCRIPTION_END_TAG}`
    const result = commenter.removeContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('')
  })

  test('should handle content after the last end tag', () => {
    const content = `${DESCRIPTION_START_TAG}first${DESCRIPTION_END_TAG} middle after`
    const result = commenter.removeContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe(' middle after')
  })

  test('should return original content when neither tag is found', () => {
    const content = 'just some text without tags'
    const result = commenter.removeContentWithinTags(content, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('just some text without tags')
  })

  test('should handle empty content', () => {
    const result = commenter.removeContentWithinTags('', DESCRIPTION_START_TAG, DESCRIPTION_END_TAG)
    expect(result).toBe('')
  })
})

describe('Commenter - getRawSummary', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should extract raw summary from content', () => {
    const content = `${RAW_SUMMARY_START_TAG}This is the raw summary text.${RAW_SUMMARY_END_TAG}`
    const result = commenter.getRawSummary(content)
    expect(result).toBe('This is the raw summary text.')
  })

  test('should return empty string when no raw summary tags', () => {
    const content = 'Just some regular content without summary tags'
    const result = commenter.getRawSummary(content)
    expect(result).toBe('')
  })

  test('should return empty string when only start tag exists', () => {
    const content = `${RAW_SUMMARY_START_TAG}Partial content`
    const result = commenter.getRawSummary(content)
    expect(result).toBe('')
  })

  test('should handle multiline raw summary', () => {
    const content = `${RAW_SUMMARY_START_TAG}Line 1\nLine 2\nLine 3${RAW_SUMMARY_END_TAG}`
    const result = commenter.getRawSummary(content)
    expect(result).toBe('Line 1\nLine 2\nLine 3')
  })
})

describe('Commenter - getShortSummary', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should extract short summary from content', () => {
    const content = `${SHORT_SUMMARY_START_TAG}Brief summary here.${SHORT_SUMMARY_END_TAG}`
    const result = commenter.getShortSummary(content)
    expect(result).toBe('Brief summary here.')
  })

  test('should return empty string when no short summary tags', () => {
    const content = 'Just some regular content'
    const result = commenter.getShortSummary(content)
    expect(result).toBe('')
  })

  test('should return empty string when only start tag exists', () => {
    const content = `${SHORT_SUMMARY_START_TAG}Partial`
    const result = commenter.getShortSummary(content)
    expect(result).toBe('')
  })
})

describe('Commenter - getDescription', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should remove description tags from content', () => {
    const content = `Some intro ${DESCRIPTION_START_TAG}Release notes content${DESCRIPTION_END_TAG} Some outro`
    const result = commenter.getDescription(content)
    expect(result).toBe('Some intro  Some outro')
  })

  test('should return full content when no description tags', () => {
    const content = 'Just some content without description tags'
    const result = commenter.getDescription(content)
    expect(result).toBe('Just some content without description tags')
  })

  test('should return full content when only start tag exists', () => {
    const content = `Some content ${DESCRIPTION_START_TAG} partial`
    const result = commenter.getDescription(content)
    expect(result).toBe(`Some content ${DESCRIPTION_START_TAG} partial`)
  })

  test('should remove only the last pair of description tags', () => {
    const content = `${DESCRIPTION_START_TAG}First${DESCRIPTION_END_TAG} middle ${DESCRIPTION_START_TAG}Second${DESCRIPTION_END_TAG}`
    const result = commenter.getDescription(content)
    expect(result).toBe('')
  })
})

describe('Commenter - getReleaseNotes', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should extract release notes without blockquotes', () => {
    const content = `${DESCRIPTION_START_TAG}> Blockquote line\nRegular line${DESCRIPTION_END_TAG}`
    const result = commenter.getReleaseNotes(content)
    expect(result).toBe('\nRegular line')
  })

  test('should remove all blockquote lines', () => {
    const content = `${DESCRIPTION_START_TAG}> Line 1\n> Line 2\nContent${DESCRIPTION_END_TAG}`
    const result = commenter.getReleaseNotes(content)
    expect(result).toBe('\nContent')
  })
})

describe('Commenter - getReviewedCommitIds', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should extract commit IDs from comment body', () => {
    const body = `some content ${COMMIT_ID_START_TAG}<!-- abc123 --> <!-- def456 -->${COMMIT_ID_END_TAG} more content`
    const result = commenter.getReviewedCommitIds(body)
    expect(result).toEqual(['abc123', 'def456'])
  })

  test('should return empty array when no commit IDs block', () => {
    const body = 'some content without commit IDs'
    const result = commenter.getReviewedCommitIds(body)
    expect(result).toEqual([])
  })

  test('should return empty array when only start tag exists', () => {
    const body = `some content ${COMMIT_ID_START_TAG} content`
    const result = commenter.getReviewedCommitIds(body)
    expect(result).toEqual([])
  })

  test('should return empty array when only end tag exists', () => {
    const body = `some content ${COMMIT_ID_END_TAG} content`
    const result = commenter.getReviewedCommitIds(body)
    expect(result).toEqual([])
  })

  test('should handle empty commit IDs block', () => {
    const body = `${COMMIT_ID_START_TAG}${COMMIT_ID_END_TAG}`
    const result = commenter.getReviewedCommitIds(body)
    expect(result).toEqual([])
  })

  test('should filter out empty strings', () => {
    const body = `${COMMIT_ID_START_TAG}<!-- abc -->  <!-- --> <!-- def -->${COMMIT_ID_END_TAG}`
    const result = commenter.getReviewedCommitIds(body)
    expect(result).toEqual(['abc', 'def'])
  })
})

describe('Commenter - addReviewedCommitId', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should add commit ID when no block exists', () => {
    const body = 'original content'
    const result = commenter.addReviewedCommitId(body, 'abc123')
    expect(result).toContain(COMMIT_ID_START_TAG)
    expect(result).toContain('<!-- abc123 -->')
    expect(result).toContain(COMMIT_ID_END_TAG)
  })

  test('should append commit ID to existing block', () => {
    const body = `${COMMIT_ID_START_TAG}<!-- existing -->\n${COMMIT_ID_END_TAG}`
    const result = commenter.addReviewedCommitId(body, 'new123')
    expect(result).toContain('<!-- existing -->')
    expect(result).toContain('<!-- new123 -->')
  })
})

describe('Commenter - getHighestReviewedCommitId', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should find highest reviewed commit ID', () => {
    const commitIds = ['aaa', 'bbb', 'ccc', 'ddd']
    const reviewedIds = ['bbb', 'ccc']
    const result = commenter.getHighestReviewedCommitId(commitIds, reviewedIds)
    expect(result).toBe('ccc')
  })

  test('should return empty string when no reviewed IDs', () => {
    const commitIds = ['aaa', 'bbb', 'ccc']
    const reviewedIds: string[] = []
    const result = commenter.getHighestReviewedCommitId(commitIds, reviewedIds)
    expect(result).toBe('')
  })

  test('should return empty string when no match', () => {
    const commitIds = ['aaa', 'bbb', 'ccc']
    const reviewedIds = ['xxx', 'yyy']
    const result = commenter.getHighestReviewedCommitId(commitIds, reviewedIds)
    expect(result).toBe('')
  })
})

describe('Commenter - in-progress status', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('addInProgressStatus should add in-progress tags when not present', () => {
    const body = 'original content'
    const result = commenter.addInProgressStatus(body, 'Analyzing...')
    expect(result).toContain(IN_PROGRESS_START_TAG)
    expect(result).toContain(IN_PROGRESS_END_TAG)
    expect(result).toContain('Analyzing...')
    expect(result).toContain('original content')
  })

  test('addInProgressStatus should not modify when already in progress', () => {
    const body = `${IN_PROGRESS_START_TAG} content ${IN_PROGRESS_END_TAG}`
    const result = commenter.addInProgressStatus(body, 'New status')
    expect(result).toBe(`${IN_PROGRESS_START_TAG} content ${IN_PROGRESS_END_TAG}`)
  })

  test('removeInProgressStatus should remove in-progress tags', () => {
    const body = `${IN_PROGRESS_START_TAG} content ${IN_PROGRESS_END_TAG} actual content`
    const result = commenter.removeInProgressStatus(body)
    expect(result).toBe(' actual content')
  })

  test('removeInProgressStatus should return original when not in progress', () => {
    const body = 'regular content'
    const result = commenter.removeInProgressStatus(body)
    expect(result).toBe('regular content')
  })
})

describe('Commenter - bufferReviewComment', () => {
  let commenter: Commenter

  beforeEach(() => {
    commenter = new Commenter()
  })

  test('should buffer review comment with greeting and tag', async () => {
    await commenter.bufferReviewComment('src/main.ts', 10, 15, 'Please fix this')
    
    const buffer = (commenter as any).reviewCommentsBuffer
    expect(buffer.length).toBe(1)
    expect(buffer[0].path).toBe('src/main.ts')
    expect(buffer[0].startLine).toBe(10)
    expect(buffer[0].endLine).toBe(15)
    expect(buffer[0].message).toContain('Please fix this')
    expect(buffer[0].message).toContain(COMMENT_TAG)
    expect(buffer[0].message).toContain(COMMENT_GREETING)
  })
})

describe('Commenter integration - mocked API calls', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()
  })

  test('listComments should use cache on second call', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.listComments as any).mockResolvedValueOnce({
      data: [{id: 1, body: 'comment 1'}]
    })
    
    const result1 = await commenter.listComments(123)
    expect(result1.length).toBe(1)
    
    const result2 = await commenter.listComments(123)
    expect(result2.length).toBe(1)
    expect(octokit.issues.listComments).toHaveBeenCalledTimes(1)
  })

  test('listReviewComments should use cache', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.listReviewComments as any).mockResolvedValueOnce({
      data: [{id: 1, body: 'review comment'}]
    })
    
    const result1 = await commenter.listReviewComments(123)
    expect(result1.length).toBe(1)
    
    const result2 = await commenter.listReviewComments(123)
    expect(result2.length).toBe(1)
    expect(octokit.pulls.listReviewComments).toHaveBeenCalledTimes(1)
  })

  test('findCommentWithTag should find comment with matching tag', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.listComments as any).mockResolvedValueOnce({
      data: [
        {id: 1, body: 'regular comment'},
        {id: 2, body: `comment with ${COMMENT_TAG}`},
        {id: 3, body: 'another comment'}
      ]
    })
    
    const result = await commenter.findCommentWithTag(COMMENT_TAG, 123)
    expect(result).not.toBeNull()
    expect(result?.id).toBe(2)
  })

  test('findCommentWithTag should return null when no match', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.listComments as any).mockResolvedValueOnce({
      data: [
        {id: 1, body: 'regular comment'},
        {id: 2, body: 'another comment'}
      ]
    })
    
    const result = await commenter.findCommentWithTag(COMMENT_TAG, 123)
    expect(result).toBeNull()
  })
})

describe('Commenter - comment method', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()
  })

  test('comment with create mode should call create', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.createComment as any).mockResolvedValueOnce({ data: { id: 1 } })
    
    await commenter.comment('Test message', COMMENT_TAG, 'create')
    
    expect(octokit.issues.createComment).toHaveBeenCalled()
  })

  test('comment with replace mode should call replace', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.listComments as any).mockResolvedValueOnce({ data: [] })
    ;(octokit.issues.createComment as any).mockResolvedValueOnce({ data: { id: 1 } })
    
    await commenter.comment('Test message', COMMENT_TAG, 'replace')
    
    expect(octokit.issues.listComments).toHaveBeenCalled()
  })

  test('comment should use default tag when not provided', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.createComment as any).mockResolvedValueOnce({ data: { id: 1 } })
    
    await commenter.comment('Test message', '', 'create')
    
    const call = (octokit.issues.createComment as any).mock.calls[0][0]
    expect(call.body).toContain(COMMENT_TAG)
  })

  test('comment should handle unknown mode gracefully', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.listComments as any).mockResolvedValueOnce({ data: [] })
    ;(octokit.issues.createComment as any).mockResolvedValueOnce({ data: { id: 1 } })
    
    await commenter.comment('Test message', COMMENT_TAG, 'unknown')
    
    expect(octokit.issues.listComments).toHaveBeenCalled()
  })

  test('comment should return early when no pull_request or issue', async () => {
    const {context} = require('@actions/github') as any
    const originalPayload = context.payload
    
    context.payload = {}
    
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    await commenter.comment('Test message', COMMENT_TAG, 'create')
    
    expect(octokit.issues.createComment).not.toHaveBeenCalled()
    
    context.payload = originalPayload
  })
})

describe('Commenter - updateDescription method', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()
  })

  test('updateDescription should update PR description with tags', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.get as any).mockResolvedValueOnce({
      data: { body: `${DESCRIPTION_START_TAG}old notes${DESCRIPTION_END_TAG}` }
    })
    ;(octokit.pulls.update as any).mockResolvedValueOnce({ data: {} })
    
    await commenter.updateDescription(123, 'New release notes')
    
    expect(octokit.pulls.get).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123
    })
    expect(octokit.pulls.update).toHaveBeenCalled()
  })

  test('updateDescription should handle error gracefully', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.get as any).mockRejectedValueOnce(new Error('Network error'))
    
    await expect(commenter.updateDescription(123, 'New release notes')).resolves.not.toThrow()
  })
})

describe('Commenter - reviewCommentReply method', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()
  })

  test('reviewCommentReply should create reply and update comment', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.createReplyForReviewComment as any).mockResolvedValueOnce({ data: {} })
    ;(octokit.pulls.updateReviewComment as any).mockResolvedValueOnce({ data: {} })
    
    const topLevelComment = {
      id: 123,
      body: `Some comment ${COMMENT_TAG}`,
      user: { login: 'testuser' }
    }
    
    await commenter.reviewCommentReply(456, topLevelComment, 'Reply message')
    
    expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalled()
    expect(octokit.pulls.updateReviewComment).toHaveBeenCalled()
  })

  test('reviewCommentReply should not update when no COMMENT_TAG', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.createReplyForReviewComment as any).mockResolvedValueOnce({ data: {} })
    
    const topLevelComment = {
      id: 123,
      body: 'Regular comment without tag',
      user: { login: 'testuser' }
    }
    
    await commenter.reviewCommentReply(456, topLevelComment, 'Reply message')
    
    expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalled()
    expect(octokit.pulls.updateReviewComment).not.toHaveBeenCalled()
  })
})

describe('Commenter - submitReview method', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()
  })

  test('submitReview with no buffered comments should create empty review', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.createReview as any).mockResolvedValueOnce({ data: { id: 1 } })
    
    await commenter.submitReview(123, 'abc123', 'LGTM!')
    
    const call = (octokit.pulls.createReview as any).mock.calls[0][0]
    expect(call.event).toBe('COMMENT')
    expect(call.comments).toBeUndefined()
  })

  test('submitReview with buffered comments should create review with comments', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    await commenter.bufferReviewComment('src/file.ts', 10, 10, 'Fix this issue')
    
    ;(octokit.pulls.listReviewComments as any).mockResolvedValueOnce({ data: [] })
    ;(octokit.pulls.createReview as any).mockResolvedValueOnce({ data: { id: 1 } })
    ;(octokit.pulls.submitReview as any).mockResolvedValueOnce({ data: {} })
    
    await commenter.submitReview(123, 'abc123', 'Please address comments')
    
    const call = (octokit.pulls.createReview as any).mock.calls[0][0]
    expect(call.comments).toHaveLength(1)
    expect(call.comments[0].path).toBe('src/file.ts')
  })
})

describe('Commenter - getAllCommitIds method', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()
  })

  test('getAllCommitIds should return all commit SHAs', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.listCommits as any).mockReturnValue(
      Promise.resolve({ data: [{ sha: 'abc123' }, { sha: 'def456' }, { sha: 'ghi789' }] })
    )
    
    const result = await commenter.getAllCommitIds()
    
    expect(result).toEqual(['abc123', 'def456', 'ghi789'])
  })

  test('getAllCommitIds should return empty array when no PR', async () => {
    const {context} = require('@actions/github') as any
    const originalPayload = context.payload
    
    context.payload = {}
    
    const result = await commenter.getAllCommitIds()
    
    expect(result).toEqual([])
    
    context.payload = originalPayload
  })
})

describe('Commenter - pagination for listComments and listReviewComments', () => {
  let commenter: Commenter

  beforeEach(() => {
    jest.clearAllMocks()
    commenter = new Commenter()
  })

  test('listComments should return empty array on error', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.issues.listComments as any).mockRejectedValueOnce(new Error('API error'))
    
    const result = await commenter.listComments(123)
    
    expect(result).toEqual([])
  })

  test('listReviewComments should return empty array on error', async () => {
    const octokitModule = require('../src/octokit') as {octokit: any}
    const octokit = octokitModule.octokit
    
    ;(octokit.pulls.listReviewComments as any).mockRejectedValueOnce(new Error('API error'))
    
    const result = await commenter.listReviewComments(123)
    
    expect(result).toEqual([])
  })
})
