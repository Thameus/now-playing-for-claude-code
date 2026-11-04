import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Now } from '../types'

const EMPTY: Now = {
  isOpen: false,
  isPlaying: false,
  track: '',
  album: '',
  posMs: 0,
  endMs: 0,
  atMs: 0,
  source: '',
}

const BAR = 12

const now = atom({ plugin: 'now-playing-band', key: 'now' } as const, EMPTY, { shape: 'now-5' })
const tick = atom({ plugin: 'now-playing-band', key: 'tick' } as const, 0)
const isHidden = atom({ plugin: 'now-playing-band', key: 'isHidden' } as const, false)
const showBar = atom({ plugin: 'now-playing-band', key: 'showBar' } as const, true)

type Os = 'windows' | 'mac' | 'linux'
type Action = 'prev' | 'play' | 'next'

// Every platform prints the same line, `L:` + tab-separated fields:
// state (P playing, S paused, C closed), "Artist - Title", album, position, duration,
// updated at (epoch ms, or empty), source (the player the buttons address).

// Windows: the system media sessions (SMTC) of every player (Spotify, browsers, VLC, ...), which know
// the track even while paused and take commands for one session alone.
const WINDOWS_PRELUDE = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } | Select-Object -First 1",
  'function Await($op,[Type]$t){ $task=$asTask.MakeGenericMethod($t).Invoke($null,@($op)); $task.Wait(-1) | Out-Null; $task.Result }',
  '[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]',
  '$MgrT=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]',
  '$PropsT=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]',
  '$mgr=Await ($MgrT::RequestAsync()) $MgrT',
  'function ById($id){ $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $id } | Select-Object -First 1 }',
]

// The player shown: the one playing (the same one while it keeps playing), else the last one shown,
// else Windows' current session.
const WINDOWS_WATCH = [
  ...WINDOWS_PRELUDE,
  '$T=[char]9',
  "$last='#'",
  "$lastId=''",
  'function Pick(){',
  '  $all=@($mgr.GetSessions()); if($all.Count -eq 0){ return $null }',
  "  $playing=@($all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' })",
  '  $keep=$playing | Where-Object { $_.SourceAppUserModelId -eq $script:lastId } | Select-Object -First 1',
  '  if($keep){ return $keep }; if($playing.Count -gt 0){ return $playing[0] }',
  '  $keep=ById $script:lastId; if($keep){ return $keep }',
  '  $cur=$mgr.GetCurrentSession(); if($cur){ return $cur }; return $all[0]',
  '}',
  'while($true){',
  "  $o='C'",
  '  try {',
  '    $s=Pick',
  '    if($s){',
  '      $script:lastId=$s.SourceAppUserModelId',
  '      $pr=Await ($s.TryGetMediaPropertiesAsync()) $PropsT',
  '      $tl=$s.GetTimelineProperties()',
  "      $st=if($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing'){'P'}else{'S'}",
  "      $name=if($pr.Artist){$pr.Artist+' - '+$pr.Title}else{$pr.Title}",
  '      $o=$st+$T+$name+$T+[string]$pr.AlbumTitle+$T+[long]$tl.Position.TotalMilliseconds+$T+[long]$tl.EndTime.TotalMilliseconds+$T+$tl.LastUpdatedTime.ToUnixTimeMilliseconds()+$T+$s.SourceAppUserModelId',
  '    }',
  '  } catch {}',
  "  if($o -ne $last){ [Console]::Out.WriteLine('L:'+$o); [Console]::Out.Flush(); $last=$o }",
  '  Start-Sleep -Milliseconds 1000',
  '}',
].join('\n')

const WINDOWS_ACTION: Record<Action, string> = {
  prev: 'TrySkipPreviousAsync',
  play: 'TryTogglePlayPauseAsync',
  next: 'TrySkipNextAsync',
}
const windowsPress = (action: Action, source: string) =>
  [
    ...WINDOWS_PRELUDE,
    `$s=ById '${source.replaceAll("'", "''")}'; if($s){ [void](Await ($s.${WINDOWS_ACTION[action]}()) ([bool])) }`,
  ].join('\n')

