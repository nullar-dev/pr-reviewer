export class TokenLimits {
  maxTokens: number
  requestTokens: number
  responseTokens: number
  knowledgeCutOff: string

  constructor(model = 'MiniMax-M2.5') {
    this.knowledgeCutOff = '2024-01-01'
    if (model === 'MiniMax-M2.5') {
      this.maxTokens = 200000
      this.responseTokens = 16000  // Increased to allow more findings
    } else if (model === 'GLM-4.7' || model === 'glm-4.7') {
      this.maxTokens = 200000
      this.responseTokens = 16000
    } else {
      // Default to MiniMax-M2.5 limits for unknown models
      this.maxTokens = 200000
      this.responseTokens = 16000
    }
    // provide some margin for the request tokens
    this.requestTokens = this.maxTokens - this.responseTokens - 100
  }

  string(): string {
    return `max_tokens=${this.maxTokens}, request_tokens=${this.requestTokens}, response_tokens=${this.responseTokens}`
  }
}
