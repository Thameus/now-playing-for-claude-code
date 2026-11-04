export type Now = {
  isOpen: boolean
  isPlaying: boolean
  track: string
  album: string
  posMs: number
  endMs: number
  atMs: number
  /** The player the buttons address: Windows session id, playerctl player name, or the macOS app (Spotify or Music). */
  source: string
}

declare module 'claude-code' {
  interface PluginState {
    'now-playing-band': { now: Shaped<Now>; tick: number; isHidden: boolean; showBar: boolean }
  }
}