// macOS: the AppleScript dictionaries of Spotify and Music (Apple Music), the players macOS lets a
// third party read; neither is launched when closed. The player shown: the one playing (the last
// one shown when both are), else the last one shown, else whichever is open. Spotify gives the
// duration in milliseconds, Music in seconds.
const MAC_READ = [
  'on run argv',
  '  set lastApp to ""',
  '  if (count of argv) > 0 then set lastApp to item 1 of argv',
  '  set sp to ""',
  '  if application "Spotify" is running then',
  '    try',
  '      tell application "Spotify"',
  '        set t to current track',
  '        set st to "S"',
  '        if player state is playing then set st to "P"',
  '        set sp to st & tab & (artist of t) & " - " & (name of t) & tab & (album of t) & tab & ((player position * 1000) as integer) & tab & (duration of t) & tab & tab & "Spotify"',
  '      end tell',
  '    end try',
  '  end if',
  '  set mu to ""',
  '  if application "Music" is running then',
  '    try',
  '      tell application "Music"',
  '        set t to current track',
  '        set st to "S"',
  '        if player state is playing then set st to "P"',
  '        set mu to st & tab & (artist of t) & " - " & (name of t) & tab & (album of t) & tab & ((player position * 1000) as integer) & tab & (((duration of t) * 1000) as integer) & tab & tab & "Music"',
  '      end tell',
  '    end try',
  '  end if',
  '  set spPlaying to (sp starts with "P")',
  '  set muPlaying to (mu starts with "P")',
  '  if spPlaying and muPlaying then',
  '    if lastApp is "Music" then return mu',
  '    return sp',
  '  end if',
  '  if spPlaying then return sp',
  '  if muPlaying then return mu',
  '  if lastApp is "Music" and mu is not "" then return mu',
  '  if sp is not "" then return sp',
  '  if mu is not "" then return mu',
  '  return "C"',
  'end run',
].join('\n')
// Remembers the last player shown (the line's last field) and hands it to the next read.
const MAC_WATCH =
  'last=""; while :; do o=$(osascript -e "$NOWP_SCRIPT" "$last" 2>/dev/null) || o=C; o=${o:-C}; [ "$o" = C ] || last=${o##*\t}; printf "L:%s\\n" "$o"; sleep 1; done'
const MAC_ACTION: Record<Action, string> = { prev: 'previous track', play: 'playpause', next: 'next track' }
const MAC_APPS = new Set(['Spotify', 'Music'])

// Linux: MPRIS players through playerctl (position and length in microseconds). Without a player named,
// playerctl reads the most recently active one when playerctld runs, else the first one it finds.
const LINUX_FORMAT = '{{status}}\t{{artist}} - {{title}}\t{{album}}\t{{position}}\t{{mpris:length}}\t\t{{playerName}}'
const LINUX_WATCH = 'while :; do o=$(playerctl metadata --format "$NOWP_SCRIPT" 2>/dev/null) || o=C; printf "L:%s\\n" "${o:-C}"; sleep 1; done'
const LINUX_ACTION: Record<Action, string> = { prev: 'previous', play: 'play-pause', next: 'next' }

const PS = ['powershell', '-NoProfile', '-NonInteractive', '-Command'] as const

async function detectOs($: EngineInterface): Promise<Os> {
  try {
    const { exitCode, stdout } = await $.process.run(['uname', '-s'], { timeoutMs: 5000 })
    if (exitCode === 0 && stdout.trim() === 'Darwin') return 'mac'
    if (exitCode === 0 && stdout.trim() === 'Linux') return 'linux'
  } catch {
    // No uname on the PATH: Windows.
  }
  return 'windows'
}

function watchRequest(os: Os) {
  if (os === 'mac') return { argv: ['sh', '-c', MAC_WATCH], env: { NOWP_SCRIPT: MAC_READ } }
  if (os === 'linux') return { argv: ['sh', '-c', LINUX_WATCH], env: { NOWP_SCRIPT: LINUX_FORMAT } }
  return { argv: [...PS, WINDOWS_WATCH] }
}

