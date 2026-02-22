import {error, info, warning} from '@actions/core'
import {context as githubContext} from '@actions/github'
import pLimit from 'p-limit'
import {type Bot} from './bot'
import {
  Commenter,
  COMMENT_REPLY_TAG,
  IN_PROGRESS_START_TAG,
  RAW_SUMMARY_END_TAG,
  RAW_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SUMMARIZE_TAG
} from './commenter'
import {Inputs} from './inputs'
import {octokit} from './octokit'
import {type Options} from './options'
import {type Prompts} from './prompts'
import {getTokenCount} from './tokenizer'

const context = githubContext
const repo = context.repo
const ignoreKeyword = '@nullarai: ignore'

interface Review {
  startLine: number
  endLine: number
  comment: string
  severity?: string
  confidence?: number
}

interface ParsedReviewerFinding extends Review {
  reviewer: string
  filename: string
}

interface LeaderAcceptedFinding {
  severity: 'critical' | 'major' | 'minor' | 'nit'
  confidence: number
  file: string
  lines: string
  title: string
  details: string
}

interface LeaderDiscardedFinding {
  reason: string
  original: string
}

/**
 * Deduplicates findings from multiple bots.
 * Uses file + line range as primary key, with fuzzy text matching for similarity.
 * Keeps the most detailed/comprehensive finding for each unique issue.
 */
function deduplicateFindings(
  findings: ParsedReviewerFinding[]
): ParsedReviewerFinding[] {
  if (findings.length <= 1) return findings

  // Use a Map for O(1) lookups
  const seen = new Map<string, ParsedReviewerFinding>()

  // Sort by priority: critical > major > minor > nit
  // This ensures we keep higher severity when deduplicating
  const severityPriority: Record<string, number> = {
    critical: 4,
    major: 3,
    minor: 2,
    nit: 1
  }

  for (const finding of findings) {
    // Generate key from filename + line range (allows 1 line tolerance)
    const lineKey = `${finding.filename}:${finding.startLine}-${finding.endLine}`
    const lineRange = finding.endLine - finding.startLine
    const lineKeyVariants = [
      lineKey,
      `${finding.filename}:${finding.startLine - 1}-${finding.endLine}`,
      `${finding.filename}:${finding.startLine}-${finding.endLine + 1}`,
      `${finding.filename}:${Math.max(1, finding.startLine - 1)}-${finding.endLine + 1}`
    ]

    let bestMatch: ParsedReviewerFinding | null = null
    let bestMatchKey: string | null = null
    let bestScore = -1

    for (const key of lineKeyVariants) {
      const existing = seen.get(key)
      if (existing) {
        // Calculate similarity score
        const score = calculateSimilarityScore(finding, existing, severityPriority)
        if (score > bestScore) {
          bestScore = score
          bestMatch = existing
          bestMatchKey = key
        }
      }
    }

    // If similar finding exists, keep the better one
    if (bestMatch && bestScore > 0.7) {
      // Compare and keep the more comprehensive one
      if (isMoreComprehensive(finding, bestMatch, severityPriority)) {
        seen.set(bestMatchKey!, finding)
      }
    } else {
      // New unique finding - store with primary key
      seen.set(lineKey, finding)
    }
  }

  return Array.from(seen.values())
}

/**
 * Calculates similarity score between two findings (0-1).
 * Higher = more similar.
 */
function calculateSimilarityScore(
  a: ParsedReviewerFinding,
  b: ParsedReviewerFinding,
  severityPriority: Record<string, number>
): number {
  // Same file + overlapping lines = high similarity
  if (a.filename !== b.filename) return 0

  const aStart = a.startLine
  const aEnd = a.endLine
  const bStart = b.startLine
  const bEnd = b.endLine

  // Check line overlap
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
  const union = Math.max(aEnd, bEnd) - Math.min(aStart, bStart)
  const lineSimilarity = union > 0 ? overlap / union : 0

  if (lineSimilarity < 0.3) return 0 // No significant overlap

  // Normalize comments for comparison
  const normA = normalizeComment(a.comment)
  const normB = normalizeComment(b.comment)

  // Check keyword similarity (fast approximation)
  const keywordsA = extractKeywords(normA)
  const keywordsB = extractKeywords(normB)
  const keywordSimilarity = calculateKeywordSimilarity(keywordsA, keywordsB)

  // Combined score (line overlap weighted at 40%, keywords at 60%)
  return lineSimilarity * 0.4 + keywordSimilarity * 0.6
}

/**
 * Normalizes comment for comparison (removes noise).
 */
