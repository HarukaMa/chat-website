<script lang="ts">
  import "modern-normalize/modern-normalize.css"
  import { env } from "$env/dynamic/public"
  import { browser } from "$app/environment"
  import twitch_logo from "$lib/assets/glitch_flat_black-ops.svg"
  import { onMount } from "svelte"
  import type { Action } from "svelte/action"
  import videojs from "video.js"
  import "video.js/dist/video-js.css"
  import "@montevideo-tech/videojs-cmcd"
  import type Player from "video.js/dist/types/player"
  import type LiveTracker from "video.js/dist/types/live-tracker"
  import type QualityLevelList from "videojs-contrib-quality-levels/dist/types/quality-level-list"
  import type QualityLevel from "videojs-contrib-quality-levels/dist/types/quality-level"
  import PlayerControlMenu from "$lib/components/PlayerControlMenu.svelte"
  import ChatPanel from "$lib/components/ChatPanel.svelte"

  let { data } = $props()
  let session = $state(data.session)
  let twitch_logged_in = $state(data.twitch_logged_in)
  let name = $state(data.name)
  let name_color = $state(data.name_color)
  let user_id = $state(data.user_id)
  let twitch_emotes = $state(data.twitch_emotes)
  let seventv_emotes = $state(data.seventv_emotes)
  let admins = $state(data.admins)
  let is_admin = $derived(admins.includes(user_id || ""))
  const sessionDomainSubstringed = env.PUBLIC_SESSION_DOMAIN?.startsWith("http://")
    ? env.PUBLIC_SESSION_DOMAIN.substring(7)
    : env.PUBLIC_SESSION_DOMAIN?.startsWith("https://")
      ? env.PUBLIC_SESSION_DOMAIN.substring(8)
      : env.PUBLIC_SESSION_DOMAIN

  onMount(() => {
    if (!session && browser) {
      const cookies = document.cookie
      let has_session = false
      for (const cookie of cookies.split(";")) {
        const [key, value] = cookie.trim().split("=")
        if (key === "swarm_fm_player_session") {
          has_session = true
          session = value
        }
      }
      if (!has_session) {
        const uuid = self.crypto.randomUUID()
        document.cookie = `swarm_fm_player_session=${uuid}; domain=${sessionDomainSubstringed}; expires=Fri, 31 Dec 9999 23:59:59 GMT; secure; samesite=lax`
        session = uuid
      }
    }
  })

  const reconstructedDomain =
    !env.PUBLIC_SESSION_DOMAIN?.startsWith("http://") || !env.PUBLIC_SESSION_DOMAIN?.startsWith("https://")
      ? env.PUBLIC_SESSION_DOMAIN?.startsWith("localhost:") || env.PUBLIC_SESSION_DOMAIN?.startsWith("127.0.0.1")
        ? "http://" + env.PUBLIC_SESSION_DOMAIN
        : "https://" + env.PUBLIC_SESSION_DOMAIN
      : env.PUBLIC_SESSION_DOMAIN

  const twitch_login_url = `https://id.twitch.tv/oauth2/authorize?client_id=${env.PUBLIC_TWITCH_CLIENT_ID}&redirect_uri=${reconstructedDomain}/twitch_auth&response_type=code&scope=`

  // async function reload_webrtc_player() {
  //   stream_disconnected = false
  //   const player = new WebRTCPlayer({
  //     video,
  //     type: "whep",
  //   })
  //   await player.load(new URL("https://customer-x1r232qaorg7edh8.cloudflarestream.com/3a05b1a1049e0f24ef1cd7b51733ff09/webRTC/play"))
  //   player.on("no-media", () => {
  //     console.log("no-media")
  //     stream_disconnected = true
  //   })
  //   player.on("connect-error", () => {
  //     console.log("connect-error")
  //     stream_disconnected = true
  //   })
  //   player.on("initial-connection-failed", () => {
  //     console.log("initial-connection-failed")
  //     stream_disconnected = true
  //   })
  //   player.on("media-recovered", () => {
  //     console.log("media-recovered")
  //     stream_disconnected = false
  //   })
  //   player.on("stats.data-channel", (report) => {
  //     rtc_channel_state = report.state
  //     rtc_channel_received_bytes = report.bytesReceived
  //   })
  // }

  let player: Player | undefined
  let player_debug_update_task_id: NodeJS.Timeout | undefined

  let stream_manifest_url_base = "https://customer-x1r232qaorg7edh8.cloudflarestream.com/3a05b1a1049e0f24ef1cd7b51733ff09/manifest/video"

  let stream_types = ["HLS", "Low L-word HLS"]
  let stream_type = $state("HLS")
  let stream_qualities = ["Auto", "1080", "720", "480", "360", "240", "Audio only"]
  let stream_quality = $state("Auto")

  let live_latency = $state(0)
  let buffer_duration = $state(0)
  let total_duration = $state(0)
  let current_quality = $state(-1)

  const videojs_init: Action = (node) => {
    if (player_debug_update_task_id !== undefined) {
      clearInterval(player_debug_update_task_id)
    }
    const ls = window.localStorage
    const ls_stream_type = ls.getItem("player_stream_type") ?? "HLS"
    if (stream_types.indexOf(ls_stream_type) !== -1) {
      stream_type = ls_stream_type
    } else {
      stream_type = "HLS"
    }
    const ls_stream_quality = ls.getItem("player_stream_quality") ?? "Auto"
    if (stream_qualities.indexOf(ls_stream_quality) !== -1) {
      stream_quality = ls_stream_quality
    } else {
      stream_quality = "Auto"
    }

    console.log("videojs init")
    const is_apple_mobile = videojs.browser.IS_IPHONE || videojs.browser.IS_IPAD
    player = videojs(node, {
      autoplay: true,
      controls: true,
      preload: "auto",
      fill: true,
      liveui: true,
      liveTracker: {
        trackingThreshold: 0,
        liveTolerance: 5,
      },
      html5: {
        vhs: {
          overrideNative: !is_apple_mobile,
        },
        nativeAudioTracks: is_apple_mobile,
        nativeVideoTracks: is_apple_mobile,
      },
    })
    // @ts-expect-error videojs plugin injection
    player.cmcd({ cid: "Swarm FM on Player", sid: session })
    change_stream_type()

    // @ts-expect-error videojs plugin injection
    let quality_levels: QualityLevelList = player.qualityLevels()
    quality_levels.on("addqualitylevel", (e: { qualityLevel: QualityLevel }) => {
      if (stream_quality === "Auto" || stream_quality === "Audio only") {
        e.qualityLevel.enabled_(true)
        return
      }
      if (e.qualityLevel.height === parseInt(stream_quality)) {
        e.qualityLevel.enabled_(true)
      } else {
        e.qualityLevel.enabled_(false)
      }
    })
    quality_levels.on("change", () => {
      console.log("quality changed", quality_levels.levels_, quality_levels.selectedIndex_)
      current_quality = quality_levels.selectedIndex_
    })

    const volume = window.localStorage.getItem("player_volume") ?? "0.5"
    player.volume(parseFloat(volume))
    player.on("volumechange", () => {
      window.localStorage.setItem("player_volume", ((player as Player).volume() as number).toString())
    })

    setInterval(() => {
      const live_tracker = player!.getChild("LiveTracker") as LiveTracker
      const current_time = player!.currentTime() as number
      const live_current_time = live_tracker.liveCurrentTime()
      total_duration = live_current_time
      const latency_offset = stream_type === "Low L-word HLS" ? 0 : 10
      live_latency = live_current_time - current_time + latency_offset
      const buffer_end = player!.bufferedEnd()
      buffer_duration = buffer_end - current_time
    }, 250)
  }

  async function change_stream_type() {
    if (player === undefined) {
      return
    }
    console.log("change stream type", stream_type)
    window.localStorage.setItem("player_stream_type", stream_type)
    let source: string | { src: string; type: string }
    if (stream_type === "Low L-word HLS") {
      const manifest_link = stream_manifest_url_base + ".m3u8?protocol=llhls"
      if (stream_quality === "Audio only") {
        source = (await fetch_audio_manifest(manifest_link)) ?? manifest_link
      } else {
        source = manifest_link
      }
    } else if (stream_type === "HLS") {
      const manifest_link = stream_manifest_url_base + ".m3u8"
      if (stream_quality === "Audio only") {
        source = (await fetch_audio_manifest(manifest_link)) ?? manifest_link
      } else {
        source = manifest_link
      }
    } else if (stream_type === "DASH") {
      // player is broken on cf stream dash
      source = stream_manifest_url_base + ".mpd"
    } else {
      return
    }
    if (player.src(undefined) !== source) {
      player.src(source)
    }
  }

  function change_stream_quality() {
    if (player === undefined) {
      return
    }
    console.log("change stream quality", stream_quality)
    // @ts-expect-error unknown
    let quality_levels: QualityLevelList = (player as unknown).qualityLevels()
    window.localStorage.setItem("player_stream_quality", stream_quality)
    change_stream_type()
    if (stream_quality === "Audio only") {
      quality_levels.levels_.forEach((level) => {
        level.enabled_(true)
      })
      return
    }
    for (let i = 0; i < quality_levels.levels_.length; i++) {
      if (stream_quality === "Auto") {
        quality_levels.levels_[i].enabled_(true)
      } else if (quality_levels.levels_[i].height === parseInt(stream_quality)) {
        quality_levels.levels_[i].enabled_(true)
      } else {
        quality_levels.levels_[i].enabled_(false)
      }
    }
  }

  async function fetch_audio_manifest(main_manifest_link: string): Promise<string | undefined> {
    const response = await fetch(main_manifest_link)
    const manifest = await response.text()
    for (const line of manifest.split("\n")) {
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const url = line.match(/URI="([^"]+)"/)?.[1]
        if (url !== undefined) {
          let manifest_path = main_manifest_link.split("/").slice(0, -1).join("/")
          console.log(manifest_path + "/" + url)

          return manifest_path + "/" + url
        }
      }
    }
  }
