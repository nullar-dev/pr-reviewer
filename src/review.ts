import {error, info, warning} from '@actions/core'
import {context as githubContext} from '@actions/github'
import pLimit from 'p-limit'
import {type Bot} from './bot'
import {
  Commenter,
  COMMENT_REPLY_TAG,
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
}

interface ParsedReviewerFinding extends Review {
  reviewer: string
  filename: string
}

interface LeaderAcceptedFinding {
  severity: 'critical' | 'major' | 'minor' | 'nit'
  file: string
  lines: string
  title: string
  details: string
}

interface LeaderDiscardedFinding {
  reason: string
  original: string
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
    inputs.description = commenter.getDescription(context.payload.pull_request.body)
  }

  if (inputs.description.includes(ignoreKeyword)) {
    info('Skipped: description contains ignore keyword')
    return
  }

  inputs.systemMessage = options.systemMessage

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
            fileContent = Buffer.from(contents.data.content, 'base64').toString()
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

  const limitedFiles =
    options.maxFiles > 0 ? filesAndChanges.slice(0, options.maxFiles) : filesAndChanges

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
        if (getTokenCount(summarizePrompt) > options.leaderTokenLimits.requestTokens) {
          return [filename, 'Skipped summary: diff exceeds token budget'] as const
        }
        const [summary] = await leaderBot.chat(summarizePrompt, {})
        return [filename, summary.trim()] as const
      })
    )
  )

  inputs.rawSummary = summaryResults
    .map(([filename, summary]) => `---\n${filename}: ${summary}`)
    .join('\n')

  const [walkthrough] = await leaderBot.chat(prompts.renderSummarize(inputs), {})
  const [shortSummary] = await leaderBot.chat(prompts.renderSummarizeShort(inputs), {})
  inputs.shortSummary = shortSummary

  if (!options.disableReleaseNotes) {
    const [releaseNotesResponse] = await leaderBot.chat(
      prompts.renderSummarizeReleaseNotes(inputs),
      {}
    )
    if (releaseNotesResponse !== '') {
      const message = `### Summary by NullarAI\n\n${releaseNotesResponse}`
      try {
        await commenter.updateDescription(context.payload.pull_request.number, message)
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

        const prompt = prompts.renderReviewFileDiff(ins)
        const botResponses = await Promise.all(
          reviewBots.map(async ({name, bot}) => {
            const [response] = await bot.chat(prompt, {})
            return {name, response}
          })
        )

        for (const {name, response} of botResponses) {
          const parsed = parseReview(response, patches, options.debug)
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
              reviewer: name,
              filename
            })
          }
        }
      })
    )
  )

  const findingsText = allReviewerFindings.length
    ? allReviewerFindings
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

  const validationInputs = inputs.clone()
  validationInputs.allFindings = findingsText
  validationInputs.patches = patchContextChunks.join('\n\n')
  const validationPrompt = prompts.renderLeaderValidation(validationInputs)
  const [leaderValidationResponse] = await leaderBot.chat(validationPrompt, {})

  const acceptedFindings = parseLeaderAcceptedFindings(leaderValidationResponse)
  const discardedFindings = parseLeaderDiscardedFindings(leaderValidationResponse)

  const severityOrder: Array<LeaderAcceptedFinding['severity']> = [
    'critical',
    'major',
    'minor',
    'nit'
  ]
  const groupedFindings = severityOrder
    .map(severity => {
      const findings = acceptedFindings.filter(finding => finding.severity === severity)
      if (findings.length === 0) {
        return ''
      }
      const renderedFindings = findings
        .map(
          finding =>
            `- [${finding.file}:${finding.lines}] **${finding.title}** - ${finding.details}`
        )
        .join('\n')
      return `#### ${capitalize(severity)}\n${renderedFindings}`
    })
    .filter(section => section !== '')
    .join('\n\n')

  const changesTable = summaryResults
    .map(([filename, summary]) => `| ${filename} | ${summary.replace(/\n/g, ' ')} |`)
    .join('\n')

  const discardedSection = discardedFindings.length
    ? `<details>
<summary>Discarded by leader (${discardedFindings.length})</summary>

${discardedFindings
  .map(
    discarded =>
      `- Reason: ${discarded.reason}\n  - Original: ${discarded.original.replace(/\n/g, ' ')}`
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

const splitPatch = (patch: string | null | undefined): string[] => {
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

const patchStartEndLine = (
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

const parsePatch = (
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

function parseReview(
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

function sanitizeCodeBlock(comment: string, codeBlockLabel: string): string {
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

function parseLeaderAcceptedFindings(
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
    const severity =
      (block.match(/\[SEVERITY\]:\s*(critical|major|minor|nit)/i)?.[1] ?? '')
        .toLowerCase() as LeaderAcceptedFinding['severity'] | ''
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
      accepted.push({severity, file, lines, title, details})
    }
  }

  return accepted
}

function parseLeaderDiscardedFindings(
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

function capitalize(value: string): string {
  if (value.length === 0) {
    return value
  }
  return value[0].toUpperCase() + value.slice(1)
}