function normalizeComment(comment: string): string {
  return comment
    .toLowerCase()
    .replace(/`[^`]+`/g, '') // Remove code blocks
    .replace(/[^\w\s]/g, ' ') // Keep only alphanumeric + spaces
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extracts key security keywords from comment.
 */
function extractKeywords(comment: string): Set<string> {
  const securityKeywords = [
    'sql', 'injection', 'xss', 'csrf', 'authentication', 'authorization',
    'idor', 'authorization', 'access', 'control', 'vulnerability',
    'hardcoded', 'secret', 'key', 'password', 'token', 'jwt',
    'eval', 'injection', 'prototype', 'pollution', 'overflow',
    'timing', 'attack', 'race', 'condition', 'tou', 'toctou',
    'memory', 'leak', 'dos', 'redos', 'regex', 'precision',
    'float', 'decimal', 'money', 'currency', 'validation',
    'sanitize', 'escape', 'bypass', 'exposure', 'disclosure',
    'random', 'predictable', 'crypt', 'signature', 'verify',
    'cors', 'header', 'secure', 'cookie', 'session'
  ]

  const words = comment.toLowerCase().split(/\s+/)
  const keywords = new Set<string>()

  for (const word of words) {
    if (securityKeywords.some(k => word.includes(k))) {
      keywords.add(word)
    }
  }

  return keywords
}

/**
 * Calculates Jaccard similarity between keyword sets.
 */
function calculateKeywordSimilarity(
  a: Set<string>,
  b: Set<string>
): number {
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }

  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * Determines if finding A is more comprehensive than finding B.
 */
function isMoreComprehensive(
  a: ParsedReviewerFinding,
  b: ParsedReviewerFinding,
  severityPriority: Record<string, number>
): boolean {
  // Higher severity wins
  const aSeverity = severityPriority[a.severity?.toLowerCase() || 'major'] || 3
  const bSeverity = severityPriority[b.severity?.toLowerCase() || 'major'] || 3

  if (aSeverity !== bSeverity) return aSeverity > bSeverity

  // Longer comment = more details
  if (Math.abs(a.comment.length - b.comment.length) > 50) {
    return a.comment.length > b.comment.length
  }

  // More code examples = better
  const aCodeBlocks = (a.comment.match(/```/g) || []).length
  const bCodeBlocks = (b.comment.match(/```/g) || []).length

  return aCodeBlocks > bCodeBlocks
}

export const codeReview = async (
  leaderBot: Bot,
  helperBots: Bot[],
  options: Options,
  prompts: Prompts
): Promise<void> => {
  const commenter = new Commenter()
  const llmConcurrencyLimit = pLimit(options.llmConcurrencyLimit)
  const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit)

  if (
    context.eventName !== 'pull_request' &&
    context.eventName !== 'pull_request_target'
  ) {
    warning(
      `Skipped: current event is ${context.eventName}, only support pull_request event`
    )
    return
  }
  if (context.payload.pull_request == null) {
    warning('Skipped: context.payload.pull_request is null')
    return
  }

  const inputs = new Inputs()
  inputs.title = context.payload.pull_request.title
  if (context.payload.pull_request.body != null) {
    inputs.description = commenter.getDescription(
      context.payload.pull_request.body
    )
  }

  if (inputs.description.includes(ignoreKeyword)) {
    info('Skipped: description contains ignore keyword')
    return
  }

  // Post in-progress status message
  await commenter.comment(
    commenter.addInProgressStatus('', '🔍 Analyzing pull request changes...'),
    SUMMARIZE_TAG,
    'replace'
  )

  inputs.systemMessage = options.systemMessage
  inputs.customInstructions = options.customInstructions

  const existingSummarizeCmt = await commenter.findCommentWithTag(
    SUMMARIZE_TAG,
    context.payload.pull_request.number
  )
  let existingCommitIdsBlock = ''
  if (existingSummarizeCmt != null) {
    inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmt.body)
    inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmt.body)
    existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(
      existingSummarizeCmt.body
    )
  }

  const allCommitIds = await commenter.getAllCommitIds()
  let highestReviewedCommitId = ''
  if (existingCommitIdsBlock !== '') {
    highestReviewedCommitId = commenter.getHighestReviewedCommitId(
      allCommitIds,
      commenter.getReviewedCommitIds(existingCommitIdsBlock)
    )
  }

  if (
    highestReviewedCommitId === '' ||
    highestReviewedCommitId === context.payload.pull_request.head.sha
  ) {
    highestReviewedCommitId = context.payload.pull_request.base.sha
  }

  const incrementalDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: highestReviewedCommitId,
    head: context.payload.pull_request.head.sha
  })

  const targetBranchDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: context.payload.pull_request.base.sha,
    head: context.payload.pull_request.head.sha
  })

  const incrementalFiles = incrementalDiff.data.files
  const targetBranchFiles = targetBranchDiff.data.files

  if (incrementalFiles == null || targetBranchFiles == null) {
    warning('Skipped: files data is missing')
    return
  }

  const files = targetBranchFiles.filter(targetBranchFile =>
    incrementalFiles.some(
      incrementalFile => incrementalFile.filename === targetBranchFile.filename
    )
  )

  if (files.length === 0) {
    warning('Skipped: no changed files in incremental range')
    return
  }

  const filterSelectedFiles = []
  for (const file of files) {
    if (options.checkPath(file.filename)) {
      filterSelectedFiles.push(file)
    }
  }

  if (filterSelectedFiles.length === 0) {
    warning('Skipped: all files filtered out')
    return
  }

  const commits = incrementalDiff.data.commits
  if (commits.length === 0) {
    warning('Skipped: commits is empty')
    return
  }

  const filteredFiles = await Promise.all(
    filterSelectedFiles.map(file =>
      githubConcurrencyLimit(async () => {
        let fileContent = ''
        if (context.payload.pull_request == null) {
          return null
        }
        try {
          const contents = await octokit.repos.getContent({
            owner: repo.owner,
            repo: repo.repo,
            path: file.filename,
            ref: context.payload.pull_request.base.sha
          })
          if (
            contents.data != null &&
            !Array.isArray(contents.data) &&
            contents.data.type === 'file' &&
            contents.data.content != null
          ) {
            fileContent = Buffer.from(
              contents.data.content,
              'base64'
            ).toString()
          }
        } catch {
          fileContent = ''
        }

        let fileDiff = ''
        if (file.patch != null) {
          fileDiff = file.patch
        }

        const patches: Array<[number, number, string]> = []
        for (const patch of splitPatch(file.patch)) {
          const patchLines = patchStartEndLine(patch)
          if (patchLines == null) {
            continue
          }
          const hunks = parsePatch(patch)
          if (hunks == null) {
            continue
          }
          const hunksStr = `
---new_hunk---
\`\`\`
${hunks.newHunk}
\`\`\`

---old_hunk---
\`\`\`
${hunks.oldHunk}
\`\`\`
`
          patches.push([
            patchLines.newHunk.startLine,
            patchLines.newHunk.endLine,
            hunksStr
          ])
        }
        if (patches.length > 0) {
          return [file.filename, fileContent, fileDiff, patches] as [
            string,
            string,
            string,
            Array<[number, number, string]>
          ]
        }
        return null
      })
    )
  )

  const filesAndChanges = filteredFiles.filter(file => file !== null) as Array<
    [string, string, string, Array<[number, number, string]>]
  >

  if (filesAndChanges.length === 0) {
    error('Skipped: no files to review')
    return
  }

  // Gather caller context based on context depth setting
  const callerContext = await gatherCallerContext(
    filesAndChanges,
    options.contextDepth,
    context.payload.pull_request.base.sha
  )
  inputs.callerContext = callerContext

  const limitedFiles =
    options.maxFiles > 0
      ? filesAndChanges.slice(0, options.maxFiles)
      : filesAndChanges

  const summaryResults = await Promise.all(
    limitedFiles.map(([filename, , fileDiff]) =>
      llmConcurrencyLimit(async () => {
        const ins = inputs.clone()
        ins.filename = filename
        ins.fileDiff = fileDiff
        const summarizePrompt = prompts.renderSummarizeFileDiff(
          ins,
          options.reviewSimpleChanges
        )
        if (
          getTokenCount(summarizePrompt) >
          options.leaderTokenLimits.requestTokens
        ) {
          return [
            filename,
            'Skipped summary: diff exceeds token budget'
          ] as const
        }
        const [summary] = await leaderBot.chat(summarizePrompt, {})
        return [filename, summary.trim()] as const
      })
    )
  )

  inputs.rawSummary = summaryResults
    .map(([filename, summary]) => `---\n${filename}: ${summary}`)
    .join('\n')

  const [walkthrough] = await leaderBot.chat(
    prompts.renderSummarize(inputs),
    {}
  )
  const [shortSummary] = await leaderBot.chat(
    prompts.renderSummarizeShort(inputs),
    {}
  )
  inputs.shortSummary = shortSummary

  if (!options.disableReleaseNotes) {
    const [releaseNotesResponse] = await leaderBot.chat(
      prompts.renderSummarizeReleaseNotes(inputs),
      {}
    )
    if (releaseNotesResponse !== '') {
      const message = `### Summary by NullarAI\n\n${releaseNotesResponse}`
      try {
        await commenter.updateDescription(
          context.payload.pull_request.number,
          message
        )
      } catch (e: unknown) {
        warning(`release notes: error from github: ${e}`)
      }
    }
  }

  const reviewBots = [
    {name: 'leader', bot: leaderBot},
    ...helperBots.map((bot, index) => ({name: `helper-${index + 1}`, bot}))
  ]

  const allReviewerFindings: ParsedReviewerFinding[] = []
  const patchContextChunks: string[] = []

  await Promise.all(
    limitedFiles.map(([filename, , , patches]) =>
      llmConcurrencyLimit(async () => {
        const ins = inputs.clone()
        ins.filename = filename

        let promptTokens = getTokenCount(prompts.renderReviewFileDiff(ins))
        for (const [startLine, endLine, patch] of patches) {
          const patchTokens = getTokenCount(patch)
          if (
            promptTokens + patchTokens >
            options.leaderTokenLimits.requestTokens
          ) {
            break
          }

          let commentChain = ''
          try {
            if (context.payload.pull_request != null) {
              commentChain = await commenter.getCommentChainsWithinRange(
                context.payload.pull_request.number,
                filename,
                startLine,
                endLine,
                COMMENT_REPLY_TAG
              )
            }
          } catch {
            commentChain = ''
          }

          ins.patches += `\n${patch}\n`
          if (commentChain !== '') {
            ins.patches += `
---comment_chains---
\`\`\`
${commentChain}
\`\`\`
`
          }
          ins.patches += '\n---end_change_section---\n'
          promptTokens += patchTokens
        }

        patchContextChunks.push(`### ${filename}\n${ins.patches}`)

        // Multi-pass review: Security, Logic, Performance - all in parallel
        const reviewPrompts = [
          {pass: 'security', prompt: prompts.renderSecurityReview(ins)},
          {pass: 'logic', prompt: prompts.renderLogicReview(ins)},
          {pass: 'performance', prompt: prompts.renderPerformanceReview(ins)}
        ]

        // Run all 3 passes × all bots in parallel
        const allPassResults = await Promise.all(
          reviewBots.flatMap(({name: botName, bot}) =>
            reviewPrompts.map(async ({pass, prompt}) => {
              const [response] = await bot.chat(prompt, {})
              return {botName, pass, response, patches}
            })
          )
        )

        // Process all findings
        for (const {botName, pass, response, patches: findPatches} of allPassResults) {
          const parsed = parseReview(response, findPatches, options.debug)
          for (const finding of parsed) {
            if (
              !options.reviewCommentLGTM &&
              (finding.comment.includes('LGTM') ||
                finding.comment.toLowerCase().includes('looks good to me'))
            ) {
              continue
            }
            allReviewerFindings.push({
              ...finding,
              reviewer: `${botName}:${pass}`,
              filename
            })
          }
        }
      })
    )
  )

  // Deduplicate findings from multiple bots
  // This is O(n) with Map lookups - efficient for typical finding counts
  const uniqueFindings = deduplicateFindings(allReviewerFindings)

  if (uniqueFindings.length < allReviewerFindings.length) {
    info(
      `Deduplicated ${allReviewerFindings.length} findings to ${uniqueFindings.length} unique issues`
    )
  }

  const findingsText = uniqueFindings.length
    ? uniqueFindings
        .map(
          finding => `
[REVIEWER]: ${finding.reviewer}
[FILE]: ${finding.filename}
[LINES]: ${finding.startLine}-${finding.endLine}
[COMMENT]: ${finding.comment.trim()}
---`
        )
        .join('\n')
    : 'None'

  // Skip leader validation - use unique findings directly
  // TODO: Add option to enable leader validation in the future
  const acceptedFindings = uniqueFindings.map(f => {
    // Try to extract severity from comment if present
    let severity: 'critical' | 'major' | 'minor' | 'nit' = 'major'
    const lowerComment = f.comment.toLowerCase()
    if (lowerComment.includes('critical') || lowerComment.includes('security') || lowerComment.includes('vulnerability')) {
      severity = 'critical'
    } else if (lowerComment.includes('minor') || lowerComment.includes('code smell')) {
      severity = 'minor'
    } else if (lowerComment.includes('nit') || lowerComment.includes('style')) {
      severity = 'nit'
    }

    // Extract confidence score from comment (format: "CONFIDENCE: XX%")
    let confidence = 80 // Default confidence
    const confidenceMatch = f.comment.match(/CONFIDENCE:\s*(\d+)%/i)
    if (confidenceMatch) {
      confidence = parseInt(confidenceMatch[1], 10)
    }

    return {
      severity,
      confidence,
      file: f.filename,
      lines: `${f.startLine}-${f.endLine}`,
      title: 'Issue found by reviewer',
      details: f.comment.trim().substring(0, 500)
    }
  })

  const discardedFindings: Array<{reason: string, original: string}> = []

  const severityOrder: Array<LeaderAcceptedFinding['severity']> = [
    'critical',
    'major',
    'minor',
    'nit'
  ]
  const severityEmoji: Record<string, string> = {
    critical: '🔴 Critical',
    major: '🟠 Major',
    minor: '🟡 Minor',
    nit: '🔵 Nit'
  }

  // Generate AI prompts for all findings
  const generateAiPrompt = (findings: LeaderAcceptedFinding[]): string => {
    if (findings.length === 0) return ''
    return `Verify each finding against the current code and fix the issues.\n\n` +
      findings.map(f => 
        `In \`@${f.file}\` around lines ${f.lines}: ${f.title}. ${f.details}`
      ).join('\n\n')
  }

  const groupedFindings = severityOrder
    .map(severity => {
      const findings = acceptedFindings.filter(
        finding => finding.severity === severity
      )
      if (findings.length === 0) {
        return ''
      }
      const renderedFindings = findings
        .map(
          finding =>
            `**${finding.file}** (${finding.lines}): ${finding.title}\nConfidence: ${finding.confidence || 80}%\n\n${finding.details}\n`
        )
        .join('\n---\n')
      return `<details>
<summary>${severityEmoji[severity]} (${findings.length})</summary>\n\n${renderedFindings}\n</details>`
    })
    .filter(section => section !== '')
    .join('\n\n')

  // Generate AI prompts for all accepted findings
  const allFindingsPrompt = generateAiPrompt(acceptedFindings)

  const changesTable = summaryResults
    .map(
      ([filename, summary]) =>
        `| ${filename} | ${summary.replace(/\n/g, ' ')} |`
    )
    .join('\n')

  const discardedSection = discardedFindings.length
    ? `<details>
<summary>Discarded by leader (${discardedFindings.length})</summary>

${discardedFindings
  .map(
    discarded =>
      `- Reason: ${
        discarded.reason
      }\n  - Original: ${discarded.original.replace(/\n/g, ' ')}`
  )
  .join('\n')}

</details>`
    : `<details>
<summary>Discarded by leader (0)</summary>

None

</details>`

  let summarizeComment = `## Walkthrough
${walkthrough}

## Changes
| File | Summary |
| --- | --- |
${changesTable}

## Findings
${groupedFindings || 'No actionable findings.'}

${discardedSection}

---

**🤖 Prompt for AI Agents**
\n\n<details>
<summary>Click to copy fix prompt</summary>

\`\`\`\n${allFindingsPrompt}\n\`\`\`

</details>

${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}
`

  summarizeComment += `\n${commenter.addReviewedCommitId(
    existingCommitIdsBlock,
    commits[commits.length - 1].sha
  )}`



  await commenter.comment(`${summarizeComment}`, SUMMARIZE_TAG, 'replace')
}