function pressArgv(os: Os, action: Action, source: string): string[] {
  if (os === 'mac') {
    const app = MAC_APPS.has(source) ? source : 'Spotify'
    return ['osascript', '-e', `tell application "${app}" to ${MAC_ACTION[action]}`]
  }
  if (os === 'linux') return source ? ['playerctl', '-p', source, LINUX_ACTION[action]] : ['playerctl', LINUX_ACTION[action]]
  return [...PS, windowsPress(action, source)]
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const HELP = 'Usage: /nowp (show/hide the band) · /nowp bar (show/hide the progress bar)'

export const register: Register = on => {
  let isPlaying = false
  let os: Os = 'windows'

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: 'nowp',
      description: 'Now playing track above the prompt: show/hide; /nowp bar shows/hides the progress bar',
      argumentHint: '[bar]',
    })

    const saved = await $.store.get('showBar')
    if (typeof saved === 'boolean') await update($, showBar, () => saved)

    $.clock.every(1000, async () => {
      if (!isPlaying) return
      const ms = await $.clock.now()
      await update($, tick, () => ms)
    })

    void (async () => {
      os = await detectOs($)
      const scale = os === 'linux' ? 1 / 1000 : 1
      let last: Now | null = null
      let wait = 5000
      for (;;) {
        let buffer = ''
        const startedAt = await $.clock.now()
        try {
          const watch = $.process.spawn(watchRequest(os))
          for await (const { stream, text } of watch) {
            if (stream !== 'stdout') continue
            buffer += text
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('L:')) continue
              const [kind = 'C', rawTrack = '', album = '', pos = '0', end = '0', at = '', source = ''] = line
                .slice(2)
                .split('\t')
              const ms = await $.clock.now()
              const isClosed = kind === 'C'
              const playing = /^(P|Playing)$/.test(kind)
              const track = rawTrack.replace(/^ - /, '').trim()
              const fresh: Now = isClosed
                ? { ...(last ?? EMPTY), isOpen: false, isPlaying: false }
                : {
                    isOpen: true,
                    isPlaying: playing,
                    track: track || last?.track || '',
                    album,
                    posMs: Math.round((Number(pos) || 0) * scale),
                    endMs: Math.round((Number(end) || 0) * scale),
                    atMs: Number(at) || ms,
                    source,
                  }

              // Polled platforms print every second: skip a line whose clock moved only as predicted.
              if (
                last !== null &&
                last.isOpen === fresh.isOpen &&
                last.isPlaying === fresh.isPlaying &&
                last.track === fresh.track &&
                last.album === fresh.album &&
                last.source === fresh.source &&
                last.endMs === fresh.endMs
              ) {
                const predicted = last.posMs + (last.isPlaying ? fresh.atMs - last.atMs : 0)
                if (!fresh.isOpen || Math.abs(predicted - fresh.posMs) < 2000) continue
              }
              last = fresh

              isPlaying = fresh.isPlaying
              await update($, tick, () => ms)
              await update($, now, () => fresh)
            }
          }
        } catch {
          // The reader could not start; tried again below.
        }
        // The reader ended (crash, sleep, update): hide the band and start it again, slower each time it dies fast.
        isPlaying = false
        last = null
        await update($, now, prev => ({ ...prev, isOpen: false, isPlaying: false }))
        wait = (await $.clock.now()) - startedAt > 60000 ? 5000 : Math.min(wait * 2, 300000)
        await $.clock.sleep(wait)
      }
    })()

    return started
  })

  on('command.run', { command: 'nowp' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)

    if (verb === '') {
      let hidden = false
      await update($, isHidden, h => (hidden = !h))
      return { text: hidden ? 'Now playing band hidden.' : 'Now playing band shown.' }
    }

    if (verb === 'bar' && arg === '') {
      let shown = true
      await update($, showBar, v => (shown = !v))
      await $.store.set('showBar', shown)
      return { text: shown ? 'Progress bar shown.' : 'Progress bar hidden.' }
    }

    return { text: HELP }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, now)
    if (e.props.hasSurvey || !state.isOpen || (await read($, isHidden))) return next(e)

    const at = await read($, tick)
    const hasBar = (await read($, showBar)) && state.endMs > 0
    const { Box, Button, Text } = $.ui.resolve(e)
    const send = (action: Action) => () => {
      void $.process.run(pressArgv(os, action, state.source))
    }

    const elapsed = state.isPlaying && at > state.atMs ? at - state.atMs : 0
    const pos = state.endMs > 0 ? Math.min(state.posMs + elapsed, state.endMs) : 0
    const filled = state.endMs > 0 ? Math.round((pos / state.endMs) * BAR) : 0
    const showAlbum = state.album !== '' && !state.track.endsWith(` - ${state.album}`)

    const controls = (
      <Box>
        <Button key="prev" plain label="[«]" onPress={send('prev')} />
        <Text> </Text>
        <Button key="play" plain label={state.isPlaying ? '[=]' : '[>]'} onPress={send('play')} />
        <Text> </Text>
        <Button key="next" plain label="[»]" onPress={send('next')} />
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green">♪ </Text>
          <Text>{state.track || 'Now playing'}</Text>
          {showAlbum ? <Text dimColor> · {state.album}</Text> : null}
          {hasBar ? null : <Text>{'  '}</Text>}
          {hasBar ? null : controls}
        </Box>
        {hasBar ? (
          <Box>
            <Text>
              <Text dimColor>{clock(pos)} </Text>
              <Text color="green">{'━'.repeat(filled)}</Text>
              <Text dimColor>{'─'.repeat(BAR - filled)} {clock(state.endMs)}</Text>
              {'  '}
            </Text>
            {controls}
          </Box>
        ) : null}
      </Box>
    )
  })
}
