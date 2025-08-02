<script lang="ts">
  import { env } from "$env/dynamic/public"
  import { browser } from "$app/environment"
  import twitch_logo from "$lib/assets/glitch_flat_black-ops.svg"
  import users_icon from "$lib/assets/fa-users.svg"
  import { onMount } from "svelte"
  import type { ChatMessage, WSMessageType } from "../worker"
  import ChatMessageRow from "$lib/components/ChatMessageRow.svelte"
  import type { Action } from "svelte/action"
  import videojs from "video.js"
  import "video.js/dist/video-js.css"
  import type Player from "video.js/dist/types/player"

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
  let chat_session_count = $state(0)
  let chat_session_count_task_id: NodeJS.Timeout | undefined

  let chat_should_scroll_to_bottom = $state(true)

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
      document.cookie = `swarm_fm_player_session=${uuid}; domain=${env.PUBLIC_SESSION_DOMAIN}; expires=Fri, 31 Dec 9999 23:59:59 GMT; secure; samesite=lax`
      session = uuid
    }
  }

  const twitch_login_url = `https://id.twitch.tv/oauth2/authorize?client_id=${env.PUBLIC_TWITCH_CLIENT_ID}&redirect_uri=https://${env.PUBLIC_SESSION_DOMAIN}/twitch_auth&response_type=code&scope=`

  onMount(async () => {
    await connect_chat()
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

  let chat_messages: (ChatMessage | string)[] = $state([])
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
      chat_ws.close()
    }
    chat_ws = new WebSocket(`wss://player.sw.arm.fm/chat`)
    chat_ws.onopen = async () => {
      chat_connected = true
      if (twitch_logged_in && session) {
        await send_chat_message({ type: "authenticate", session })
        chat_authenticated = true
      }
      await send_chat_message({ type: "history_request" })
      if (chat_session_count_task_id) {
        clearInterval(chat_session_count_task_id)
      }
      await send_chat_message({ type: "get_connection_count" })
      chat_session_count_task_id = setInterval(async () => {
        await send_chat_message({ type: "get_connection_count" })
      }, 30000)
    }
    chat_ws.onclose = () => {
      console.log("chat disconnected")
      chat_messages.push("disconnected from chat server")
      chat_connected = false
      if (chat_session_count_task_id) {
        clearInterval(chat_session_count_task_id)
        chat_session_count_task_id = undefined
      }
      reconnect_chat()
    }
    chat_ws.onerror = (e) => {
      console.log("chat error", e)
      chat_messages.push(`disconnected from chat server with error: ${e}`)
      chat_connected = false
    }
    chat_ws.onmessage = (e) => {
      console.log("chat message", e)
      handle_chat_message(JSON.parse(e.data))
    }
  }

  async function send_chat_message(message: WSMessageType) {
    if (chat_ws) {
      console.log("sending chat message", message)
      chat_ws.send(JSON.stringify(message))
    }
  }

  async function handle_chat_message(message: WSMessageType) {
    console.log("received chat message", message)
    switch (message.type) {
      case "message_history":
        chat_messages = message.messages
        break
      case "new_message":
        chat_messages.push(message.message)
        if (chat_messages.length > 500) {
          chat_messages = chat_messages.slice(-500)
        }
        break
      case "user_join":
        console.log("user joined:", message.name)
        break
      case "user_leave":
        console.log("user left:", message.name)
        break
      case "user_timed_out":
        chat_messages.push(`${message.name} has been timed out for ${message.duration} seconds`)
        break
      case "user_banned":
        chat_messages.push(`${message.name} has been banned`)
        break
      case "connection_count":
        chat_session_count = message.count
        break
      case "error":
        console.log("chat error:", message.message)
        chat_messages.push(message.message)
        break
      case "message_deleted":
        message_deleted(message.id)
        break
    }
  }

  async function handle_chat_keydown(e: KeyboardEvent) {
    if (!chat_input_element) return
    const input = chat_input_element.innerText
    if (e.key === "Enter") {
      e.preventDefault()
      if (input.trim() === "") return
      console.log("chat input", input)
      await send_chat_message({ type: "send_message", message: input })
      // eslint-disable-next-line svelte/no-dom-manipulating
      chat_input_element.innerText = ""
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
    if (!chat_input_element) return
    if (input === "") return
    if (emote_partial === "") {
      emote_partial = input.split(" ").pop()?.toLowerCase() ?? ("" as string)
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
    }
    console.log("emote partial", emote_partial)
    console.log("emote candidates", emote_candidates)
    if (emote_candidates.length === 0) return
    console.log("emote current index", emote_current_index)
    const current_selection = window.getSelection() ?? new Selection()
    const current_range = current_selection.getRangeAt(0)
    console.log("current selection", current_selection)
    console.log("current range", current_range)
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
    // eslint-disable-next-line svelte/no-dom-manipulating
    chat_input_element.innerText = input_before_cursor + emote_next_candidate + input_after_cursor
    console.log("chat input", chat_input_element.innerText)
    const range = document.createRange()
    range.setStart(chat_input_element.childNodes[0], input_before_cursor.length + emote_next_candidate.length)
    console.log("range start", input_before_cursor.length + emote_next_candidate.length)
    range.collapse(true)
    const selection = window.getSelection()
    if (!selection) throw new Error("No selection???")
    selection.removeAllRanges()
    selection.addRange(range)
    emote_current_index = (emote_current_index + 1) % emote_candidates.length
    console.log("emote next index", emote_current_index)
  }

  async function handle_chat_input() {
    if (!chat_input_element) return
    const input = chat_input_element.innerText
    if (input.length > 500) {
      // eslint-disable-next-line svelte/no-dom-manipulating
      chat_input_element.innerText = input.slice(0, 500)
      const range = document.createRange()
      range.setStart(chat_input_element, 1)
      range.collapse(true)
      const selection = window.getSelection()
      if (!selection) throw new Error("No selection???")
      selection.removeAllRanges()
      selection.addRange(range)
      chat_input_element.focus()
    }
    chat_input_length = input.length
    if (chat_input_element.innerHTML === "<br>") {
      // eslint-disable-next-line svelte/no-dom-manipulating
      chat_input_element.innerHTML = ""
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

  const videojs_init: Action = (node) => {
    console.log("videojs init")
    player = videojs(node, {
      autoplay: "any",
      controls: true,
      preload: "auto",
      fill: true,
      liveui: true,
      liveTracker: {
        trackingThreshold: 0,
        liveTolerance: 5,
      },
    })
    const volume = window.localStorage.getItem("player_volume") ?? "0.5"
    player.volume(parseFloat(volume))
    player.on("volumechange", () => {
      window.localStorage.setItem("player_volume", ((player as Player).volume() as number).toString())
    })
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
    width: 100%;
    background-color: #222;
    padding: 0.5rem;
    color: #eee;
  }

  //#stats {
  //  flex: 1 1 auto;
  //  text-align: right;
  //  font-family: monospace;
  //}

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

  #chat-session-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    img {
      filter: invert(1);
      height: 1rem;
      width: 1rem;
    }
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

  [contenteditable="true"]:empty:not(:focus):before {
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
      <video-js id="live" use:videojs_init>
        <source
          src="https://customer-x1r232qaorg7edh8.cloudflarestream.com/3a05b1a1049e0f24ef1cd7b51733ff09/manifest/video.m3u8"
          type="application/x-mpegURL"
        />
      </video-js>
      <div id="control-strip">
        control strip placeholder
        <!--{#if stream_disconnected}-->
        <!--  <button onclick={() => reload_webrtc_player()}>Reload stream</button>-->
        <!--{/if}-->
        <!--<div id="stats">recv: {rtc_channel_received_bytes} state: {rtc_channel_state}</div>-->
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
        {#if chat_session_count > 0}
          <div id="chat-session-count">
            <img src={users_icon} alt="Chat users" />
            {chat_session_count}
          </div>
        {/if}
      </div>
      <div id="chat-messages" bind:this={chat_messages_container} onscroll={on_chat_scroll}>
        {#each chat_messages as message (message)}
          <div use:scroll_to_bottom>
            {#if typeof message === "string"}
              <em style="color: #aaa">{message}</em>
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
            {#if chat_input_length > 300}
              {500 - chat_input_length}
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