export const splitPatch = (patch: string | null | undefined): string[] => {
  if (patch == null) {
    return []
  }

  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@).*$/gm

  const result: string[] = []
  let last = -1
  let match: RegExpExecArray | null
  while ((match = pattern.exec(patch)) !== null) {
    if (last === -1) {
      last = match.index
    } else {
      result.push(patch.substring(last, match.index))
      last = match.index
    }
  }
  if (last !== -1) {
    result.push(patch.substring(last))
  }
  return result
}

export const patchStartEndLine = (
  patch: string
): {
  oldHunk: {startLine: number; endLine: number}
  newHunk: {startLine: number; endLine: number}
} | null => {
  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@)/gm
  const match = pattern.exec(patch)
  if (match != null) {
    const oldBegin = parseInt(match[2])
    const oldDiff = parseInt(match[3])
    const newBegin = parseInt(match[4])
    const newDiff = parseInt(match[5])
    return {
      oldHunk: {
        startLine: oldBegin,
        endLine: oldBegin + oldDiff - 1
      },
      newHunk: {
        startLine: newBegin,
        endLine: newBegin + newDiff - 1
      }
    }
  }
  return null
}

export const parsePatch = (
  patch: string
): {oldHunk: string; newHunk: string} | null => {
  const hunkInfo = patchStartEndLine(patch)
  if (hunkInfo == null) {
    return null
  }

  const oldHunkLines: string[] = []
  const newHunkLines: string[] = []

  let newLine = hunkInfo.newHunk.startLine
  const lines = patch.split('\n').slice(1)
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  const skipStart = 3
  const skipEnd = 3
  let currentLine = 0
  const removalOnly = !lines.some(line => line.startsWith('+'))

  for (const line of lines) {
    currentLine++
    if (line.startsWith('-')) {
      oldHunkLines.push(`${line.substring(1)}`)
    } else if (line.startsWith('+')) {
      newHunkLines.push(`${newLine}: ${line.substring(1)}`)
      newLine++
    } else {
      oldHunkLines.push(`${line}`)
      if (
        removalOnly ||
        (currentLine > skipStart && currentLine <= lines.length - skipEnd)
      ) {
        newHunkLines.push(`${newLine}: ${line}`)
      } else {
        newHunkLines.push(`${line}`)
      }
      newLine++
    }
  }

  return {
    oldHunk: oldHunkLines.join('\n'),
    newHunk: newHunkLines.join('\n')
  }
}

