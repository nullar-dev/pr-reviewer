import {
  getBooleanInput,
  getInput,
  getMultilineInput,
  setFailed,
  warning
} from '@actions/core'
import {Bot} from './bot'
import {Options, ProviderOptions} from './options'
import {Prompts} from './prompts'
import {codeReview} from './review'
import {handleReviewComment} from './review-comment'

export async function run(): Promise<void> {
  const options: Options = new Options(
    getBooleanInput('debug'),
    getBooleanInput('disable_review'),
    getBooleanInput('disable_release_notes'),
    getInput('max_files'),
    getBooleanInput('review_simple_changes'),
    getBooleanInput('review_comment_lgtm'),
    getMultilineInput('path_filters'),
    getInput('system_message'),
    getInput('leader_model'),
    getInput('leader_api_base_url'),
    getInput('leader_api_key_env'),
    getInput('helper_models'),
    getInput('context_depth'),
    getInput('model_temperature'),
    getInput('api_retries'),
    getInput('api_timeout_ms'),
    getInput('llm_concurrency_limit'),
    getInput('github_concurrency_limit'),
    getInput('api_base_url'),
    getInput('language'),
    getInput('openai_light_model'),
    getInput('openai_heavy_model'),
    getInput('openai_model_temperature'),
    getInput('openai_retries'),
    getInput('openai_timeout_ms'),
    getInput('openai_concurrency_limit'),
    getInput('openai_base_url')
  )

  options.print()

  const prompts: Prompts = new Prompts(
    getInput('summarize'),
    getInput('summarize_release_notes')
  )

  let leaderBot: Bot
  try {
    leaderBot = new Bot(
      options,
      new ProviderOptions(
        options.leaderModel,
        options.leaderTokenLimits,
        options.leaderApiBaseUrl,
        options.leaderApiKeyEnv
      )
    )
  } catch (e) {
    warning(
      `Skipped: failed to create leader bot, please check your credentials: ${e}`
    )
    return
  }

  const helperBots: Bot[] = []
  for (const helper of options.helperConfigs) {
    try {
      helperBots.push(
        new Bot(
          options,
          new ProviderOptions(
            helper.model,
            null,
            helper.apiBaseUrl,
            helper.apiKeyEnv
          )
        )
      )
    } catch (e) {
      warning(
        `Skipped helper model '${helper.model}' due to initialization failure: ${e}`
      )
    }
  }

  try {
    if (
      process.env.GITHUB_EVENT_NAME === 'pull_request' ||
      process.env.GITHUB_EVENT_NAME === 'pull_request_target'
    ) {
      await codeReview(leaderBot, helperBots, options, prompts)
    } else if (
      process.env.GITHUB_EVENT_NAME === 'pull_request_review_comment'
    ) {
      await handleReviewComment(leaderBot, options, prompts)
    } else {
      warning('Skipped: this action only works on pull_request events')
    }
  } catch (e) {
    if (e instanceof Error) {
      setFailed(`Failed to run: ${e.message}, backtrace: ${e.stack}`)
    } else {
      setFailed(`Failed to run: ${e}`)
    }
  }
}

process
  .on('unhandledRejection', (reason, p) => {
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: unknown) => {
    warning(`Uncaught Exception thrown: ${e}`)
  })

await run()
