export class TokenLimits {
  maxTokens: number
  requestTokens: number
  responseTokens: number
  knowledgeCutOff: string

  constructor(model = 'MiniMax-M2.5') {
    this.knowledgeCutOff = '2024-01-01'
    // All models get 80K output for detailed security analysis
    this.maxTokens = 200000
    this.responseTokens = 80000  // Increased for more detailed findings
    // provide some margin for the request tokens
    this.requestTokens = this.maxTokens - this.responseTokens - 100
  }

  string(): string {
    return `max_tokens=${this.maxTokens}, request_tokens=${this.requestTokens}, response_tokens=${this.responseTokens}`
  }
}
