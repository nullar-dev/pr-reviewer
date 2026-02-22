import {expect, describe, it, jest, beforeEach} from '@jest/globals'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}))

jest.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request_review_comment',
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      action: 'created',
      comment: {
        id: 1,
        body: 'Test comment from user',
        user: { login: 'test-user' },
        path: 'src/index.ts',
        diff_hunk: '@@ -1,5 +1,6 @@\n const foo = 1;'
      },
      pull_request: {
        number: 1,
        title: 'Test PR',
        body: 'Test PR description',
        base: { sha: 'base-sha' },
        head: { sha: 'head-sha' }
      },
      repository: { full_name: 'test-owner/test-repo' }
    }
  }
}))

jest.mock('../src/commenter', () => ({
  Commenter: jest.fn().mockImplementation(() => ({
    getDescription: jest.fn(() => 'description'),
    getCommentChain: jest.fn(() => Promise.resolve({
      chain: 'no other comments',
      topLevelComment: { id: 1 }
    })),
    reviewCommentReply: jest.fn(() => Promise.resolve()),
    findCommentWithTag: jest.fn(() => Promise.resolve(null)),
    getShortSummary: jest.fn(() => 'short summary')
  })),
  COMMENT_TAG: '<!-- This is an auto-generated comment by OSS NullarAI -->',
  COMMENT_REPLY_TAG: '<!-- This is an auto-generated reply by OSS NullarAI -->',
  SUMMARIZE_TAG: '<!-- This is an auto-generated comment: summarize by OSS NullarAI -->'
}))

jest.mock('../src/inputs', () => ({
  Inputs: jest.fn().mockImplementation(() => ({
    title: '',
    description: '',
    comment: '',
    diff: '',
    filename: '',
    commentChain: '',
    fileDiff: '',
    shortSummary: ''
  }))
}))

jest.mock('../src/octokit', () => ({
  octokit: {
    repos: {
      compareCommits: jest.fn(() => Promise.resolve({
        data: {
          files: [{ filename: 'src/index.ts', patch: 'patch content' }]
        }
      }))
    }
  }
}))

import {context as githubContext} from '@actions/github'
import {
  COMMENT_REPLY_TAG,
  COMMENT_TAG
} from '../src/commenter'
import {handleReviewComment} from '../src/review-comment'

