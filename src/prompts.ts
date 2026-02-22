import {type Inputs} from './inputs'

export class Prompts {
  summarize: string
  summarizeReleaseNotes: string
  leaderValidation = `## GitHub PR Title

\`$title\`

## Description

\`\`\`
$description
\`\`\`

## Summary of changes

\`\`\`
$short_summary
\`\`\`

## Unified findings from all reviewers

\`\`\`
$all_findings
\`\`\`

## Patch context

$patches

## Task

You are the leader reviewer. Validate every candidate finding against the patch context.
Reject findings that are incorrect, duplicates, too vague, or not actionable.

IMPORTANT: Do NOT reject findings about these advanced patterns — they are real and critical even when they seem theoretical or unlikely:
- Timing attacks on secret/token comparison (=== vs constant-time compare)
- Prototype pollution via object spread/merge/assign of user-controlled input
- TOCTOU race conditions between async check and subsequent data use
- Floating-point precision errors in financial/monetary calculations
- Off-by-one errors in boundary/limit checks (< vs <=)
- Missing authorization/ownership checks on data access endpoints (IDOR)
- Unicode normalization bypasses and homoglyph attacks
- ReDoS from nested regex quantifiers on user input
- JWT algorithm confusion (alg: 'none') or missing signature verification
- Dead validation that runs after the side effect it should guard
- Unbounded in-memory collection growth (memory leaks)
- Type coercion bugs (== vs ===)
- Insecure randomness (Math.random for security-sensitive values)

When in doubt, ACCEPT the finding. False negatives (missing real issues) are far worse than false positives for a security reviewer.

Severity must be one of: critical, major, minor, nit.

Return EXACTLY this format:

### Accepted Findings
<one finding per block>
[SEVERITY]: <critical|major|minor|nit>
[FILE]: <path>
[LINES]: <start>-<end>
[TITLE]: <short title>
[DETAILS]: <specific rationale and recommended fix>
---

### Discarded Findings
<one finding per block>
[REASON]: <why discarded>
[ORIGINAL]: <original finding text>
---

If no accepted findings exist, still include both sections and use the text "None" in each section.
`

  summarizeFileDiff = `## GitHub PR Title

\`$title\` 

## Description

\`\`\`
$description
\`\`\`

## Diff

\`\`\`diff
$file_diff
\`\`\`

## Instructions

I would like you to succinctly summarize the diff within 100 words.
If applicable, your summary should include a note about alterations 
to the signatures of exported functions, global data structures and 
variables, and any changes that might affect the external interface or 
behavior of the code.
`
  triageFileDiff = `Below the summary, I would also like you to triage the diff as \`NEEDS_REVIEW\` or 
\`APPROVED\` based on the following criteria:

- If the diff involves any modifications to the logic or functionality, even if they 
  seem minor, triage it as \`NEEDS_REVIEW\`. This includes changes to control structures, 
  function calls, or variable assignments that might impact the behavior of the code.
- If the diff only contains very minor changes that don't affect the code logic, such as 
  fixing typos, formatting, or renaming variables for clarity, triage it as \`APPROVED\`.

Please evaluate the diff thoroughly and take into account factors such as the number of 
lines changed, the potential impact on the overall system, and the likelihood of 
introducing new bugs or security vulnerabilities. 
When in doubt, always err on the side of caution and triage the diff as \`NEEDS_REVIEW\`.

You must strictly follow the format below for triaging the diff:
[TRIAGE]: <NEEDS_REVIEW or APPROVED>

Important:
- In your summary do not mention that the file needs a through review or caution about
  potential issues.
- Do not provide any reasoning why you triaged the diff as \`NEEDS_REVIEW\` or \`APPROVED\`.
- Do not mention that these changes affect the logic or functionality of the code in 
  the summary. You must only use the triage status format above to indicate that.
`
  summarizeChangesets = `Provided below are changesets in this pull request. Changesets 
are in chronlogical order and new changesets are appended to the
end of the list. The format consists of filename(s) and the summary 
of changes for those files. There is a separator between each changeset.
Your task is to deduplicate and group together files with
related/similar changes into a single changeset. Respond with the updated 
changesets using the same format as the input. 

$raw_summary
`

