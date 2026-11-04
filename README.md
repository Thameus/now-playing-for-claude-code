# now-playing-band

Shows the track playing on your computer in a band above the Claude Code prompt, with a progress bar and clickable previous / play-pause / next buttons. On Windows and Linux it follows whichever media player is playing (Spotify, a browser tab, VLC, ...); on macOS it follows Spotify and Apple Music. It reads the local player only: no account, no login and no API token.

```
♪ Artist - Song · Album
1:06 ━━━━──────── 4:22  [«] [=] [»]
```

## Install

```
/plugin install now-playing-band --marketplace Thameus/now-playing-for-claude-code
```

## Use

- Click `[«]`, `[=]` / `[>]` and `[»]` for previous, play/pause and next. They address the player shown in the band.
- `/nowp` shows or hides the band.
- `/nowp bar` shows or hides the progress bar; without it the buttons sit beside the track name. The choice is kept across sessions.
- The band shows the player that is playing; when none is, the last one shown, paused. It disappears when no player is open.

## Requirements per platform

| Platform | Players | How it reads the track | How the buttons work | Needs |
|---|---|---|---|---|
| Windows 10/11 | Any player with a Windows media session | System media sessions (SMTC) via Windows PowerShell | Commands sent to the shown player's media session | Windows PowerShell 5.1 (built in) |
| macOS | Spotify and Apple Music (the Music app) | Their AppleScript dictionaries (`osascript`) | `tell application "Spotify"` / `tell application "Music"` | Allow the terminal to control each app the first time macOS asks (Automation permission) |
| Linux | Any MPRIS player (the most recently active one with `playerctld` running, else the first one found) | `playerctl` | `playerctl -p <player>` | `playerctl` installed (`apt install playerctl`, `dnf install playerctl`, `pacman -S playerctl`) |

The track is polled once a second. A click takes up to a second to show.

## Limits

- `/nowp` hides the band for the current session; `/nowp bar` is remembered across sessions.
- macOS and Linux support has not been tested on real machines yet.

## License

MIT

Not affiliated with, endorsed by or sponsored by Anthropic or Spotify. Claude and Claude Code are trademarks of Anthropic, PBC; Spotify is a trademark of Spotify AB.