describe('review-comment.ts', () => {
  let mockBot: any
  let mockOptions: any
  let mockPrompts: any
  let mockCore: any

  beforeEach(() => {
    jest.clearAllMocks()

    Object.assign(githubContext, {
      eventName: 'pull_request_review_comment',
      repo: { owner: 'test-owner', repo: 'test-repo' },
      payload: {
        action: 'created',
        comment: {
          id: 1,
          body: 'Test comment from user',
          user: { login: 'test-user' },
          path: 'src/index.ts',
          diff_hunk: '@@ -1,5 +1,6 @@\n const foo = 1;'
        },
        pull_request: {
          number: 1,
          title: 'Test PR',
          body: 'Test PR description',
          base: { sha: 'base-sha' },
          head: { sha: 'head-sha' }
        },
        repository: { full_name: 'test-owner/test-repo' }
      }
    })

    mockCore = require('@actions/core')

    mockBot = {
      chat: jest.fn(() => Promise.resolve(['AI response', {}]))
    }

    mockOptions = {
      leaderTokenLimits: {
        requestTokens: 8000
      }
    }

    mockPrompts = {
      renderComment: jest.fn(() => 'rendered prompt'),
      comment: '$file_diff is used here'
    }
  })

  describe('verifyWebhookSignature', () => {
    const verifyWebhookSignature = (
      signature: string,
      payload: string,
      secret: string
    ): boolean => {
      const crypto = require('crypto')
      const hash = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex')
      return `sha256=${hash}` === signature
    }

    it('should return true for valid signature', () => {
      const crypto = require('crypto')
      const payload = '{"action":"created"}'
      const secret = 'test-secret'
      const hash = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex')
      const signature = `sha256=${hash}`

      const result = verifyWebhookSignature(signature, payload, secret)

      expect(result).toBe(true)
    })

    it('should return false for invalid signature', () => {
      const payload = '{"action":"created"}'
      const secret = 'test-secret'
      const signature = 'sha256=invalid-signature'

      const result = verifyWebhookSignature(signature, payload, secret)

      expect(result).toBe(false)
    })

    it('should return false for tampered payload', () => {
      const crypto = require('crypto')
      const payload = '{"action":"created"}'
      const secret = 'test-secret'
      const hash = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex')
      const signature = `sha256=${hash}`
      const tamperedPayload = '{"action":"deleted"}'

      const result = verifyWebhookSignature(signature, tamperedPayload, secret)

      expect(result).toBe(false)
    })

    it('should return false for wrong secret', () => {
      const crypto = require('crypto')
      const payload = '{"action":"created"}'
      const correctSecret = 'correct-secret'
      const wrongSecret = 'wrong-secret'
      const hash = crypto
        .createHmac('sha256', correctSecret)
        .update(payload, 'utf8')
        .digest('hex')
      const signature = `sha256=${hash}`

      const result = verifyWebhookSignature(signature, payload, wrongSecret)

      expect(result).toBe(false)
    })

    it('should handle empty signature', () => {
      const payload = '{"action":"created"}'
      const secret = 'test-secret'
      const signature = ''

      const result = verifyWebhookSignature(signature, payload, secret)

      expect(result).toBe(false)
    })
  })

  describe('Event type handling', () => {
    it('should skip non pull_request_review_comment events', async () => {
      githubContext.eventName = 'push'

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.warning).toHaveBeenCalledWith(
        'Skipped: push is not a pull_request_review_comment event'
      )
    })

    it('should skip when payload is missing', async () => {
      githubContext.payload = null as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.warning).toHaveBeenCalledWith(
        'Skipped: pull_request_review_comment event is missing payload'
      )
    })

    it('should skip when comment is missing in payload', async () => {
      githubContext.payload = {
        action: 'created',
        comment: null,
        pull_request: { number: 1 },
        repository: { full_name: 'test' }
      } as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.warning).toHaveBeenCalledWith(
        'Skipped: pull_request_review_comment event is missing comment'
      )
    })

    it('should skip when pull_request is missing', async () => {
      githubContext.payload = {
        action: 'created',
        comment: { id: 1, body: 'test', user: { login: 'user' } },
        pull_request: null,
        repository: { full_name: 'test' }
      } as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.warning).toHaveBeenCalledWith(
        'Skipped: pull_request_review_comment event is missing pull_request'
      )
    })

    it('should skip when action is not created', async () => {
      githubContext.payload = {
        action: 'edited',
        comment: { id: 1, body: 'test', user: { login: 'user' } },
        pull_request: { number: 1 },
        repository: { full_name: 'test' }
      } as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.warning).toHaveBeenCalledWith(
        'Skipped: pull_request_review_comment event is not created'
      )
    })
  })

  describe('Bot comment filtering', () => {
    it('should skip comments from the bot itself (with COMMENT_TAG)', async () => {
      githubContext.payload = {
        action: 'created',
        comment: {
          id: 1,
          body: `Test comment ${COMMENT_TAG}`,
          user: { login: 'nullarai[bot]' },
          path: 'src/index.ts',
          diff_hunk: '@@ -1,5 +1,6 @@'
        },
        pull_request: {
          number: 1,
          title: 'Test PR',
          body: 'Test PR description',
          base: { sha: 'base-sha' },
          head: { sha: 'head-sha' }
        },
        repository: { full_name: 'test-owner/test-repo' }
      } as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.info).toHaveBeenCalledWith(
        'Skipped: pull_request_review_comment event is from the bot itself'
      )
    })

    it('should skip comments from the bot itself (with COMMENT_REPLY_TAG)', async () => {
      githubContext.payload = {
        action: 'created',
        comment: {
          id: 1,
          body: `Test comment ${COMMENT_REPLY_TAG}`,
          user: { login: 'nullarai[bot]' },
          path: 'src/index.ts',
          diff_hunk: '@@ -1,5 +1,6 @@'
        },
        pull_request: {
          number: 1,
          title: 'Test PR',
          body: 'Test PR description',
          base: { sha: 'base-sha' },
          head: { sha: 'head-sha' }
        },
        repository: { full_name: 'test-owner/test-repo' }
      } as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.info).toHaveBeenCalledWith(
        'Skipped: pull_request_review_comment event is from the bot itself'
      )
    })

    it('should process comments containing @nullarai', async () => {
      githubContext.payload = {
        action: 'created',
        comment: {
          id: 1,
          body: '@nullarai please review this',
          user: { login: 'regular-user' },
          path: 'src/index.ts',
          diff_hunk: '@@ -1,5 +1,6 @@\n const foo = 1;'
        },
        pull_request: {
          number: 1,
          title: 'Test PR',
          body: 'Test PR description',
          base: { sha: 'base-sha' },
          head: { sha: 'head-sha' }
        },
        repository: { full_name: 'test-owner/test-repo' }
      } as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockBot.chat).toHaveBeenCalled()
    })
  })

  describe('Edge cases', () => {
    it('should handle comment without user login', async () => {
      githubContext.payload = {
        action: 'created',
        comment: {
          id: 1,
          body: 'Test comment',
          user: {},
          path: 'src/index.ts',
          diff_hunk: '@@ -1,5 +1,6 @@'
        },
        pull_request: {
          number: 1,
          title: 'Test PR',
          body: 'Test PR description',
          base: { sha: 'base-sha' },
          head: { sha: 'head-sha' }
        },
        repository: { full_name: 'test-owner/test-repo' }
      } as any

      await handleReviewComment(mockBot, mockOptions, mockPrompts)

      expect(mockCore.warning).not.toHaveBeenCalled()
    })
  })
})
