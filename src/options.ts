import {info, warning} from '@actions/core'
import {minimatch} from 'minimatch'
import {TokenLimits} from './limits'

export interface HelperConfig {
  model: string
  apiBaseUrl: string
  apiKeyEnv: string
}

export class Options {
  debug: boolean
  disableReview: boolean
  disableReleaseNotes: boolean
  maxFiles: number
  reviewSimpleChanges: boolean
  reviewCommentLGTM: boolean
  pathFilters: PathFilter
  systemMessage: string
  leaderModel: string
  leaderApiBaseUrl: string
  leaderApiKeyEnv: string
  helperConfigs: HelperConfig[]
  modelTemperature: number
  apiRetries: number
  apiTimeoutMS: number
  llmConcurrencyLimit: number
  githubConcurrencyLimit: number
  leaderTokenLimits: TokenLimits
  apiBaseUrl: string
  language: string

  openaiLightModel: string
  openaiHeavyModel: string
  openaiModelTemperature: number
  openaiRetries: number
  openaiTimeoutMS: number
  openaiConcurrencyLimit: number
  lightTokenLimits: TokenLimits
  heavyTokenLimits: TokenLimits

  constructor(
    debug: boolean,
    disableReview: boolean,
    disableReleaseNotes: boolean,
    maxFiles = '0',
    reviewSimpleChanges = false,
    reviewCommentLGTM = false,
    pathFilters: string[] | null = null,
    systemMessage = '',
    leaderModel = 'MiniMax-M2.5',
    leaderApiBaseUrl = '',
    leaderApiKeyEnv = 'AI_API_KEY',
    helperModels = '',
    modelTemperature = '0.0',
    apiRetries = '3',
    apiTimeoutMS = '120000',
    llmConcurrencyLimit = '6',
    githubConcurrencyLimit = '6',
    apiBaseUrl = '',
    language = 'en-US',
    openaiLightModel = '',
    openaiHeavyModel = '',
    openaiModelTemperature = '',
    openaiRetries = '',
    openaiTimeoutMS = '',
    openaiConcurrencyLimit = '',
    openaiBaseUrl = ''
  ) {
    const resolvedLeaderModel = leaderModel || openaiLightModel || 'MiniMax-M2.5'
    const resolvedApiBaseUrl =
      leaderApiBaseUrl ||
      apiBaseUrl ||
      openaiBaseUrl ||
      'https://api.minimax.io/v1'
    const resolvedModelTemperature =
      modelTemperature || openaiModelTemperature || '0.0'
    const resolvedApiRetries = apiRetries || openaiRetries || '3'
    const resolvedApiTimeoutMS = apiTimeoutMS || openaiTimeoutMS || '120000'
    const resolvedLlmConcurrencyLimit =
      llmConcurrencyLimit || openaiConcurrencyLimit || '6'

    this.debug = debug
    this.disableReview = disableReview
    this.disableReleaseNotes = disableReleaseNotes
    this.maxFiles = parseInt(maxFiles)
    this.reviewSimpleChanges = reviewSimpleChanges
    this.reviewCommentLGTM = reviewCommentLGTM
    this.pathFilters = new PathFilter(pathFilters)
    this.systemMessage = systemMessage
    this.leaderModel = resolvedLeaderModel
    this.leaderApiBaseUrl = resolvedApiBaseUrl
    this.leaderApiKeyEnv = leaderApiKeyEnv || 'AI_API_KEY'
    this.helperConfigs = this.parseHelperConfigs(helperModels, resolvedApiBaseUrl)
    this.modelTemperature = parseFloat(resolvedModelTemperature)
    this.apiRetries = parseInt(resolvedApiRetries)
    this.apiTimeoutMS = parseInt(resolvedApiTimeoutMS)
    this.llmConcurrencyLimit = parseInt(resolvedLlmConcurrencyLimit)
    this.githubConcurrencyLimit = parseInt(githubConcurrencyLimit)
    this.leaderTokenLimits = new TokenLimits(this.leaderModel)
    this.apiBaseUrl = resolvedApiBaseUrl
    this.language = language

    this.openaiLightModel = this.leaderModel
    this.openaiHeavyModel = this.leaderModel
    this.openaiModelTemperature = this.modelTemperature
    this.openaiRetries = this.apiRetries
    this.openaiTimeoutMS = this.apiTimeoutMS
    this.openaiConcurrencyLimit = this.llmConcurrencyLimit
    this.lightTokenLimits = this.leaderTokenLimits
    this.heavyTokenLimits = this.leaderTokenLimits
  }

