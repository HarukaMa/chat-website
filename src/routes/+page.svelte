<script lang="ts">
  import { env } from "$env/dynamic/public"
  import { browser } from "$app/environment"
  import twitch_logo from "$lib/assets/glitch_flat_black-ops.svg"
  import { onMount } from "svelte"
  import type { ChatMessage, WSMessageType } from "../worker"
  import ChatMessageRow from "$lib/components/ChatMessageRow.svelte"
  import type { Action } from "svelte/action"
  import videojs from "video.js"
  import "video.js/dist/video-js.css"
  import type Player from "video.js/dist/types/player"
  import type LiveTracker from "video.js/dist/types/live-tracker"
  import type QualityLevelList from "videojs-contrib-quality-levels/dist/types/quality-level-list"
  import type QualityLevel from "videojs-contrib-quality-levels/dist/types/quality-level"
  import PlayerControlMenu from "$lib/components/PlayerControlMenu.svelte"
  import ChatConnectionCount from "$lib/components/ChatConnectionCount.svelte"
  import EmotePanel from "$lib/components/EmotePanel.svelte"

  let { data } = $props()
  let session = $state(data.session)
  let twitch_logged_in = $state(data.twitch_logged_in)
  let name = $state(data.name)
  let name_color = $state(data.name_color)
  let twitch_emotes = $state(data.twitch_emotes)
  let seventv_emotes = $state(data.seventv_emotes)
  let admins = $state(data.admins)
  let is_admin = $derived(admins.includes(name || ""))

  let chat_connected = $state(false)
  let chat_reconnecting = $state(false)
  let chat_authenticated = $state(false)
  let chat_session_counts = $state({ session: 0, logged_in: 0, unique_logged_in: 0 })
  let chat_session_count_task_id: NodeJS.Timeout | undefined

  let chat_should_scroll_to_bottom = $state(true)
  const sessionDomainSubstringed = env.PUBLIC_SESSION_DOMAIN?.startsWith("http://")
    ? env.PUBLIC_SESSION_DOMAIN.substring(7)
    : env.PUBLIC_SESSION_DOMAIN?.startsWith("https://")
      ? env.PUBLIC_SESSION_DOMAIN.substring(8)
      : env.PUBLIC_SESSION_DOMAIN

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

  const reconstructedDomain =
    !env.PUBLIC_SESSION_DOMAIN?.startsWith("http://") || !env.PUBLIC_SESSION_DOMAIN?.startsWith("https://")
      ? env.PUBLIC_SESSION_DOMAIN?.startsWith("localhost:") || env.PUBLIC_SESSION_DOMAIN?.startsWith("127.0.0.1")
        ? "http://" + env.PUBLIC_SESSION_DOMAIN
        : "https://" + env.PUBLIC_SESSION_DOMAIN
      : env.PUBLIC_SESSION_DOMAIN

  const twitch_login_url = `https://id.twitch.tv/oauth2/authorize?client_id=${env.PUBLIC_TWITCH_CLIENT_ID}&redirect_uri=${reconstructedDomain}/twitch_auth&response_type=code&scope=`

  onMount(() => {
    connect_chat()

    return () => {
      if (chat_ws) {
        chat_ws.close(1000, "going away")
      }
    }
  })

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

  let chat_input_element: HTMLSpanElement | undefined = $state(undefined)
  let chat_input_length = $state(0)

  let chat_ws: WebSocket | undefined

  let chat_messages: (ChatMessage | { id: string; type: "error" | "notification"; message: string })[] = $state([])
  let chat_messages_container: HTMLDivElement

  let chat_reconnection_timeout = $state(0)

  async function reconnect_chat() {
    if (chat_reconnection_timeout === 0) {
      chat_reconnecting = true
      chat_reconnection_timeout = 5
      setTimeout(reconnect_chat, 1000)
    } else if (chat_reconnection_timeout !== 1) {
      chat_reconnection_timeout--
      setTimeout(reconnect_chat, 1000)
    } else {
      chat_reconnection_timeout = 0
      chat_reconnecting = false
      await connect_chat()
    }
  }

  async function connect_chat() {
    if (chat_ws && chat_connected) {
      chat_ws.close(1000, "reconnection")
    }
    chat_ws = new WebSocket(`wss://player.sw.arm.fm/chat`)
    chat_ws.onopen = async () => {
      chat_connected = true
      if (twitch_logged_in && session) {
        await send_chat_message({ type: "authenticate", session })
      }
      await send_chat_message({ type: "history_request" })
      if (chat_session_count_task_id) {
        clearInterval(chat_session_count_task_id)
      }
      await send_chat_message({ type: "get_connection_counts" })
      chat_session_count_task_id = setInterval(async () => {
        await send_chat_message({ type: "get_connection_counts" })
      }, 30000)
    }
    chat_ws.onclose = (e: CloseEvent) => {
      console.log("chat disconnected")
      add_non_chat_message("error", "disconnected from chat server")
      chat_connected = false
      if (chat_session_count_task_id) {
        clearInterval(chat_session_count_task_id)
        chat_session_count_task_id = undefined
      }
      if (e.code !== 1000) {
        reconnect_chat()
      }
    }
    chat_ws.onerror = (e) => {
      console.log("chat error", e)
      add_non_chat_message("error", `disconnected from chat server with error: ${e}`)
      chat_connected = false
    }
    chat_ws.onmessage = (e) => {
      handle_chat_message(JSON.parse(e.data))
    }
  }

  async function send_chat_message(message: WSMessageType) {
    if (chat_ws) {
      chat_ws.send(JSON.stringify(message))
    }
  }

  async function handle_chat_message(message: WSMessageType) {
    switch (message.type) {
      case "auth_success":
        chat_authenticated = true
        add_non_chat_message("notification", `Authenticated as ${message.name}`)
        break
      case "message_history": {
        const existing_ids = new Set(chat_messages.map((m) => m.id))
        for (const m of message.messages) {
          if (!existing_ids.has(m.id)) {
            chat_messages.push(m)
          }
        }
        break
      }
      case "new_message":
        chat_messages.push(message.message)
        if (chat_messages.length > 500) {
          chat_messages = chat_messages.slice(-500)
        }
        break
      case "user_join":
        // console.log("user joined:", message.name)
        break
      case "user_leave":
        // console.log("user left:", message.name)
        break
      case "user_timed_out":
        add_non_chat_message("notification", `${message.name} has been timed out for ${message.duration} seconds`)
        break
      case "user_banned":
        add_non_chat_message("notification", `${message.name} has been banned`)
        break
      case "connection_counts":
        chat_session_counts = message.data
        break
      case "error":
        console.log("chat error:", message.message)
        add_non_chat_message("error", message.message)
        break
      case "notification":
        add_non_chat_message("notification", message.message)
        break
      case "message_deleted":
        message_deleted(message.id)
        break
    }
  }

  function add_non_chat_message(type: "error" | "notification", message: string) {
    chat_messages.push({ id: window.crypto.randomUUID(), type, message })
  }

  async function handle_chat_keydown(e: KeyboardEvent) {
    const input = chat_input_element!.innerText
    if (e.key === "Enter") {
      e.preventDefault()
      if (input.trim() === "") return
      await send_chat_message({ type: "send_message", message: input })
      chat_input_element!.innerText = ""
    } else if (e.key === "Tab") {
      e.preventDefault()
      if (input.endsWith("@")) {
        // autocomplete users
      } else {
        autocomplete_emote(input)
      }
    } else {
      emote_partial = ""
      emote_candidates = []
      emote_current_index = 0
      emote_first_tab = true
    }
  }

  let emote_partial = ""
  let emote_candidates: string[] = []
  let emote_current_index = 0
  let emote_first_tab = true

  function autocomplete_emote(input: string) {
    if (input === "") return
    const current_selection = window.getSelection()!
    const current_range = current_selection.getRangeAt(0)
    console.log("current selection", current_selection)
    console.log("current range", current_range)
    if (emote_partial === "") {
      // get the word just before the cursor
      const input_before_cursor = input.slice(0, current_range.startOffset)
      const words = input_before_cursor.split(" ")
      emote_partial = words[words.length - 1].toLowerCase()
      if (emote_partial === "") return
      emote_candidates =
        seventv_emotes
          ?.keys()
          .filter((emote) => emote.toLowerCase().startsWith(emote_partial))
          .toArray() ?? []
      emote_candidates = emote_candidates.concat(
        twitch_emotes
          ?.keys()
          .filter((emote) => emote.toLowerCase().startsWith(emote_partial))
          .toArray() ?? [],
      )
      emote_candidates.sort((a, b) => {
        const a_lower = a.toLowerCase()
        const b_lower = b.toLowerCase()
        if (a_lower === b_lower) return 0
        if (a_lower < b_lower) return -1
        return 1
      })
    }
    console.log("emote partial", emote_partial)
    console.log("emote candidates", emote_candidates)
    if (emote_candidates.length === 0) return
    console.log("emote current index", emote_current_index)
    const input_cursor = current_range.startOffset
    let backtrack_length = emote_partial.length
    if (!emote_first_tab) {
      let previous_index = emote_current_index - 1
      if (emote_current_index === 0) {
        previous_index = emote_candidates.length - 1
      }
      const previous_emote = emote_candidates[previous_index]
      console.log("previous emote", previous_emote)
      backtrack_length = previous_emote.length
    }
    console.log("backtrack length", backtrack_length)
    emote_first_tab = false
    const input_before_cursor = input.slice(0, input_cursor - backtrack_length)
    console.log("input before cursor", input_before_cursor)
    const input_after_cursor = input.slice(input_cursor)
    console.log("input after cursor", input_after_cursor)
    const emote_next_candidate = emote_candidates[emote_current_index]
    console.log("emote next candidate", emote_next_candidate)
    chat_input_element!.innerText = input_before_cursor + emote_next_candidate + input_after_cursor
    console.log("chat input", chat_input_element!.innerText)
    const range = document.createRange()
    range.setStart(chat_input_element!.childNodes[0], input_before_cursor.length + emote_next_candidate.length)
    console.log("range start", input_before_cursor.length + emote_next_candidate.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection!.removeAllRanges()
    selection!.addRange(range)
    emote_current_index = (emote_current_index + 1) % emote_candidates.length
    console.log("emote next index", emote_current_index)
  }

  async function handle_chat_input() {
    const input = chat_input_element!.innerText
    if (input.length > 500) {
      chat_input_element!.innerText = input.slice(0, 500)
      const range = document.createRange()
      range.setStart(chat_input_element!, 1)
      range.collapse(true)
      const selection = window.getSelection()
      selection!.removeAllRanges()
      selection!.addRange(range)
      chat_input_element!.focus()
    }
    chat_input_length = input.length
    if (chat_input_element!.innerHTML === "<br>") {
      chat_input_element!.innerHTML = ""
    }
  }

  async function delete_message(id: number) {
    await send_chat_message({ type: "delete_message", id })
  }

  function message_deleted(id: number) {
    for (let i = 0; i < chat_messages.length; i++) {
      const message = chat_messages[i]
      if (typeof message === "object" && message.id === id) {
        chat_messages.splice(i, 1)
        break
      }
    }
  }

  function on_chat_scroll() {
    chat_should_scroll_to_bottom =
      chat_messages_container.scrollTop + chat_messages_container.clientHeight > chat_messages_container.scrollHeight - 1
  }

  const scroll_to_bottom: Action = (_node) => {
    if (chat_should_scroll_to_bottom) {
      chat_messages_container.scrollTop = chat_messages_container.scrollHeight
    }
  }

  function force_scroll_to_bottom() {
    chat_messages_container.scrollTop = chat_messages_container.scrollHeight
  }

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
    })
    change_stream_type()

    // @ts-expect-error unknown
    let quality_levels: QualityLevelList = (player as unknown).qualityLevels()
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
    let source: string
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

  if (browser) {
    window.onkeydown = (e) => {
      if (e.key === "F4") {
        const show_ms = window.localStorage.getItem("show_ms")
        if (show_ms === null || show_ms === "false") {
          window.localStorage.setItem("show_ms", "true")
        } else {
          window.localStorage.setItem("show_ms", "false")
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

  #chat-container {
    display: flex;
    flex-direction: column;
    width: 20%;
    min-width: 12rem;
    background-color: #222;
    color: #eee;
  }

  #chat-status {
    height: 2rem;
    width: 100%;
    padding: 0 0.5rem;
    background-color: #333;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 0 0 auto;
    font-size: 14px;
  }

  #chat-connection-status {
    flex: 1 1 auto;
  }

  #chat-messages {
    position: relative;
    flex: 1 1 auto;
    overflow-y: scroll;
    padding: 0.5rem;
    font-size: 14px;
    line-height: 1rem;
  }

  #chat-input {
    min-height: 3rem;
    width: 100%;
    background-color: #333;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 0 0 auto;
  }

  #chat-input-area {
    flex: 1 1 auto;
    display: flex;
    border: 1px solid #555;
    border-radius: 4px;
    min-height: 2rem;
    align-items: end;
    margin: 0.5rem;

    span {
      flex: 1 1 auto;
      height: 100%;
      min-height: 1.75rem;
      border: 0;
      background-color: #333;
      caret-color: #ccc;
      color: #ccc;
      padding: 0.25rem;
      font-size: 14px;
      overflow-wrap: anywhere;

      &:focus {
        outline: none;
      }
    }

    &:has(span:focus) {
      border: 1px solid #aaa;
      border-radius: 4px;
    }
  }

  #chat-input-counter {
    color: #aaa;
    font-size: 12px;
    margin-right: 0.25rem;
    margin-bottom: 0.25rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-items: end;
  }

  #scroll-to-bottom {
    position: sticky;
    cursor: pointer;
    color: #333;
    font-size: 14px;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0.25rem 0;
    text-align: center;
    background-color: #ffffffc0;
  }

  [contenteditable="plaintext-only"]:empty:before {
    content: attr(data-placeholder);
    color: grey;
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
    <div id="chat-container">
      <div id="chat-status">
        <span id="chat-connection-status">
          {#if chat_connected}
            Connected
            {#if !twitch_logged_in}
              - Guest
            {:else if chat_authenticated}
              - Authenticated
            {/if}
          {:else}
            Disconnected
          {/if}
          {#if chat_reconnecting}
            &nbsp;(Auto-reconnect in {chat_reconnection_timeout}s)
          {/if}
        </span>
        {#if chat_session_counts.session >= 0}
          <ChatConnectionCount {chat_session_counts} />
        {/if}
      </div>
      <div id="chat-messages" bind:this={chat_messages_container} onscroll={on_chat_scroll}>
        {#each chat_messages as message (message.id)}
          <div use:scroll_to_bottom>
            {#if "type" in message }
              <em style="color: #aaa">{message.message}</em>
            {:else}
              <ChatMessageRow {...message} {twitch_emotes} {seventv_emotes} {is_admin} {delete_message} logged_in_user={name} />
            {/if}
          </div>
        {/each}
        {#if !chat_should_scroll_to_bottom}
          <div id="scroll-to-bottom" onclick={force_scroll_to_bottom}>More messages below</div>
        {/if}
      </div>
      <div id="chat-input">
        <div id="chat-input-area">
          <span
            id="chat-input-field"
            bind:this={chat_input_element}
            data-placeholder={twitch_logged_in ? "Enter message" : "Login to chat"}
            contenteditable={twitch_logged_in && chat_authenticated && chat_connected ? "plaintext-only" : "false"}
            onkeydown={handle_chat_keydown}
            oninput={handle_chat_input}
          ></span>
          <div id="chat-input-counter">
<!--            <EmotePanel {twitch_emotes} {seventv_emotes} />-->
            {#if chat_input_length > 300}
              {500 - chat_input_length}
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
