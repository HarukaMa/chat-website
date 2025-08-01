<script lang="ts">
  import type { SevenTVEmotes, TwitchEmotes } from "../../worker"
  import ChatMessageEmote from "$lib/components/ChatMessageEmote.svelte"

  type ChatMessageProps = {
    id: number
    name: string
    name_color: string
    message: string
    timestamp_ms: number
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
    is_admin: boolean
    delete_message: (id: number) => Promise<void>
    logged_in_user: string | null
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
    twitch_emotes,
    seventv_emotes,
    is_admin,
    delete_message,
    logged_in_user,
  }: ChatMessageProps = $props()

  function format_timestamp(timestamp_ms: number) {
    const date = new Date(timestamp_ms)
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const seconds = date.getSeconds().toString().padStart(2, "0")
    const milliseconds = date.getMilliseconds().toString().padStart(3, "0")
    return `${hours}:${minutes}:${seconds}.${milliseconds}`
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

  const message_parts: (string | { emote: string; zero_widths: string[] })[] = []

  const words = message.split(" ")
  const current_segment = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const emote_type = is_emote(word)
    if (emote_type === null) {
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
        if (next_emote_type === null || next_emote_type === EmoteType.NORMAL) {
          break
        } else {
          zero_widths.push(next_word)
          i++
        }
      }
      message_parts.push({ emote: word, zero_widths })
    }
  }
  if (current_segment.length > 0) {
    message_parts.push(current_segment.join(" "))
  }

  let is_mentioned = $state(false)

  if (message.indexOf(logged_in_user || "") !== -1) {
    is_mentioned = true
  }

  async function delete_this_message() {
    await delete_message(id)
  }
</script>

<style>
  .chat-message {
    line-break: normal;
    overflow-wrap: anywhere;
    padding: 0.25rem;
  }

  .chat-mentioned {
    background-color: #573;
  }

  .chat-delete {
    cursor: pointer;
  }
</style>

<div class="chat-message" class:chat-mentioned={is_mentioned}>
  {#if is_admin}
    <span class="chat-delete" style="color: #aaa; font-size: 12px" onclick={delete_this_message}>⨯</span>
  {/if}
  <span style="color: #aaa; font-size: 12px">{format_timestamp(timestamp_ms)}</span>
  <!-- no line break - can't have whitespace here -->
  <span style="color: {name_color}">{name}</span>:
  {#each message_parts as part}
    {#if typeof part === "string"}
      <span>{part}</span>
    {:else}
      <ChatMessageEmote name={part.emote} zero_widths={part.zero_widths} {twitch_emotes} {seventv_emotes} />
    {/if}
  {/each}
</div>