export function parseReview(
  response: string,
  patches: Array<[number, number, string]>,
  debug = false
): Review[] {
  const reviews: Review[] = []

  response = sanitizeResponse(response.trim())
  const lines = response.split('\n')
  const lineNumberRangeRegex = /(?:^|\s)(\d+)-(\d+):\s*$/
  const commentSeparator = '---'

  let currentStartLine: number | null = null
  let currentEndLine: number | null = null
  let currentComment = ''

  function storeReview(): void {
    if (currentStartLine !== null && currentEndLine !== null) {
      const review: Review = {
        startLine: currentStartLine,
        endLine: currentEndLine,
        comment: currentComment
      }

      let withinPatch = false
      let bestPatchStartLine = -1
      let bestPatchEndLine = -1
      let maxIntersection = 0

      for (const [startLine, endLine] of patches) {
        const intersectionStart = Math.max(review.startLine, startLine)
        const intersectionEnd = Math.min(review.endLine, endLine)
        const intersectionLength = Math.max(
          0,
          intersectionEnd - intersectionStart + 1
        )

        if (intersectionLength > maxIntersection) {
          maxIntersection = intersectionLength
          bestPatchStartLine = startLine
          bestPatchEndLine = endLine
          withinPatch =
            intersectionLength === review.endLine - review.startLine + 1
        }

        if (withinPatch) {
          break
        }
      }

      if (!withinPatch) {
        if (bestPatchStartLine !== -1 && bestPatchEndLine !== -1) {
          review.comment = `> Note: This review was outside of the patch, so it was mapped to the patch with the greatest overlap. Original lines [${review.startLine}-${review.endLine}]\n\n${review.comment}`
          review.startLine = bestPatchStartLine
          review.endLine = bestPatchEndLine
        } else if (patches.length > 0) {
          review.comment = `> Note: This review was outside of the patch, but no overlap was found. Original lines [${review.startLine}-${review.endLine}]\n\n${review.comment}`
          review.startLine = patches[0][0]
          review.endLine = patches[0][1]
        }
      }

      reviews.push(review)
      if (debug) {
        info(
          `Stored comment for line range ${currentStartLine}-${currentEndLine}: ${currentComment.trim()}`
        )
      }
    }
  }

  for (const line of lines) {
    const lineNumberRangeMatch = line.match(lineNumberRangeRegex)

    if (lineNumberRangeMatch != null) {
      storeReview()
      currentStartLine = parseInt(lineNumberRangeMatch[1], 10)
      currentEndLine = parseInt(lineNumberRangeMatch[2], 10)
      currentComment = ''
      continue
    }

    if (line.trim() === commentSeparator) {
      storeReview()
      currentStartLine = null
      currentEndLine = null
      currentComment = ''
      continue
    }

    if (currentStartLine !== null && currentEndLine !== null) {
      currentComment += `${line}\n`
    }
  }

  storeReview()
  return reviews
}

