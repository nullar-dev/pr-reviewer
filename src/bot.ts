import './fetch-polyfill'

import {info, setFailed, warning} from '@actions/core'
import OpenAI from 'openai'
import pRetry from 'p-retry'
import {Options, ProviderOptions} from './options'

export interface Ids {
  messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
}

export class Bot {
  private readonly client: OpenAI | null = null
  private readonly options: Options
  private readonly providerOptions: ProviderOptions

  constructor(options: Options, providerOptions: ProviderOptions) {
    this.options = options
    this.providerOptions = providerOptions

    const apiKey = process.env[providerOptions.apiKeyEnv]
    if (apiKey == null || apiKey.trim() === '') {
      throw new Error(
        `Unable to initialize API client: environment variable '${providerOptions.apiKeyEnv}' is not set`
      )
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: providerOptions.apiBaseUrl
    })
  }

  chat = async (message: string, ids: Ids): Promise<[string, Ids]> => {
    try {
      return await this.chat_(message, ids)
    } catch (e) {
      warning(`Failed to chat: ${e}`)
      return ['', ids]
    }
  }

  private readonly chat_ = async (
    message: string,
    ids: Ids
  ): Promise<[string, Ids]> => {
    const start = Date.now()
    if (!message) {
      return ['', ids]
    }

    if (this.client == null) {
      setFailed('The API client is not initialized')
      return ['', ids]
    }

    const currentDate = new Date().toISOString().split('T')[0]
    const systemMessage = `${this.options.systemMessage}
Knowledge cutoff: ${this.providerOptions.tokenLimits.knowledgeCutOff}
Current date: ${currentDate}

IMPORTANT: Entire response must be in the language with ISO code: ${this.options.language}`

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemMessage
      },
      ...(ids.messages ?? []),
      {
        role: 'user',
        content: message
      }
    ]

    const response = await pRetry(
      async () =>
        await this.client!.chat.completions.create(
          {
            model: this.providerOptions.model,
            messages,
            temperature: this.options.modelTemperature,
            max_tokens: this.providerOptions.tokenLimits.responseTokens
          },
          {
            timeout: this.options.apiTimeoutMS
          }
        ),
      {
        retries: this.options.apiRetries
      }
    )

    const end = Date.now()
    info(`provider chat response time: ${end - start} ms`)

    const responseContent = response.choices[0]?.message?.content
    const responseText = typeof responseContent === 'string' ? responseContent : ''
    if (responseText === '') {
      warning('provider response is empty')
    }

    if (this.options.debug) {
      info(`provider response text: ${responseText}`)
    }

    const newIds: Ids = {
      messages: [
        ...(ids.messages ?? []),
        {
          role: 'user',
          content: message
        },
        {
          role: 'assistant',
          content: responseText
        }
      ]
    }

    return [responseText, newIds]
  }
}
