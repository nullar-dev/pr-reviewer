# NullarAI - AI PR Reviewer

Your code has bugs. Let the robots find them.

---

## What does it do?

When you open a PR, NullarAI:
- 🔍 Reviews your code for bugs, security issues, and logic errors
- 📝 Writes a summary so your team actually knows what changed
- 🚨 Flags the scary stuff (SQL injection, auth bypass, memory leaks)
- 💬 Answers questions when you're confused

**TL;DR: It's like having a senior security engineer review every PR, but they never sleep and don't charge hourly.**

---

## Setup (Faster than reading this sentence)

### Step 1: Get an API Key

Go to [MiniMax](https://platform.minimax.io/) and sign up. It's cheap. Your wallet will survive.

Alternative providers if you're feeling fancy:
- [GLM](https://z.ai/) - Also cheap, also works
- [OpenAI](https://platform.openai.com/) - Expensive but reliable
- [Ollama](https://ollama.com/) - Free if you run it locally (but slower)

### Step 2: Add Secret to GitHub

1. Repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `OPENAI_API_KEY` (or whatever you want, just remember it)
4. Value: Paste your API key
5. Click "Add secret"

**Pro tip: Don't commit your API key to git. That's the kind of bug NullarAI would catch.**

### Step 3: Add Workflow File

Create `.github/workflows/pr-reviewer.yml`:

```yaml
name: AI PR Reviewer
on: pull_request

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: nullar-dev/pr-reviewer@main
        with:
          leader_model: MiniMax-M2.5
          leader_api_base_url: https://api.minimax.io/v1
          leader_api_key_env: OPENAI_API_KEY
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Step 4: Make a PR

That's it. Create a PR and watch the robot do your job.

---

## Want Two Brains Instead of One? (Recommended)

Two AI models catch more bugs. It's like double coverage.

```yaml
- uses: nullar-dev/pr-reviewer@main
  with:
    leader_model: MiniMax-M2.5
    leader_api_base_url: https://api.minimax.io/v1
    leader_api_key_env: OPENAI_API_KEY
    helper_models: '[{"model":"GLM-4.7","apiBaseUrl":"https://api.z.ai/api/paas/v4","apiKeyEnv":"GLM_API_KEY"}]'
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GLM_API_KEY: ${{ secrets.GLM_API_KEY }}
```

Add `GLM_API_KEY` to your secrets like you did for the first one. Now you have:
- MiniMax doing the heavy lifting
- GLM as backup catching what MiniMax missed

**Results: ~20% more bugs found. Worth the extra $5/month.**

---

## Configuration (For the Tweakers)

### Basic Settings

```yaml
with:
  # How many files to review (0 = all)
  max_files: 150

  # Review "trivial" changes? (honestly, just leave this false)
  review_simple_changes: false

  # Let it post "LGTM" comments? (no one likes that guy)
  review_comment_lgtm: false
```

### Skip Stuff

```yaml
with:
  # Only want summaries? No problem
  disable_review: false

  # Don't need release notes? Cool
  disable_release_notes: false
```

### Filter Files

```yaml
with:
  # Only review these
  path_filters: |
    src/**
    lib/**

  # Skip these
  path_filters: |
    !docs/**
    !*.test.ts
```

---

## How to Use

### The Normal Way

1. Create a PR
2. Wait 30 seconds - 2 minutes
3. Read the comment
4. Fix your bugs
5. Feel bad about yourself briefly
6. Move on with your life

### The Lazy Way

Comment on your PR:
- `@nullarai explain this security issue` - Get an explanation
- `@nullarai write tests for this function` - Let it do your work
- `@nullarai what does this do` - Stop pretending you'll figure it out

### The "Actually I'm Busy" Way

Add `@nullarai: ignore` in your PR description if you don't want review. We won't be offended.

---

## Severity Levels (What Scares Us)

| Level | Meaning | Example |
|-------|---------|----------|
| 🔴 CRITICAL | Drop everything and fix | SQL injection, auth bypass |
| 🟠 MAJOR | Fix before merge | Null pointer, logic error |
| 🟡 MINOR | Maybe fix later | Code smell, unused variable |
| 🔵 NIT | Who cares | Variable naming |

---

## Troubleshooting

### "API key not set"

You forgot Step 2. Go back. It's right there.

### "Rate limit exceeded"

The AI provider is busy. Wait 60 seconds and try again. Or downgrade your expectations.

### "No files reviewed"

Check your `path_filters`. You might be filtering out everything. It's not us, it's you.

### "It's taking forever"

Large PRs take time. 100+ files = ~5 minutes. Go get coffee. We'll be here when you get back.

---

## Is This Safe?

- Your code goes to the AI provider. Yes, they read it. No, they probably don't care about your todo app.
- Your API key is stored in GitHub secrets. It's encrypted. Hacker would need to break into GitHub first.
- We're not affiliated with anyone. We just make the thing.

---

## Developing This Thing

```bash
npm install
npm run build
npm run package
```

Then publish or whatever. Not my problem.

---

## The End

That's it. Your PRs are now reviewed by robots that don't have opinions about your code style and won't passive-aggressively suggest "consider using a more functional approach."

You're welcome.
