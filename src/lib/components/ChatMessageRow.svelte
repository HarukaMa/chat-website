<script lang="ts">
  import type { SevenTVEmotes, TwitchEmotes } from "../../worker"
  import copy_icon from "$lib/assets/fa-copy.svg"
  import ChatMessageEmote from "$lib/components/ChatMessageEmote.svelte"
  import ChatBadge from "$lib/components/ChatBadge.svelte"
  import { browser } from "$app/environment"

  type ChatMessageProps = {
    id: number
    name: string
    name_color: string
    message: string
    timestamp_ms: number
    roles: string[] // Add roles prop
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
    is_admin: boolean
    delete_message: (id: number) => Promise<void>
    logged_in_user: string | null
    logged_in_user_id?: string | null
  }

  enum EmoteType {
    NORMAL,
    ZERO_WIDTH,
  }

  let {
    id,
    name,
    name_color,
    message,
    timestamp_ms,
    roles, // Add roles to destructuring
    twitch_emotes,
    seventv_emotes,
    is_admin,
    delete_message,
    logged_in_user,
    logged_in_user_id,
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

  const words = message.split(" ")
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

  async function delete_this_message() {
    await delete_message(id)
  }

  function copy_message() {
    navigator.clipboard.writeText(message)
  }
</script>

<style>
  .chat-message {
    position: relative;
    line-break: normal;
    overflow-wrap: anywhere;
    padding: 0.25rem;

    &:hover .chat-message-copy {
      display: block;
    }
  }

  .chat-mentioned {
    background-color: #573;
  }

  .chat-delete {
    cursor: pointer;
  }

  .chat-message-copy {
    display: none;
    height: 16px;
    width: 16px;
    cursor: pointer;
    position: absolute;
    right: 0.25rem;
    top: 0.25rem;

    img {
      filter: invert(1);
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
</style>

<div class="chat-message" class:chat-mentioned={is_mentioned}>
  {#if is_admin}
    <span class="chat-delete" style="color: #aaa; font-size: 12px" onclick={delete_this_message}>⨯</span>
  {/if}
  <span style="color: #aaa; font-size: 12px">{format_timestamp(timestamp_ms)}</span>
  <span class="chat-name-container">
    {#each roles as role (role)}
      <ChatBadge {role} />
    {/each}
    <span style="color: {name_color}">{name}</span>:
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
  <div class="chat-message-copy" onclick={copy_message}>
    <img src={copy_icon} alt="Copy message" />
  </div>
</div>
