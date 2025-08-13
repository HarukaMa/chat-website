<script lang="ts">
  import ChatConnectionCount from "$lib/components/ChatConnectionCount.svelte"
  import ChatMessageRow from "$lib/components/ChatMessageRow.svelte"
  import EmotePanel from "$lib/components/EmotePanel.svelte"
  import { browser } from "$app/environment"
  import { onMount } from "svelte"
  import type { ChatMessage, SevenTVEmotes, TwitchEmotes, WSMessageType } from "../../worker"
  import { lower_cmp } from "$lib/utils"
  import type { Action } from "svelte/action"
  import cancel_icon from "$lib/assets/fa-circle-xmark.svg"
  import { SvelteMap } from "svelte/reactivity"

  type ChatPanelProps = {
    twitch_logged_in: boolean
    session: string | null
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
    is_admin: boolean
    name: string | null
    user_id: string | null
  }

  let { twitch_logged_in, session, twitch_emotes, seventv_emotes, is_admin, name, user_id }: ChatPanelProps = $props()

  let chat_connected = $state(false)
  let chat_reconnecting = $state(false)
  let chat_authenticated = $state(false)
  let chat_session_counts = $state({ session: 0, logged_in: 0, unique_logged_in: 0 })
  let chat_session_count_task_id: NodeJS.Timeout | undefined

  let chat_should_scroll_to_bottom = $state(true)

  let chat_input_element: HTMLSpanElement | undefined = $state(undefined)
  let chat_input_length = $state(0)

  let chat_ws: WebSocket | undefined

  let chat_messages: Map<number | string, ChatMessage | { id: string; type: "error" | "notification"; message: string }> = new SvelteMap()
  let chat_messages_container: HTMLDivElement

  let chat_reconnection_timeout = $state(0)

  let online_users: string[] = $state([])

  let chat_replying_to: ChatMessage | null = $state(null)

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
        for (const m of message.messages) {
          if (!chat_messages.has(m.id)) {
            chat_messages.set(m.id, m)
          }
        }
        break
      }
      case "new_message":
        chat_messages.set(message.message.id, message.message)
        if (chat_messages.size > 1000) {
          const keys = chat_messages.keys()
          for (let i = 0; i < chat_messages.size - 1000; i++) {
            chat_messages.delete(keys.next().value!)
          }
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
    const message_id = window.crypto.randomUUID()
    chat_messages.set(message_id, { id: message_id, type, message })
  }

  async function handle_chat_keydown(e: KeyboardEvent) {
    const input = chat_input_element!.innerText
    if (e.key === "Enter") {
      e.preventDefault()
      if (input.trim() === "") return
      await send_chat_message({ type: "send_message_v2", message: input.trim(), reply_to_id: chat_replying_to?.id ?? null })
      chat_input_element!.innerText = ""
      chat_replying_to = null
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

    if (autocomplete_partial === "") {
      // get the word just before the cursor
      const input_before_cursor = input.slice(0, current_range.startOffset)
      const words = input_before_cursor.split(" ")
      autocomplete_partial = words[words.length - 1].toLowerCase()
      if (autocomplete_partial === "") return
      // check autocomplete type and get candidates
      if (autocomplete_partial.startsWith("@")) {
        // autocomplete users
        autocomplete_partial = autocomplete_partial.slice(1)
        if (autocomplete_partial === "") return
        autocomplete_candidates = online_users.filter((user) => user.toLowerCase().startsWith(autocomplete_partial))
      } else {
        // autocomplete emotes
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
    if (autocomplete_candidates.length === 0) return

    let backtrack_length = autocomplete_partial.length
    if (!autocomplete_first_tab) {
      let previous_index = autocomplete_current_index - 1
      if (autocomplete_current_index === 0) {
        previous_index = autocomplete_candidates.length - 1
      }
      const previous_autocomplete = autocomplete_candidates[previous_index]
      backtrack_length = previous_autocomplete.length
    }
    autocomplete_first_tab = false

    // update input
    const input_cursor = current_range.startOffset
    const input_before_cursor = input.slice(0, input_cursor - backtrack_length)
    const input_after_cursor = input.slice(input_cursor)
    const autocomplete_next_candidate = autocomplete_candidates[autocomplete_current_index]
    chat_input_element!.innerText = input_before_cursor + autocomplete_next_candidate + input_after_cursor

    // move cursor to end of autocomplete
    const range = document.createRange()
    range.setStart(chat_input_element!.childNodes[0], input_before_cursor.length + autocomplete_next_candidate.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection!.removeAllRanges()
    selection!.addRange(range)

    autocomplete_current_index = (autocomplete_current_index + 1) % autocomplete_candidates.length
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
    for (let i = 0; i < chat_messages.size; i++) {
      chat_messages.delete(id)
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

  async function reply_to_message(message: ChatMessage) {
    chat_replying_to = message
  }

  function cancel_reply() {
    chat_replying_to = null
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

  @media screen and (width <= 1280px) {
    #chat-container {
      width: 30%;
    }
  }

  @media screen and (width <= 480px) {
    #chat-container {
      width: 100%;
      height: 65%;
    }
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
    gap: 0.25rem;
    flex: 0 0 auto;
    flex-direction: column;
  }

  #chat-input-area {
    flex: 1 1 auto;
    display: flex;
    flex-direction: row;
    border: 1px solid #555;
    border-radius: 4px;
    min-height: 2rem;
    align-items: end;
    margin: 0.5rem;
    width: calc(100% - 1rem);

    span {
      flex: 1 1 auto;
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

  #chat-replying-to {
    padding: 0.5rem 0.75rem 0;
    font-size: 12px;
    color: #aaa;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    position: relative;
  }

  #chat-replying-to-name {
    font-weight: bold;
    font-size: 14px;
  }

  #chat-replying-to-message {
    border-top: 1px solid #555;
    padding-top: 0.25rem;
    padding-left: 0.5rem;
  }

  #chat-replying-to-cancel {
    cursor: pointer;
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    width: 16px;
    height: 16px;

    img {
      filter: invert(1) brightness(0.5);
    }
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
    {#each chat_messages.values() as message (message.id)}
      <div use:scroll_to_bottom>
        {#if "type" in message}
          <em style="color: #aaa">{message.message}</em>
        {:else}
          <ChatMessageRow
            {message}
            {twitch_emotes}
            {seventv_emotes}
            {is_admin}
            {delete_message}
            logged_in_user={name}
            logged_in_user_id={user_id}
            {reply_to_message}
            replying_to_message={message.reply_to_id ? ((chat_messages.get(message.reply_to_id) as ChatMessage) ?? null) : null}
            {scroll_to_bottom}
          />
        {/if}
      </div>
    {/each}
    {#if !chat_should_scroll_to_bottom}
      <div id="scroll-to-bottom" onclick={force_scroll_to_bottom}>More messages below</div>
    {/if}
  </div>
  <div id="chat-input">
    {#if chat_replying_to}
      <div id="chat-replying-to">
        <span id="chat-replying-to-name">Replying to: @{chat_replying_to.name}</span>
        <div id="chat-replying-to-message">{chat_replying_to.message}</div>
        <div id="chat-replying-to-cancel">
          <img src={cancel_icon} alt="Cancel" onclick={cancel_reply} />
        </div>
      </div>
    {/if}
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