export function sanitizeCodeBlock(
  comment: string,
  codeBlockLabel: string
): string {
  const codeBlockStart = `\`\`\`${codeBlockLabel}`
  const codeBlockEnd = '```'
  const lineNumberRegex = /^ *(\d+): /gm

  let codeBlockStartIndex = comment.indexOf(codeBlockStart)
  while (codeBlockStartIndex !== -1) {
    const codeBlockEndIndex = comment.indexOf(
      codeBlockEnd,
      codeBlockStartIndex + codeBlockStart.length
    )
    if (codeBlockEndIndex === -1) {
      break
    }

    const codeBlock = comment.substring(
      codeBlockStartIndex + codeBlockStart.length,
      codeBlockEndIndex
    )
    const sanitizedBlock = codeBlock.replace(lineNumberRegex, '')

    comment =
      comment.slice(0, codeBlockStartIndex + codeBlockStart.length) +
      sanitizedBlock +
      comment.slice(codeBlockEndIndex)

    codeBlockStartIndex = comment.indexOf(
      codeBlockStart,
      codeBlockStartIndex +
        codeBlockStart.length +
        sanitizedBlock.length +
        codeBlockEnd.length
    )
  }

  return comment
}

function sanitizeResponse(comment: string): string {
  comment = sanitizeCodeBlock(comment, 'suggestion')
  comment = sanitizeCodeBlock(comment, 'diff')
  return comment
}