</script>

<style lang="scss">
  #content {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  #header {
    display: flex;
    height: 3rem;
    width: 100%;
    background-color: #222;
    justify-content: end;
    align-items: center;
    gap: 0.5rem;
    padding: 0 1rem;
    color: #eee;
    flex: 0 0 auto;
  }

  #twitch-login {
    all: unset;
    display: flex;
    padding: 0.25rem 0.5rem;
    gap: 0.25rem;
    background-color: #9146ff;
    border-radius: 4px;
    align-items: center;
    cursor: pointer;
    color: white;

    img {
      height: 1.5rem;
      width: 1.5rem;
    }
  }

  #main {
    display: flex;
    flex: 1 1 auto;
    background-color: bisque;
    min-height: 40rem;
  }

  #player {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 80%;
    background-color: black;

    video-js {
      flex: 1 1 auto;
    }
  }

  #control-strip {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    gap: 1rem;
    bottom: 0;
    height: 3rem;
    max-height: 3rem;
    width: 100%;
    background-color: #222;
    padding: 0.5rem;
    color: #eee;
  }

  .flex-spacer {
    flex: 1 1 auto;
  }

  #stats {
    font-family: monospace;
    display: flex;
    flex-direction: column;
    flex-wrap: wrap;
    column-gap: 0.5rem;
  }

  #player-control {
    display: flex;
    flex-direction: row-reverse;
    flex-wrap: wrap;
    column-gap: 0.5rem;
    align-items: center;
    padding-right: 1rem;
  }