  print(): void {
    info(`debug: ${this.debug}`)
    info(`disable_review: ${this.disableReview}`)
    info(`disable_release_notes: ${this.disableReleaseNotes}`)
    info(`max_files: ${this.maxFiles}`)
    info(`review_simple_changes: ${this.reviewSimpleChanges}`)
    info(`review_comment_lgtm: ${this.reviewCommentLGTM}`)
    info(`path_filters: ${this.pathFilters}`)
    info(`system_message: ${this.systemMessage}`)
    info(`leader_model: ${this.leaderModel}`)
    info(`leader_api_base_url: ${this.leaderApiBaseUrl}`)
    info(`leader_api_key_env: ${this.leaderApiKeyEnv}`)
    info(`helper_models: ${JSON.stringify(this.helperConfigs)}`)
    info(`model_temperature: ${this.modelTemperature}`)
    info(`api_retries: ${this.apiRetries}`)
    info(`api_timeout_ms: ${this.apiTimeoutMS}`)
    info(`llm_concurrency_limit: ${this.llmConcurrencyLimit}`)
    info(`github_concurrency_limit: ${this.githubConcurrencyLimit}`)
    info(`leader_token_limits: ${this.leaderTokenLimits.string()}`)
    info(`api_base_url: ${this.apiBaseUrl}`)
    info(`language: ${this.language}`)
  }

  checkPath(path: string): boolean {
    const ok = this.pathFilters.check(path)
    info(`checking path: ${path} => ${ok}`)
    return ok
  }

  private parseHelperConfigs(
    helperModels: string,
    defaultBaseUrl: string
  ): HelperConfig[] {
    if (!helperModels.trim()) {
      return []
    }

    try {
      const parsed = JSON.parse(helperModels) as unknown
      if (!Array.isArray(parsed)) {
        warning('helper_models must be a JSON array; ignoring helper models')
        return []
      }

      return parsed
        .map((item, index): HelperConfig | null => {
          if (typeof item !== 'object' || item == null) {
            warning(`helper_models[${index}] is not an object; skipping`)
            return null
          }

          const model = (item as {model?: unknown}).model
          const apiBaseUrl = (item as {apiBaseUrl?: unknown}).apiBaseUrl
          const apiKeyEnv = (item as {apiKeyEnv?: unknown}).apiKeyEnv

          if (typeof model !== 'string' || model.trim() === '') {
            warning(`helper_models[${index}].model is required; skipping`)
            return null
          }

          return {
            model: model.trim(),
            apiBaseUrl:
              typeof apiBaseUrl === 'string' && apiBaseUrl.trim() !== ''
                ? apiBaseUrl.trim()
                : defaultBaseUrl,
            apiKeyEnv:
              typeof apiKeyEnv === 'string' && apiKeyEnv.trim() !== ''
                ? apiKeyEnv.trim()
                : 'AI_API_KEY'
          }
        })
        .filter((item): item is HelperConfig => item != null)
    } catch (e) {
      warning(`Failed to parse helper_models JSON: ${e}`)
      return []
    }
  }
}

export class PathFilter {
  private readonly rules: Array<[string, boolean]>

  constructor(rules: string[] | null = null) {
    this.rules = []
    if (rules != null) {
      for (const rule of rules) {
        const trimmed = rule?.trim()
        if (trimmed) {
          if (trimmed.startsWith('!')) {
            this.rules.push([trimmed.substring(1).trim(), true])
          } else {
            this.rules.push([trimmed, false])
          }
        }
      }
    }
  }

  check(path: string): boolean {
    if (this.rules.length === 0) {
      return true
    }

    let included = false
    let excluded = false
    let inclusionRuleExists = false

    for (const [rule, exclude] of this.rules) {
      if (minimatch(path, rule)) {
        if (exclude) {
          excluded = true
        } else {
          included = true
        }
      }
      if (!exclude) {
        inclusionRuleExists = true
      }
    }

    return (!inclusionRuleExists || included) && !excluded
  }
}

export class ProviderOptions {
  model: string
  tokenLimits: TokenLimits
  apiBaseUrl: string
  apiKeyEnv: string

  constructor(
    model = 'MiniMax-M2.5',
    tokenLimits: TokenLimits | null = null,
    apiBaseUrl = 'https://api.minimax.io/v1',
    apiKeyEnv = 'AI_API_KEY'
  ) {
    this.model = model
    this.tokenLimits = tokenLimits ?? new TokenLimits(model)
    this.apiBaseUrl = apiBaseUrl
    this.apiKeyEnv = apiKeyEnv
  }
}