export function parseLeaderAcceptedFindings(
  response: string
): LeaderAcceptedFinding[] {
  const sectionMatch = response.match(
    /### Accepted Findings([\s\S]*?)### Discarded Findings/
  )
  if (sectionMatch == null) {
    return []
  }

  const section = sectionMatch[1].trim()
  if (section === '' || section === 'None') {
    return []
  }

  const blocks = section
    .split('\n---')
    .map(block => block.trim())
    .filter(block => block !== '')

  const accepted: LeaderAcceptedFinding[] = []
  for (const block of blocks) {
    const severity = (
      block.match(/\[SEVERITY\]:\s*(critical|major|minor|nit)/i)?.[1] ?? ''
    ).toLowerCase() as LeaderAcceptedFinding['severity'] | ''
    const file = block.match(/\[FILE\]:\s*(.+)/)?.[1]?.trim() ?? ''
    const lines = block.match(/\[LINES\]:\s*(.+)/)?.[1]?.trim() ?? ''
    const title = block.match(/\[TITLE\]:\s*(.+)/)?.[1]?.trim() ?? ''
    const details = block.match(/\[DETAILS\]:\s*([\s\S]*)/)?.[1]?.trim() ?? ''

    if (
      (severity === 'critical' ||
        severity === 'major' ||
        severity === 'minor' ||
        severity === 'nit') &&
      file !== '' &&
      lines !== '' &&
      title !== '' &&
      details !== ''
    ) {
      // Extract confidence if present
      const confidenceStr = block.match(/CONFIDENCE:\s*(\d+)%/i)?.[1] ?? '80'
      const confidence = parseInt(confidenceStr, 10)

      accepted.push({severity, confidence, file, lines, title, details})
    }
  }

  return accepted
}