  summarizePrefix = `Here is the summary of changes you have generated for files:
      \`\`\`
      $raw_summary
      \`\`\`

`

  summarizeShort = `Your task is to provide a concise summary of the changes. This 
summary will be used as a prompt while reviewing each file and must be very clear for 
the AI bot to understand. 

Instructions:

- Focus on summarizing only the changes in the PR and stick to the facts.
- Do not provide any instructions to the bot on how to perform the review.
- Do not mention that files need a through review or caution about potential issues.
- Do not mention that these changes affect the logic or functionality of the code.
- The summary should not exceed 500 words.
`

  reviewFileDiff = `## GitHub PR Title

\`$title\` 

## Description

\`\`\`
$description
\`\`\`

## Summary of changes

\`\`\`
$short_summary
\`\`\`

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: PR title, description, summaries and comment chains.
Task: Review new hunks for substantive issues using provided context. You must act as a senior security engineer, logic auditor, and performance specialist combined. Be strict — flag every real issue regardless of how subtle.

Systematically check for ALL of the following:

**Security — Injection & Code Execution (Critical)**:
- SQL injection, command injection, XSS (reflected/stored/DOM), code injection (eval/Function/new Function/setTimeout with strings)
- Template injection, XPath injection, log injection, NoSQL injection, LDAP injection, XXE
- Deserialization of untrusted data (JSON.parse of user input piped into sensitive operations)
- Prototype pollution: unsafe merge/spread/Object.assign of user-controlled objects — check if any user input flows into \`{...defaults, ...userInput}\` or similar patterns

**Security — Authentication & Access Control (Critical)** [OWASP A01, A07]:
- Auth bypass, missing authentication on sensitive endpoints or operations
- IDOR (Insecure Direct Object Reference): can a user access, modify, or delete another user's data by changing an ID, key, or parameter? Flag ANY data access method that takes an ID without verifying the requester owns it
- Broken access control: privilege escalation, inverted role checks, admin functions accessible to regular users
- JWT vulnerabilities: algorithm confusion (accepting 'none' or 'HS256' when 'RS256' expected), missing signature verification, trusting decoded payload without cryptographic validation, token not expiring
- Session fixation, insecure session management, missing logout invalidation

**Security — Cryptographic & Timing (Critical)** [OWASP A04]:
- Hardcoded secrets, API keys, credentials, tokens, connection strings in source code or config files
- Insecure randomness: Math.random() used for tokens, IDs, secrets, nonces, or anything security-sensitive — must use crypto.randomUUID/crypto.getRandomValues
- Timing attacks: comparing secrets, tokens, hashes, or API keys using == or === instead of crypto.timingSafeEqual — string comparison short-circuits and leaks information through response time
- Weak/broken cryptographic algorithms (MD5, SHA1 for passwords; DES, RC4 for encryption)
- Missing salt in password hashing, insufficient key derivation rounds

**Security — Sensitive Data Handling (Critical)** [PCI-DSS, GDPR]:
- Plaintext storage of passwords, credit card numbers, CVV, SSN, PII, tokens, session IDs
- Information disclosure: stack traces, internal file paths, database errors, SQL queries, or partial secrets leaked to clients, API responses, or log output
- Clear-text logging of credentials, tokens, card numbers, or PII
- Sensitive data in URL parameters, GET requests, or browser-accessible storage
- Missing data encryption at rest or in transit

**Security — Advanced Attack Patterns (Critical/Major)**:
- TOCTOU (Time-of-Check-Time-of-Use): security check (auth, ownership, permission, balance) separated from the operation it guards by ANY async boundary (await, callback, setTimeout) — an attacker can change state between the check and the use. Flag if check and use are separate async calls.
- ReDoS: regex with nested quantifiers (\`(a+)+\`, \`(a|a)*\`, \`(\\d+[- ]?){n,m}\`), catastrophic backtracking on user-controlled input. Any regex applied to user input with nested repetition is dangerous.
- Unicode/encoding: normalization bypasses (comparing strings normalized differently — NFC vs NFD vs NFKC), homoglyph attacks (visually similar characters bypassing filters), missing canonicalization before security-relevant comparison
- SSRF: user-controlled URLs, hostnames, or IP addresses used in server-side HTTP requests, DNS lookups, or file operations
- Open redirect: user-controlled redirect target without allowlist validation
- Mass assignment: user input directly spread into database update/create operations

**Data Integrity & Correctness (Critical/Major)**:
- Floating-point arithmetic for monetary/financial values — 0.1 + 0.2 !== 0.3 in IEEE 754. Any money calculation using float/double is a bug. Must use integer cents, BigInt, or Decimal library
- Integer overflow in multiplication or accumulation with large user-controlled values
- Type coercion: == instead of === (loose equality), implicit conversions that silently change behavior (\`"0" == false\`, \`null == undefined\`, \`[] == false\`)
- Off-by-one errors: < vs <=, > vs >=, fence-post errors in loops, array bounds, pagination, rate limit checks
- Dead code / unreachable validation: a check that runs AFTER the side effect it should guard (e.g., validating amount after already processing payment)
- Incorrect operator: && vs ||, ! applied to wrong variable, negation logic errors
- Silent failures: catch blocks that swallow errors without logging or re-throwing

**Performance & Resource Management (Major)**:
- Memory leaks: Maps, Sets, arrays, caches, or object pools that grow without bound — no eviction policy, no TTL, no max size limit. Flag ANY in-memory collection that is appended to but never pruned.
- Missing cleanup/disposal: unclosed connections, uncleared intervals/timeouts, detached event listeners, unreleased file handles
- Resource exhaustion from deep object traversal, recursive structures, or user-controlled iteration depth
- O(n) or O(n²) operations that should use indexed lookups (Map/Set instead of Array.find/filter)
- N+1 query patterns, redundant computations in loops

**Concurrency & Race Conditions (Major)**:
- Non-atomic read-modify-write: reading shared state, computing, then writing back without a lock/mutex — concurrent operations can interleave and corrupt state
- Missing synchronization for concurrent access to Maps, counters, balances, or any shared mutable state
- TOCTOU in async code: await between checking a condition and acting on it

**Input Validation & Error Handling (Major)**:
- Missing validation on user-controlled values: amounts (negative? zero? NaN? Infinity?), sizes, counts, array indices, string lengths
- Missing bounds checking on array/map access
- Unchecked null/undefined on values that may not exist
- Error handlers that expose internals or silently continue with corrupted state
- Missing Content-Type validation, missing request size limits

**Code Quality & Logic (Major)**:
- Mutable internal state exposed to callers without defensive copy
- Inconsistent state updates (partial update on error, no rollback)
- Unreachable code paths, dead branches, tautological conditions
- Shadowed variables that may cause confusion
- Functions with side effects that callers may not expect

**CI/CD & Infrastructure (Major for workflow/config files)**:
- Floating refs: @main or @master instead of pinned SHA or version tag
- Missing or overly permissive permissions block
- Insecure action versions, dependencies downloaded over HTTP
- Secrets exposed in workflow logs or environment variables passed insecurely

**Think about what's MISSING, not just what's wrong:**
- Is there a data access endpoint without ownership/authorization verification? (IDOR)
- Is there a Map/cache/Set that grows but has no eviction, cleanup, TTL, or size limit? (memory leak)
- Is there a security check separated from the data operation by an async boundary? (TOCTOU)
- Are secrets or tokens compared using == or === instead of constant-time comparison? (timing attack)
- Are financial/monetary calculations using floating-point instead of integer cents? (precision error)
- Is user input merged/spread into objects without sanitizing __proto__ or constructor keys? (prototype pollution)
- Is a regex with nested quantifiers applied to user-controlled input? (ReDoS)
- Is validation done AFTER the operation it should guard? (dead validation)
- Can a user call an admin/privileged function without proper role verification? (broken access control)
- Is an ID generated with Math.random() used for anything security-sensitive? (predictable IDs)

For each issue found, provide a specific fix using diff code blocks.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use \`suggestion\` code blocks.
For fixes, use \`diff\` code blocks, marking changes with \`+\` or \`-\`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

- Do NOT provide general feedback, summaries, explanations of changes, or praises 
  for making good additions. 
- Focus solely on offering specific, objective insights based on the 
  given context and refrain from making broad comments about potential impacts on 
  the system or question intentions behind the changes.

If there are no issues found on a line range, you MUST respond with the 
text \`LGTM!\` for that line range in the review section. 

## Example

### Example changes

---new_hunk---
\`\`\`
  z = x / y
    return z

20: def add(x, y):
21:     z = x + y
22:     retrn z
23: 
24: def multiply(x, y):
25:     return x * y

def subtract(x, y):
  z = x - y
\`\`\`
  
---old_hunk---
\`\`\`
  z = x / y
    return z

def add(x, y):
    return x + y

def subtract(x, y):
    z = x - y
\`\`\`

---comment_chains---
\`\`\`
Please review this change.
\`\`\`

---end_change_section---

### Example response

22-22:
There's a syntax error in the add function.
\`\`\`diff
-    retrn z
+    return z
\`\`\`
---
24-25:
LGTM!
---

## Changes made to \`$filename\` for your review

$patches

$caller_context
`

