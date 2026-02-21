# AI-based PR Reviewer and Summarizer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

NullarAI `ai-pr-reviewer` is an AI-based code reviewer and summarizer for GitHub pull requests. It supports any OpenAI-compatible LLM provider (MiniMax, GLM, OpenAI, Azure OpenAI, Ollama, etc.) and is designed to be used as a GitHub Action.

## Features

- **Multi-Provider Support**: Works with MiniMax-M2.5, GLM-4.7, GPT-4, and any OpenAI-compatible API
- **Leader + Helpers Architecture**: One required leader AI for validation, optional helper AIs for parallel review
- **PR Summarization**: Generates summary and release notes for pull requests
- **Line-by-line code suggestions**: Reviews changes line by line with specific fix recommendations
- **Incremental Reviews**: Tracks commits and only reviews new changes since last review
- **Single Consolidated Comment**: One detailed comment with all findings, ranked by severity
- **Smart Triage**: Automatically skips trivial changes (typos, formatting)
- **Chat with Bot**: Reply to review comments for follow-up context

## Install Instructions

### Quick Start with MiniMax-M2.5

Add `.github/workflows/ai-pr-reviewer.yml`:

```yaml
name: Code Review

permissions:
  contents: read
  pull-requests: write

on:
  pull_request:
  pull_request_review_comment:
    types: [created]

concurrency:
  group: ${{ github.repository }}-${{ github.event.number || github.head_ref || github.sha }}-${{ github.workflow }}-${{ github.event_name == 'pull_request_review_comment' && 'pr_comment' || 'pr' }}
  cancel-in-progress: ${{ github.event_name != 'pull_request_review_comment' }}

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: nullar-dev/pr-reviewer@latest
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
        with:
          debug: false
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | Auto-provided by GitHub Actions |
| `AI_API_KEY` | Yes | Your provider API key (MiniMax, GLM, OpenAI, etc.) |

### Supported Providers

#### MiniMax-M2.5 (Default)

The action defaults to MiniMax-M2.5 with the following configuration:

```yaml
with:
  leader_model: MiniMax-M2.5
  leader_api_base_url: https://api.minimax.io/v1
  leader_api_key_env: AI_API_KEY
```

Get your MiniMax API key from: https://platform.minimax.io/

#### GLM-4.7

```yaml
with:
  leader_model: GLM-4.7
  leader_api_base_url: https://api.z.ai/api/paas/v4
  leader_api_key_env: AI_API_KEY
```

Get your GLM API key from: https://open.bigmodel.cn/

#### OpenAI

```yaml
with:
  leader_model: gpt-4o
  leader_api_base_url: https://api.openai.com/v1
  leader_api_key_env: OPENAI_API_KEY
```

#### Azure OpenAI

```yaml
with:
  leader_model: gpt-4
  leader_api_base_url: https://your-resource.openai.azure.com/openai/deployments/your-deployment
  leader_api_key_env: AZURE_OPENAI_API_KEY
```

#### Ollama (Local)

```yaml
with:
  leader_model: llama3
  leader_api_base_url: http://localhost:11434/v1
  leader_api_key_env: OLLAMA_API_KEY
```

### Using Helper Models

Add optional helper AIs for parallel review:

```yaml
with:
  leader_model: MiniMax-M2.5
  helper_models: '[{"model":"GLM-4.7","apiBaseUrl":"https://api.z.ai/api/paas/v4","apiKeyEnv":"GLM_API_KEY"}]'
```

Each helper reviews files in parallel; the leader then validates all findings.

### Configuration Options

| Input | Default | Description |
|-------|---------|-------------|
| `leader_model` | `MiniMax-M2.5` | Model for leader (validation + final decision) |
| `leader_api_base_url` | `https://api.minimax.io/v1` | Leader API endpoint |
| `leader_api_key_env` | `AI_API_KEY` | Env var name for leader API key |
| `helper_models` | `[]` | JSON array of helper model configs |
| `model_temperature` | `0.05` | Sampling temperature |
| `api_retries` | `5` | Number of API retry attempts |
| `api_timeout_ms` | `360000` | API call timeout (ms) |
| `llm_concurrency_limit` | `6` | Max concurrent LLM calls |

### Advanced Options

| Input | Default | Description |
|-------|---------|-------------|
| `debug` | `false` | Enable debug logging |
| `max_files` | `150` | Max files to review (0 = unlimited) |
| `review_simple_changes` | `false` | Review trivial changes too |
| `review_comment_lgtm` | `false` | Post LGTM comments |
| `disable_review` | `false` | Only generate summary |
| `disable_release_notes` | `false` | Skip release notes |
| `system_message` | (see action.yml) | Custom system prompt |
| `path_filters` | (see action.yml) | Files to include/exclude |

### Custom System Message

```yaml
with:
  system_message: |
    You are @nullarai, an expert code reviewer.
    Focus on: security, performance, correctness, maintainability.
    Skip: formatting, typos, comments.
```

## Reply to Review Comments

NullarAI responds to comments on PR diffs. Tag it or reply to its comments:

- **Ask questions**: "@nullarai explain this security concern"
- **Request code**: "@nullarai write tests for this function"
- **Get explanations**: "@nullarai what does this method do?"
- **Follow instructions**: Any request in the comment will be answered

### Ignoring PRs

Add `@nullarai: ignore` anywhere in the PR description to skip reviews.

## Severity Rankings

Findings are ranked by severity:

- **Critical**: Security vulnerabilities, data loss risks, crashes
- **Major**: Bugs, logic errors, significant performance issues
- **Minor**: Code smells, minor optimizations, style issues
- **Nit**: Formatting, naming suggestions, trivial improvements

## Developing

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Package for distribution
npm run package
```

## Disclaimer

- Your code (files, diff, PR title/description) will be sent to the configured LLM provider for processing
- Review your provider's data usage policy before using on private repositories
- This action is not affiliated with MiniMax, GLM, OpenAI, or any other LLM provider
