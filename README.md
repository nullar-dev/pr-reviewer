# NullarAI - AI PR Reviewer

Automated code review for GitHub pull requests using AI.

## What does it do?

When you open a pull request, NullarAI will:
- 📝 **Summarize** your changes in plain English
- 🔍 **Review** your code line-by-line
- ⚠️ **Flag issues** like bugs, security problems, performance issues
- 📋 **Generate release notes** for your PR
- 💬 **Answer questions** about your code

## Quick Setup (5 minutes)

### Step 1: Get an API Key

Choose your AI provider:

| Provider | Cost | Quality | Sign Up |
|----------|------|---------|---------|
| **MiniMax** (recommended) | Cheap | Great | https://platform.minimax.io/ |
| **GLM** | Cheap | Great | https://open.bigmodel.cn/ |
| **OpenAI** | Medium | Excellent | https://platform.openai.com/ |
| **Ollama** | Free (local) | Good | https://ollama.com/ |

### Step 2: Add API Key to GitHub

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `AI_API_KEY`
4. Value: Paste your API key from Step 1
5. Click "Add secret"

### Step 3: Add Workflow File

Create `.github/workflows/ai-pr-reviewer.yml`:

```yaml
name: Code Review

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: nullar-dev/pr-reviewer@latest
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
```

### Step 4: Test It

1. Create a pull request with some code changes
2. Wait 10-30 seconds
3. See the review comment on your PR! 🎉

---

## Common Setups

### Using MiniMax (Recommended)

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: nullar-dev/pr-reviewer@latest
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
        with:
          leader_model: MiniMax-M2.5
```

### Using OpenAI GPT-4

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: nullar-dev/pr-reviewer@latest
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        with:
          leader_model: gpt-4o
          leader_api_base_url: https://api.openai.com/v1
          leader_api_key_env: OPENAI_API_KEY
```

### Using Ollama (Local, Free)

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: nullar-dev/pr-reviewer@latest
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}
        with:
          leader_model: llama3
          leader_api_base_url: http://localhost:11434/v1
          leader_api_key_env: OLLAMA_API_KEY
```

### Multiple AIs (Leader + Helpers)

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: nullar-dev/pr-reviewer@latest
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
          GLM_API_KEY: ${{ secrets.GLM_API_KEY }}
        with:
          leader_model: MiniMax-M2.5
          helper_models: '[{"model":"GLM-4.7","apiBaseUrl":"https://api.z.ai/api/paas/v4","apiKeyEnv":"GLM_API_KEY"}]'
```

---

## Configuration Options

### Basic Options

```yaml
with:
  # How many files to review (0 = all)
  max_files: 150
  
  # Review trivial changes (typos, formatting)?
  review_simple_changes: false
  
  # Post "LGTM" comments?
  review_comment_lgtm: false
```

### Disable Features

```yaml
with:
  # Skip code review, only generate summary
  disable_review: false
  
  # Skip release notes
  disable_release_notes: false
```

### Filter Files

```yaml
with:
  # Only review these files
  path_filters: |
    src/**
    lib/**
  
  # Skip these files
  path_filters: |
    !docs/**
    !*.md
```

---

## How to Use

### After Setup

Just create a pull request! NullarAI will automatically:
1. Analyze your code changes
2. Post a review comment with findings
3. Rank issues by severity (Critical → Major → Minor → Nit)

### Ask Questions

Comment on the PR review:
- `@nullarai explain this security issue`
- `@nullarai write tests for this function`
- `@nullarai what does this method do?`

### Skip Review

Add `@nullarai: ignore` anywhere in your PR description to skip the review.

---

## Severity Levels

| Level | Meaning | Example |
|-------|---------|----------|
| 🔴 Critical | Security vulnerability, crash risk | SQL injection |
| 🟠 Major | Bug, logic error | Null pointer |
| 🟡 Minor | Code smell, optimization | Unused variable |
| 🔵 Nit | Style, naming | Variable name |

---

## Troubleshooting

### "API key not found"

Make sure you added the secret to GitHub:
1. Repo → Settings → Secrets and variables → Actions
2. Secret name must match what you use in `leader_api_key_env`

### "Rate limit exceeded"

- Wait a few minutes
- Or reduce `llm_concurrency_limit` in settings

### "No files reviewed"

Check your `path_filters` - you might be excluding all files.

---

## Developing

```bash
# Install
npm install

# Build
npm run build

# Package for GitHub Action
npm run package
```

---

## Disclaimer

- Your code is sent to the AI provider for analysis
- Review your provider's data privacy policy
- Not affiliated with MiniMax, GLM, or OpenAI