  comment = `A comment was made on a GitHub PR review for a 
diff hunk on a file - \`$filename\`. I would like you to follow 
the instructions in that comment. 

## GitHub PR Title

\`$title\`

## Description

\`\`\`
$description
\`\`\`

## Summary generated by the AI bot

\`\`\`
$short_summary
\`\`\`

## Entire diff

\`\`\`diff
$file_diff
\`\`\`

## Diff being commented on

\`\`\`diff
$diff
\`\`\`

## Instructions

Please reply directly to the new comment (instead of suggesting 
a reply) and your reply will be posted as-is.

If the comment contains instructions/requests for you, please comply. 
For example, if the comment is asking you to generate documentation 
comments on the code, in your reply please generate the required code.

In your reply, please make sure to begin the reply by tagging the user 
with "@user".

## Comment format

\`user: comment\`

## Comment chain (including the new comment)

\`\`\`
$comment_chain
\`\`\`

## The comment/request that you need to directly reply to

\`\`\`
$comment
\`\`\`
`

  constructor(summarize = '', summarizeReleaseNotes = '') {
    this.summarize = summarize
    this.summarizeReleaseNotes = summarizeReleaseNotes
  }

  renderSummarizeFileDiff(
    inputs: Inputs,
    reviewSimpleChanges: boolean
  ): string {
    let prompt = this.summarizeFileDiff
    if (reviewSimpleChanges === false) {
      prompt += this.triageFileDiff
    }
    return inputs.render(prompt)
  }

  renderSummarizeChangesets(inputs: Inputs): string {
    return inputs.render(this.summarizeChangesets)
  }

  renderSummarize(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarize
    return inputs.render(prompt)
  }

  renderSummarizeShort(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarizeShort
    return inputs.render(prompt)
  }

  renderSummarizeReleaseNotes(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarizeReleaseNotes
    return inputs.render(prompt)
  }

  renderComment(inputs: Inputs): string {
    return inputs.render(this.comment)
  }

  renderReviewFileDiff(inputs: Inputs): string {
    return inputs.render(this.reviewFileDiff)
  }

  renderLeaderValidation(inputs: Inputs): string {
    return inputs.render(this.leaderValidation)
  }
}
