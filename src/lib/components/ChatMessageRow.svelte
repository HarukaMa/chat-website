<script lang="ts">
  import type { ChatMessage, SevenTVEmotes, TwitchEmotes } from "../../worker"
  import copy_icon from "$lib/assets/fa-copy.svg"
  import reply_icon from "$lib/assets/fa-reply.svg"
  import ChatMessageEmote from "$lib/components/ChatMessageEmote.svelte"
  import ChatBadge from "$lib/components/ChatBadge.svelte"
  import { browser } from "$app/environment"

  type ChatMessageProps = {
    message: ChatMessage
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
    is_admin: boolean
    delete_message: (id: number) => Promise<void>
    logged_in_user: string | null
    logged_in_user_id?: string | null
    replying_to_message: ChatMessage | null
    reply_to_message: (message: ChatMessage) => Promise<void>
  }

  enum EmoteType {
    NORMAL,
    ZERO_WIDTH,
  }

  let {
    message,
    twitch_emotes,
    seventv_emotes,
    is_admin,
    delete_message,
    logged_in_user,
    logged_in_user_id,
    reply_to_message,
    replying_to_message,
  }: ChatMessageProps = $props()

  function format_timestamp(timestamp_ms: number) {
    let show_ms = false
    if (browser) {
      show_ms = localStorage.getItem("show_ms") === "true"
    }
    const date = new Date(timestamp_ms)
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const seconds = date.getSeconds().toString().padStart(2, "0")
    if (!show_ms) {
      return `${hours}:${minutes}:${seconds}`
    }
    const milliseconds = date.getMilliseconds().toString().padStart(3, "0")
    return `${hours}:${minutes}:${seconds}.${milliseconds}`
  }
  function is_link(text: string): boolean {
    return text.startsWith("http://") || text.startsWith("https://")
  }

  function is_emote(name: string): EmoteType | null {
    if (seventv_emotes) {
      const emote_data = seventv_emotes.get(name)
      if (emote_data !== undefined) {
        if (emote_data.zero_width) {
          return EmoteType.ZERO_WIDTH
        }
        return EmoteType.NORMAL
      }
    }
    if (twitch_emotes) {
      const emote_data = twitch_emotes.get(name)
      if (emote_data !== undefined) {
        return EmoteType.NORMAL
      }
    }
    return null
  }

  let is_mentioned = $state(false)

  const message_parts: (string | { emote: string; zero_widths: string[] } | { link: string })[] = []

  const words = message.message.split(" ")
  const current_segment = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const emote_type = is_emote(word)

    if (word.replace(/[:;.,!?]+$/, "").replace(/^@+/, "") === logged_in_user) {
      is_mentioned = true
    }

    if (is_link(word)) {
      // Handle links
      if (current_segment.length > 0) {
        message_parts.push(current_segment.join(" "))
        current_segment.length = 0
      }
      message_parts.push({ link: word })
    } else if (emote_type === null) {
      current_segment.push(word)
    } else {
      if (current_segment.length > 0) {
        message_parts.push(current_segment.join(" "))
        current_segment.length = 0
      }
      const zero_widths = []
      while (i + 1 < words.length) {
        const next_word = words[i + 1]
        const next_emote_type = is_emote(next_word)
        if (next_emote_type === EmoteType.ZERO_WIDTH) {
          zero_widths.push(next_word)
          i++
        } else {
          break
        }
      }
      message_parts.push({ emote: word, zero_widths })
    }
  }
  if (current_segment.length > 0) {
    message_parts.push(current_segment.join(" "))
  }

  if (replying_to_message?.user_id === logged_in_user_id) {
    is_mentioned = true
  }

  async function delete_this_message() {
    await delete_message(message.id)
  }

  function copy_message() {
    navigator.clipboard.writeText(message.message)
  }

  function reply_message() {
    reply_to_message(message)
  }

  async function color_adjustment() {
    let color = message.name_color
    if (message.name_color === "") {
      const default_colors = [
        "#ff0000",
        "#0000ff",
        "#008000",
        "#b22222",
        "#ff7f50",
        "#9acd32",
        "#ff4500",
        "#2e8b57",
        "#daa520",
        "#d2691e",
        "#5f9ea0",
        "#1e90ff",
        "#ff69b4",
        "#8a2be2",
        "#00ff7f",
      ]
      const name_hash = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.name))
      color = default_colors[Math.abs(new Uint8Array(name_hash)[0]) % default_colors.length]
    }
    const r = parseInt(color.substring(1, 3), 16) / 255
    const g = parseInt(color.substring(3, 5), 16) / 255
    const b = parseInt(color.substring(5, 7), 16) / 255
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (y < 0.4) {
      // convert rgb to hsl
      const v = Math.max(r, g, b)
      const x_min = Math.min(r, g, b)
      const c = v - x_min
      const l = v - c / 2
      let h: number
      if (c === 0) {
        h = 0
      } else if (v === r) {
        h = (g - b) / c
      } else if (v === g) {
        h = 2 + (b - r) / c
      } else {
        h = 4 + (r - g) / c
      }
      h = Math.round(h * 60)
      if (h < 0) {
        h += 360
      }
      if (h >= 360) {
        h -= 360
      }
      const s = c === 0 ? 0 : c / (1 - Math.abs(2 * l - 1))
      // arbitrary numbers
      const adjusted_l = l + (0.4 - y) / 1.5
      return `hsl(${h}, ${s * 100}%, ${adjusted_l * 100}%)`
    }
    return color
  }