export function parseLeaderDiscardedFindings(
  response: string
): LeaderDiscardedFinding[] {
  const sectionMatch = response.match(/### Discarded Findings([\s\S]*)$/)
  if (sectionMatch == null) {
    return []
  }

  const section = sectionMatch[1].trim()
  if (section === '' || section === 'None') {
    return []
  }

  const blocks = section
    .split('\n---')
    .map(block => block.trim())
    .filter(block => block !== '')

  const discarded: LeaderDiscardedFinding[] = []
  for (const block of blocks) {
    const reason = block.match(/\[REASON\]:\s*(.+)/)?.[1]?.trim() ?? ''
    const original = block.match(/\[ORIGINAL\]:\s*([\s\S]*)/)?.[1]?.trim() ?? ''
    if (reason !== '' && original !== '') {
      discarded.push({reason, original})
    }
  }

  return discarded
}

export function capitalize(value: string): string {
  if (value.length === 0) {
    return value
  }
  return value[0].toUpperCase() + value.slice(1)
}

// ============================================
// Context-aware code review - caller context fetching
// ============================================

/**
 * Extract function and class definitions from file content
 * Supports JavaScript, TypeScript, Python, Java, Go, Rust
 */
export const extractDefinitions = (
  content: string,
  filename: string
): string[] => {
  const definitions: string[] = []
  const ext = filename.split('.').pop()?.toLowerCase()

  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
    // TypeScript/JavaScript: function declarations, arrow functions, classes, exports
    const patterns = [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
      /(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+(\w+)\s*=/g,
      /(?:export\s+)?class\s+(\w+)/g,
      /(?:export\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1]
        if (name && !name.startsWith('_') && name.length > 2) {
          definitions.push(name)
        }
      }
    }
  } else if (ext === 'py') {
    // Python: function and class definitions
    const patterns = [/^(?:async\s+)?def\s+(\w+)/gm, /^class\s+(\w+)/gm]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1]
        if (name && !name.startsWith('_')) {
          definitions.push(name)
        }
      }
    }
  } else if (ext === 'go') {
    // Go: function and type declarations
    const patterns = [
      /func\s+(?:\([^)]+\)\s+)?(\w+)/g,
      /type\s+(\w+)\s+(?:struct|interface)/g
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1]
        if (name && !name.startsWith('_')) {
          definitions.push(name)
        }
      }
    }
  } else if (ext === 'rs') {
    // Rust: function and struct definitions
    const patterns = [
      /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g,
      /(?:pub\s+)?struct\s+(\w+)/g,
      /(?:pub\s+)?enum\s+(\w+)/g
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1]
        if (name && !name.startsWith('_')) {
          definitions.push(name)
        }
      }
    }
  } else if (ext === 'java') {
    // Java: method and class declarations
    const patterns = [
      /(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/g,
      /class\s+(\w+)/g
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1]
        if (name && !name.startsWith('_')) {
          definitions.push(name)
        }
      }
    }
  }

  return [...new Set(definitions)]
}