</style>

<svelte:head>
  <title>Swarm FM Player</title>
</svelte:head>

<div id="content">
  <div id="header">
    {#if !twitch_logged_in}
      <a id="twitch-login" href={twitch_login_url}>
        <img src={twitch_logo} alt="Twitch logo" />
        Login with Twitch
      </a>
    {:else}
      Logged in as <span style="color: {name_color}">{name}</span>
    {/if}
  </div>
  <div id="main">
    <div id="player">
      <video-js id="live" use:videojs_init></video-js>
      <div id="control-strip">
        <div id="stats">
          <div id="player-latency">L-word: {live_latency.toFixed(2)}s</div>
          <div id="player-buffer">Buffer: {buffer_duration.toFixed(2)}s</div>
          <div id="player-duration">Time: {total_duration.toFixed(2)}s</div>
          <div id="player-quality">Quality: {current_quality}</div>
        </div>
        <div class="flex-spacer"></div>
        <div id="player-control">
          <PlayerControlMenu
            control_name="Quality"
            control_options={stream_qualities}
            selected_index={stream_qualities.indexOf(stream_quality)}
            select={(index) => {
              stream_quality = stream_qualities[index]
              change_stream_quality()
            }}
          />
          <PlayerControlMenu
            control_name="Type"
            control_options={stream_types}
            selected_index={stream_types.indexOf(stream_type)}
            select={(index) => {
              stream_type = stream_types[index]
              change_stream_type()
            }}
          />
        </div>
      </div>
    </div>
    <ChatPanel {name} {user_id} {session} {is_admin} {seventv_emotes} {twitch_emotes} {twitch_logged_in} />
  </div>
</div>
