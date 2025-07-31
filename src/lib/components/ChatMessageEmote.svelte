<script lang="ts">
  import type { SevenTVEmoteSets, TwitchEmotes } from "../../worker"

  type ChatMessageEmoteProps = {
    name: string
    zero_widths: string[]
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmoteSets | null
  }

  let { name, twitch_emotes, seventv_emotes, zero_widths }: ChatMessageEmoteProps = $props()

  function get_emote_urls(name: string): { url_1x: string; url_2x: string; url_3x: string | null; url_4x: string } {
    if (seventv_emotes) {
      // channel emotes
      let emote_data = seventv_emotes.vedal_emotes.emotes.get(name)
      if (emote_data !== undefined) {
        const url_1x = emote_data.url + "/1x.avif"
        const url_2x = emote_data.url + "/2x.avif"
        const url_3x = emote_data.url + "/3x.avif"
        const url_4x = emote_data.url + "/4x.avif"
        return { url_1x, url_2x, url_3x, url_4x }
      }
      // global emotes
      emote_data = seventv_emotes.global_emotes.emotes.get(name)
      if (emote_data !== undefined) {
        const url_1x = emote_data.url + "/1x.avif"
        const url_2x = emote_data.url + "/2x.avif"
        const url_3x = emote_data.url + "/3x.avif"
        const url_4x = emote_data.url + "/4x.avif"
        return { url_1x, url_2x, url_3x, url_4x }
      }
    }
    if (twitch_emotes) {
      const emote_data = twitch_emotes.get(name)
      if (emote_data !== undefined) {
        // there should be no missing urls here
        const url_1x = emote_data.images.url_1x || ""
        const url_2x = emote_data.images.url_2x || ""
        const url_4x = emote_data.images.url_4x || ""
        return { url_1x, url_2x, url_3x: null, url_4x }
      }
    }
    return { url_1x: "", url_2x: "", url_3x: null, url_4x: "" }
  }

  const emote = { name: name, ...get_emote_urls(name) }
  const zw_emptes = zero_widths.map((zw) => {
    return { name: zw, ...get_emote_urls(zw) }
  })
</script>

<style lang="scss">
  .chat-message-emote {
    display: inline-block;
    position: relative;
    margin: 0 0.25rem;

    &:nth-child(3) {
      margin-left: 0;
    }

    &:last-child {
      margin-right: 0;
    }
  }

  .emote {
    object-fit: contain;
    height: 32px;
  }
</style>

{#snippet emote_snippet(url_1x: string, url_2x: string, url_3x: string | null, url_4x: string, name: string)}
  {#if url_3x}
    <img class="emote" src={url_1x} srcset="{url_1x} 1x, {url_2x} 2x, {url_3x} 3x, {url_4x} 4x" alt={name} />
  {:else}
    <img class="emote" src={url_1x} srcset="{url_1x} 1x, {url_2x} 2x, {url_4x} 3x, {url_4x} 4x}" alt={name} />
  {/if}
{/snippet}

<div class="chat-message-emote">
  {@render emote_snippet(emote.url_1x, emote.url_2x, emote.url_3x, emote.url_4x, emote.name)}
  {#each zw_emptes as zw_emote (zw_emote.name)}
    {@render emote_snippet(zw_emote.url_1x, zw_emote.url_2x, zw_emote.url_3x, zw_emote.url_4x, zw_emote.name)}
  {/each}
</div>
