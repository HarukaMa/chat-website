<script lang="ts">
  import ChatConnectionCount from "$lib/components/ChatConnectionCount.svelte"
  import ChatMessageRow from "$lib/components/ChatMessageRow.svelte"
  import EmotePanel from "$lib/components/EmotePanel.svelte"
  import { browser } from "$app/environment"
  import { onMount } from "svelte"
  import type { ChatMessage, SevenTVEmotes, TwitchEmotes, WSMessageType } from "../../worker"
  import { lower_cmp } from "$lib/utils"
  import type { Action } from "svelte/action"

  type ChatPanelProps = {
    twitch_logged_in: boolean
    session: string | null
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
    is_admin: boolean
    name: string | null
  }

  let { twitch_logged_in, session, twitch_emotes, seventv_emotes, is_admin, name }: ChatPanelProps = $props()

  let chat_connected = $state(false)
  let chat_reconnecting = $state(false)
  let chat_authenticated = $state(false)
  let chat_session_counts = $state({ session: 0, logged_in: 0, unique_logged_in: 0 })
  let chat_session_count_task_id: NodeJS.Timeout | undefined

  let chat_should_scroll_to_bottom = $state(true)

  let chat_input_element: HTMLSpanElement | undefined = $state(undefined)
  let chat_input_length = $state(0)

  let chat_ws: WebSocket | undefined

  let chat_messages: (ChatMessage | { id: string; type: "error" | "notification"; message: string })[] = $state([])
  let chat_messages_container: HTMLDivElement

  let chat_reconnection_timeout = $state(0)

  let online_users: string[] = $state([])

  onMount(() => {
    connect_chat()

    return () => {
      if (chat_ws) {
        chat_ws.close(1000, "going away")
      }
    }
  })

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
      add_non_chat_message("notification", "connected to chat server")
      if (twitch_logged_in && session) {
        await send_chat_message({ type: "authenticate", session })
      }
      await send_chat_message({ type: "user_list" })
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
        if (chat_messages.length > 1000) {
          chat_messages = chat_messages.slice(-1000)
        }
        break
      case "user_list":
        online_users = message.users!
        break
      case "user_join":
        online_users.push(message.name)
        break
      case "user_leave": {
        const index = online_users.indexOf(message.name)
        if (index !== -1) {
          online_users.splice(index, 1)
        }
        break
      }
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
      await send_chat_message({ type: "send_message", message: input.trim() })
      chat_input_element!.innerText = ""
    } else if (e.key === "Tab") {
      e.preventDefault()
      autocomplete(input)
    } else {
      autocomplete_partial = ""
      autocomplete_candidates = []
      autocomplete_current_index = 0
      autocomplete_first_tab = true
    }
  }

  let autocomplete_partial = ""
  let autocomplete_candidates: string[] = []
  let autocomplete_current_index = 0
  let autocomplete_first_tab = true

  function autocomplete(input: string) {
    if (input === "") return
    const current_selection = window.getSelection()!
    const current_range = current_selection.getRangeAt(0)
    console.log("current selection", current_selection)
    console.log("current range", current_range)
    if (autocomplete_partial === "") {
      // get the word just before the cursor
      const input_before_cursor = input.slice(0, current_range.startOffset)
      const words = input_before_cursor.split(" ")
      autocomplete_partial = words[words.length - 1].toLowerCase()
      if (autocomplete_partial === "") return
      if (autocomplete_partial.startsWith("@")) {
        autocomplete_partial = autocomplete_partial.slice(1)
        if (autocomplete_partial === "") return
        autocomplete_candidates = online_users.filter((user) => user.toLowerCase().startsWith(autocomplete_partial))
      } else {
        autocomplete_candidates =
          seventv_emotes
            ?.keys()
            .filter((emote) => emote.toLowerCase().startsWith(autocomplete_partial))
            .toArray() ?? []
        autocomplete_candidates = autocomplete_candidates.concat(
          twitch_emotes
            ?.keys()
            .filter((emote) => emote.toLowerCase().startsWith(autocomplete_partial))
            .toArray() ?? [],
        )
      }
      autocomplete_candidates.sort(lower_cmp)
    }
    console.log("autocomplete partial", autocomplete_partial)
    console.log("autocomplete candidates", autocomplete_candidates)
    if (autocomplete_candidates.length === 0) return
    console.log("autocomplete current index", autocomplete_current_index)
    const input_cursor = current_range.startOffset
    let backtrack_length = autocomplete_partial.length
    if (!autocomplete_first_tab) {
      let previous_index = autocomplete_current_index - 1
      if (autocomplete_current_index === 0) {
        previous_index = autocomplete_candidates.length - 1
      }
      const previous_autocomplete = autocomplete_candidates[previous_index]
      console.log("previous autocomplete", previous_autocomplete)
      backtrack_length = previous_autocomplete.length
    }
    console.log("backtrack length", backtrack_length)
    autocomplete_first_tab = false
    const input_before_cursor = input.slice(0, input_cursor - backtrack_length)
    console.log("input before cursor", input_before_cursor)
    const input_after_cursor = input.slice(input_cursor)
    console.log("input after cursor", input_after_cursor)
    const autocomplete_next_candidate = autocomplete_candidates[autocomplete_current_index]
    console.log("autocomplete next candidate", autocomplete_next_candidate)
    chat_input_element!.innerText = input_before_cursor + autocomplete_next_candidate + input_after_cursor
    console.log("chat input", chat_input_element!.innerText)
    const range = document.createRange()
    range.setStart(chat_input_element!.childNodes[0], input_before_cursor.length + autocomplete_next_candidate.length)
    console.log("range start", input_before_cursor.length + autocomplete_next_candidate.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection!.removeAllRanges()
    selection!.addRange(range)
    autocomplete_current_index = (autocomplete_current_index + 1) % autocomplete_candidates.length
    console.log("autocomplete next index", autocomplete_current_index)
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

  function insert_emote(emote: string) {
    const input = chat_input_element!.textContent ?? ""
    let insert = ""
    if (input !== "" && !input.endsWith(" ")) {
      insert = ` ${emote} `
    } else {
      insert = `${emote} `
    }
    chat_input_element!.textContent = input + insert
    handle_chat_input()
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
      white-space: pre-wrap;

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

  #chat-input-field:empty:before {
    content: attr(data-placeholder);
    color: grey;
  }
</style>

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
        {#if "type" in message}
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
        <EmotePanel {twitch_emotes} {seventv_emotes} {insert_emote} />
        {#if chat_input_length > 300}
          {500 - chat_input_length}
        {/if}
      </div>
    </div>
  </div>
</div>