/**
 * Fetch file contents from GitHub
 */
const fetchFileContent = async (
  filePath: string,
  ref: string
): Promise<string> => {
  try {
    const contents = await octokit.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path: filePath,
      ref
    })

    if (
      contents.data != null &&
      !Array.isArray(contents.data) &&
      contents.data.type === 'file' &&
      contents.data.content != null
    ) {
      return Buffer.from(contents.data.content, 'base64').toString()
    }
  } catch {
    // File not found or other error
  }
  return ''
}

/**
 * Extract relevant code sections around definitions/callers
 */
const extractRelevantSections = (
  content: string,
  definitions: string[],
  maxLines = 50
): string => {
  if (definitions.length === 0 || !content) {
    return ''
  }

  const lines = content.split('\n')
  const relevantLines = new Set<number>()

  for (const def of definitions) {
    // Find lines containing the definition or its usage
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(def)) {
        // Include surrounding context (5 lines before and after)
        for (
          let j = Math.max(0, i - 5);
          j < Math.min(lines.length, i + 10);
          j++
        ) {
          relevantLines.add(j)
        }
      }
    }
  }

  if (relevantLines.size === 0) {
    return ''
  }

  const sortedLines = [...relevantLines].sort((a, b) => a - b)
  const selectedLines = sortedLines.slice(0, maxLines)

  return selectedLines.map(i => `${i + 1}: ${lines[i]}`).join('\n')
}

/**
 * Build caller context based on context depth setting
 * - shallow: no caller context (diff only)
 * - medium: diff + callers of changed functions (if available)
 * - deep: full file content of calling files
 */
const buildCallerContext = async (
  changedFiles: Array<{filename: string; content: string}>,
  contextDepth: 'shallow' | 'medium' | 'deep',
  baseSha: string
): Promise<string> => {
  if (contextDepth === 'shallow') {
    return ''
  }

  const allDefinitions: string[] = []
  for (const file of changedFiles) {
    const defs = extractDefinitions(file.content, file.filename)
    allDefinitions.push(...defs.map(d => `${file.filename}:${d}`))
  }

  if (allDefinitions.length === 0) {
    return ''
  }

  const contextParts: string[] = []

  if (contextDepth === 'medium') {
    // Medium: Get caller references but not full content
    contextParts.push('## Caller Context (Functions that use changed code)')
    contextParts.push(
      '\nNote: The following functions/classes in this PR are called by other parts of the codebase. Consider how changes might affect these callers:\n'
    )

    // For medium, we just list the definitions that might have callers
    contextParts.push(
      `Changed definitions that may have callers: ${allDefinitions.join(', ')}`
    )
    contextParts.push(
      '\nReview tip: Consider how these changes might impact upstream callers.'
    )
  } else if (contextDepth === 'deep') {
    // Deep: Fetch actual caller file contents
    contextParts.push('## Caller Context (Full caller file sections)')
    contextParts.push(
      '\nThe following code sections show how changed functions are used in the codebase:\n'
    )

    // Group definitions by file
    const defsByFile = new Map<string, string[]>()
    for (const def of allDefinitions) {
      const [filename, funcName] = def.split(':')
      const existing = defsByFile.get(filename) || []
      existing.push(funcName)
      defsByFile.set(filename, existing)
    }

    // Fetch and extract relevant sections from each file
    for (const [filename, defs] of defsByFile) {
      const content = await fetchFileContent(filename, baseSha)
      if (content) {
        const sections = extractRelevantSections(content, defs, 30)
        if (sections) {
          contextParts.push(`\n### ${filename}`)
          contextParts.push('```')
          contextParts.push(sections)
          contextParts.push('```')
        }
      }
    }
  }

  return contextParts.join('\n')
}

/**
 * Main function to gather caller context for changed files
 */
const gatherCallerContext = async (
  filesAndChanges: Array<
    [string, string, string, Array<[number, number, string]>]
  >,
  contextDepth: 'shallow' | 'medium' | 'deep',
  baseSha: string
): Promise<string> => {
  if (contextDepth === 'shallow' || filesAndChanges.length === 0) {
    return ''
  }

  const changedFiles = filesAndChanges.map(([filename, content]) => ({
    filename,
    content
  }))

  try {
    return await buildCallerContext(changedFiles, contextDepth, baseSha)
  } catch (e) {
    warning(`Failed to gather caller context: ${e}`)
    return ''
  }
}