</script>

<style>
  .chat-message {
    position: relative;
    line-break: normal;
    overflow-wrap: anywhere;
    padding: 0.25rem;

    &:hover .chat-message-ops {
      display: flex;
    }
  }

  .chat-mentioned {
    background-color: #442;
  }

  .chat-delete {
    cursor: pointer;
  }

  .chat-message-ops {
    display: none;
    position: absolute;
    right: 0.25rem;
    top: 0.25rem;
    gap: 0.25rem;
    flex-direction: row-reverse;

    img {
      filter: invert(1);
    }

    > div {
      cursor: pointer;
      height: 16px;
      width: 16px;
    }
  }

  .chat-link {
    color: #4a9eff;
    text-decoration: underline;
    cursor: pointer;
    padding: 0.25rem;
  }

  .chat-link:visited {
    color: #a74aff;
  }

  .chat-link:hover {
    color: #6bb3ff;
  }

  .chat-name-container {
    display: inline-flex;
    align-items: center;
  }

  .chat-delete {
    color: #aaa;
    font-size: 12px;
  }

  .chat-replying-to {
    font-size: 12px;
    color: #ccc;
    padding-left: 0.5rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat-timestamp {
    color: #aaa;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
</style>

<div class="chat-message" class:chat-mentioned={is_mentioned}>
  {#if replying_to_message}
    <div class="chat-replying-to">
      Replying to: @{replying_to_message.name}: {replying_to_message.message}
    </div>
  {/if}
  {#if is_admin}
    <span class="chat-delete" onclick={delete_this_message}>⨯</span>
  {/if}
  <span class="chat-timestamp">{format_timestamp(message.timestamp_ms)}</span>
  {#each message.roles as role (role)}
    <ChatBadge {role} />
  {/each}
  <span class="chat-name-container">
    {#await color_adjustment() then color}
      <span style="color: {color}">{message.name}</span>:
    {/await}
  </span>
  {#each message_parts as part, index (index)}
    {#if typeof part === "string"}
      <span>{part}</span>
    {:else if "emote" in part}
      <ChatMessageEmote name={part.emote} zero_widths={part.zero_widths} {twitch_emotes} {seventv_emotes} />
    {:else if "link" in part}
      <a class="chat-link" href={part.link} target="_blank" rel="noopener noreferrer">{part.link}</a>
    {/if}
  {/each}
  <div class="chat-message-ops">
    <div class="chat-message-copy" onclick={copy_message}>
      <img src={copy_icon} alt="Copy message" />
    </div>
    <div class="chat-message-reply" onclick={reply_message}>
      <img src={reply_icon} alt="Reply message" />
    </div>
  </div>
</div>
