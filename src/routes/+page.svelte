<script lang="ts">
  import { env } from "$env/dynamic/public"
  import { browser } from "$app/environment"
  import twitch_logo from "$lib/assets/glitch_flat_black-ops.svg"
  import pkg from "@eyevinn/webrtc-player"
  import { onMount } from "svelte"
  import type { ChatMessage, WSMessageType } from "../worker"
  const { WebRTCPlayer } = pkg

  let { data } = $props()
  let session = $state(data.session)
  let twitch_logged_in = $state(data.twitch_logged_in)
  let name = $state(data.name)
  let name_color = $state(data.name_color)
  let twitch_emotes = $state(data.twitch_emotes)
  let seventv_emotes = $state(data.seventv_emotes)

  let stream_disconnected = $state(false)

  let rtc_channel_state = $state("")
  let rtc_channel_received_bytes = $state(0)

  let chat_connected = $state(false)
  let chat_can_reconnect = $state(false)

  let chat_authenticated = $state(false)

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

  let video: HTMLVideoElement

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

  let chat_input: HTMLInputElement

  let chat_ws: WebSocket | undefined

  let chat_messages: (ChatMessage | string)[] = $state([])

  async function connect_chat() {
    if (chat_ws && chat_connected) {
      chat_ws.close()
    }
    chat_can_reconnect = false
    chat_ws = new WebSocket(`wss://player.sw.arm.fm/chat`)
    chat_ws.onopen = async () => {
      chat_connected = true
      if (twitch_logged_in && session) {
        await send_chat_message({ type: "authenticate", session })
        chat_authenticated = true
      }
      await send_chat_message({ type: "history_request" })
    }
    chat_ws.onclose = () => {
      console.log("chat disconnected")
      chat_messages.push("disconnected from chat server")
      chat_connected = false
      chat_can_reconnect = true
    }
    chat_ws.onerror = (e) => {
      console.log("chat error", e)
      chat_messages.push(`disconnected from chat server with error: ${e}`)
      chat_connected = false
      chat_can_reconnect = true
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
        break
      case "user_join":
        console.log("user joined:", message.name)
        break
      case "user_leave":
        console.log("user left:", message.name)
        break
      case "error":
        console.log("chat error:", message.message)
        chat_messages.push(message.message)
        break
    }
  }

  async function handle_chat_keydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      if (chat_input.value) {
        console.log("chat input", chat_input.value)
        await send_chat_message({ type: "send_message", message: chat_input.value })
        chat_input.value = ""
      }
    }
  }

  function format_timestamp(timestamp_ms: number) {
    const date = new Date(timestamp_ms)
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const seconds = date.getSeconds().toString().padStart(2, "0")
    const milliseconds = date.getMilliseconds().toString().padStart(3, "0")
    return `${hours}:${minutes}:${seconds}.${milliseconds}`
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
  }

  #player {
    position: relative;
    display: flex;
    justify-content: center;
    width: 80%;
    background-color: black;

    iframe {
      width: 100%;
      aspect-ratio: 16 / 9;
      margin: auto;
      border: 0;
    }
  }

  #control-strip {
    position: absolute;
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

  #stats {
    flex: 1 1 auto;
    text-align: right;
    font-family: monospace;
  }

  #chat-container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
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
  }

  #chat-messages {
    flex: 1 1 auto;
    overflow-y: scroll;
    padding: 0.5rem;
    font-size: 14px;
    line-height: 1.25rem;
  }

  #chat-input {
    height: 3rem;
    width: 100%;
    padding: 0 0.5rem;
    background-color: #333;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  #chat-input-area {
    flex: 1 1 auto;
    display: flex;
    border: 1px solid #555;
    border-radius: 4px;
    height: 2rem;

    input {
      flex: 1 1 auto;
      border: 0;
      background-color: #333;
      caret-color: #ccc;
      color: #ccc;
      padding: 0 0.25rem;
      font-size: 14px;

      &:focus {
        outline: none;
      }
    }

    input:focus {
      border: 1px solid #aaa;
      border-radius: 4px;
    }
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
      <!-- svelte-ignore a11y_missing_attribute -->
      <iframe src="https://customer-x1r232qaorg7edh8.cloudflarestream.com/3a05b1a1049e0f24ef1cd7b51733ff09/iframe"> </iframe>
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
        {#if chat_can_reconnect}
          <button onclick={connect_chat}>Reconnect</button>
        {/if}
      </div>
      <div id="chat-messages">
        {#each chat_messages as message}
          <div>
            {#if typeof message === "string"}
              <em style="color: #aaa">{message}</em>
            {:else}
              <span style="color: #aaa; font-size: 12px">{format_timestamp(message.timestamp_ms)}</span>
              <span style="color: {message.name_color}">{message.name}</span>: {message.message}
            {/if}
          </div>
        {/each}
      </div>
      <div id="chat-input">
        <div id="chat-input-area">
          <input
            bind:this={chat_input}
            type="text"
            name="message"
            placeholder={twitch_logged_in ? "Enter message" : "Login to chat"}
            disabled={!twitch_logged_in || !chat_authenticated || !chat_connected}
            onkeydown={handle_chat_keydown}
          />
        </div>
      </div>
    </div>
  </div>
</div>
