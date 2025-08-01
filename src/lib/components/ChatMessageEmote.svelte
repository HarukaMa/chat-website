<script lang="ts">
  import type { SevenTVEmotes, TwitchEmotes } from "../../worker"
  import { computePosition, flip, shift, offset } from "@floating-ui/dom"
  import type { Action } from "svelte/action"
  import type { Attachment } from "svelte/attachments"

  type ChatMessageEmoteProps = {
    name: string
    zero_widths: string[]
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
  }

  let { name, twitch_emotes, seventv_emotes, zero_widths }: ChatMessageEmoteProps = $props()

  let root_element: HTMLDivElement
  let popup_element: HTMLDivElement

  function get_emote_data(name: string): {
    url_1x: string
    url_2x: string
    url_3x: string
    url_4x: string
    width: number
    set_name: string
    owner: string
  } {
    if (seventv_emotes) {
      let emote_data = seventv_emotes.get(name)
      if (emote_data !== undefined) {
        const url_1x = emote_data.url + "/1x.avif"
        const url_2x = emote_data.url + "/2x.avif"
        const url_3x = emote_data.url + "/3x.avif"
        const url_4x = emote_data.url + "/4x.avif"
        return { url_1x, url_2x, url_3x, url_4x, width: emote_data.width, set_name: emote_data.set_name, owner: emote_data.owner }
      }
    }
    if (twitch_emotes) {
      const emote_data = twitch_emotes.get(name)
      if (emote_data !== undefined) {
        // there should be no missing urls here
        const url_2x = emote_data.images.url_2x || ""
        const url_4x = emote_data.images.url_4x || ""
        return { url_1x: url_2x, url_2x: url_4x, url_3x: url_4x, url_4x, width: 32, set_name: "vedal987 Twitch Emotes", owner: "" }
      }
    }
    return { url_1x: "", url_2x: "", url_3x: "", url_4x: "", width: 0, set_name: "", owner: "" }
  }

  const emote = { name: name, ...get_emote_data(name) }
  const zw_emotes = zero_widths.map((zw) => {
    return { name: zw, ...get_emote_data(zw) }
  })
  const max_width = Math.max(emote.width, ...zw_emotes.map((zw) => zw.width))

  function show_popup() {
    popup_element.style.display = "flex"
    computePosition(root_element, popup_element, {
      strategy: "fixed",
      placement: "bottom",
      middleware: [flip(), shift(), offset(4)],
    }).then(({ x, y }) => {
      Object.assign(popup_element.style, {
        left: `${x}px`,
        top: `${y}px`,
      })
    })
  }

  function hide_popup() {
    popup_element.style.display = "none"
  }
</script>

<style lang="scss">
  .chat-message-emote {
    display: inline-block;
    position: relative;
    margin: 0 0.25rem;
    height: 32px;
    top: 6px;

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

    &:not(:first-child) {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }
  }

  .popup {
    background-color: #000000c0;
    display: none;
    flex-direction: column;
    align-items: center;
    position: fixed;
    padding: 0.5rem;
    width: max-content;
    z-index: 1000;
    font-size: 14px;
    top: 0;
    left: 0;
  }

  .popup-emote-section {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .popup-emote {
    object-fit: contain;
    height: 128px;
  }

  .popup-zw {
    display: flex;
    gap: 0.5rem;
  }

  .popup-emote-name {
    margin-top: 0.25rem;
  }
</style>

{#snippet emote_snippet(url_1x: string, url_2x: string, url_3x: string, url_4x: string, name: string, width: number)}
  <img class="emote" src={url_1x} srcset="{url_1x} 1x, {url_2x} 2x, {url_3x} 3x, {url_4x} 4x" alt={name} style="width: {width}px" />
{/snippet}

{#snippet emote_popup_snippet(url_4x: string, name: string, width: number, set_name: string, owner: string)}
  <div class="popup-emote-section">
    <img class="popup-emote" src={url_4x} alt={name} style="width: {width * 4}px" />
    <div class="popup-emote-name">{name}</div>
    <div class="popup-emote-set-name">{set_name}</div>
    {#if owner !== ""}
      <div class="popup-emote-owner">By: {owner}</div>
    {/if}
  </div>
{/snippet}

<div class="chat-message-emote" bind:this={root_element} onmouseenter={show_popup} onmouseleave={hide_popup}>
  {@render emote_snippet(emote.url_1x, emote.url_2x, emote.url_3x, emote.url_4x, emote.name, max_width)}
  {#each zw_emotes as zw_emote (zw_emote.name)}
    {@render emote_snippet(zw_emote.url_1x, zw_emote.url_2x, zw_emote.url_3x, zw_emote.url_4x, zw_emote.name, max_width)}
  {/each}
</div>
<div class="popup" bind:this={popup_element}>
  {@render emote_popup_snippet(emote.url_4x, emote.name, max_width, emote.set_name, emote.owner)}
  <div class="popup-zw">
    {#each zw_emotes as zw_emote (zw_emote.name)}
      {@render emote_popup_snippet(zw_emote.url_4x, zw_emote.name, max_width, zw_emote.set_name, zw_emote.owner)}
    {/each}
  </div>
</div>
