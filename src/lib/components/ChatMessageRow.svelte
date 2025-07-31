<script lang="ts">
  import type { SevenTVEmoteSets, TwitchEmotes } from "../../worker"
  import ChatMessageEmote from "$lib/components/ChatMessageEmote.svelte"

  type ChatMessageProps = {
    name: string
    name_color: string
    message: string
    timestamp_ms: number
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmoteSets | null
  }

  enum EmoteType {
    NORMAL,
    ZERO_WIDTH,
  }

  let { name, name_color, message, timestamp_ms, twitch_emotes, seventv_emotes }: ChatMessageProps = $props()

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
      let emote_data = seventv_emotes.vedal_emotes.emotes.get(name)
      if (emote_data !== undefined) {
        if (emote_data.zero_width) {
          return EmoteType.ZERO_WIDTH
        }
        return EmoteType.NORMAL
      }
      emote_data = seventv_emotes.global_emotes.emotes.get(name)
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
    } else if (emote_type === EmoteType.NORMAL) {
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
    } else {
      throw new Error("encountered unexpected zero width emote when parsing message")
    }
  }
  if (current_segment.length > 0) {
    message_parts.push(current_segment.join(" "))
  }
  console.log(message_parts)
</script>

<style>
  .chat-message {
    line-break: normal;
    overflow-wrap: normal;
  }
  .before-message {
    margin-right: 0.2rem;
  }
</style>

<div class="chat-message">
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
