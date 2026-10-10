export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Standing = { rank: number; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'mummentum-leaderboard': {
      pending: TokenUsage
      standing: Standing | null
    }
  }
}
