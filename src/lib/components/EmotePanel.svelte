<script lang="ts">
  import type { SevenTVEmote, SevenTVEmotes, TwitchEmote, TwitchEmotes } from "../../worker"
  import emote_icon from "$lib/assets/fa-face-smile.svg"
  import { computePosition, flip, shift, offset } from "@floating-ui/dom"
  import { onMount, onDestroy } from "svelte"

  type EmotePanelProps = {
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
  }

  type PanelTwitchEmotes = Map<string, [string, TwitchEmote][]>
  type PanelSevenTVEmotes = Map<string, [string, SevenTVEmote][]>

  let { twitch_emotes: twitch_emotes_map, seventv_emotes: seventv_emotes_map }: EmotePanelProps = $props()

  let twitch_emotes: PanelTwitchEmotes = $state(new Map())
  let seventv_emotes: PanelSevenTVEmotes = $state(new Map())

  if (twitch_emotes_map !== null) {
    for (const [name, emote] of twitch_emotes_map) {
      if (!twitch_emotes.has(emote.channel)) {
        twitch_emotes.set(emote.channel, [])
      }
      twitch_emotes.get(emote.channel)!.push([name, emote])
    }
  }
  if (seventv_emotes_map !== null) {
    for (const [name, emote] of seventv_emotes_map) {
      const key = `${emote.owner} - ${emote.set_name}`
      if (!seventv_emotes.has(key)) {
        seventv_emotes.set(key, [])
      }
      seventv_emotes.get(key)!.push([name, emote])
    }
  }

  let emote_panel: HTMLDivElement
  let emote_button: HTMLDivElement

  let emote_panel_open = $state(false)

  function toggle_emote_panel() {
    emote_panel_open = !emote_panel_open
    if (emote_panel_open) {
      emote_panel.style.display = "flex"
      computePosition(emote_button, emote_panel, {
        strategy: "fixed",
        placement: "top-start",
        middleware: [offset(10), flip(), shift()],
      }).then(({ x, y }) => {
        emote_panel.style.left = `${x}px`
        emote_panel.style.top = `${y}px`
      })
      document.addEventListener("click", handle_click_outside)
    } else {
      document.removeEventListener("click", handle_click_outside)
      emote_panel.style.display = "none"
    }
  }

  function handle_click_outside(event: MouseEvent) {
    console.log("event target", event.target)
    if (
      emote_panel_open &&
      emote_panel &&
      emote_button &&
      !emote_panel.contains(event.target as Node) &&
      !emote_button.contains(event.target as Node)
    ) {
      emote_panel_open = false
      emote_panel.style.display = "none"
      document.removeEventListener("click", handle_click_outside)
    }
  }
</script>

<style lang="scss">
  .emote-button {
    cursor: pointer;

    img {
      width: 16px;
      height: 16px;
      filter: invert(1) brightness(0.5);
    }
  }

  .emote-panel {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 350px;
    height: 500px;
    background-color: #000000c0;
  }
</style>

<div class="emote-button" bind:this={emote_button} onclick={toggle_emote_panel}>
  <img src={emote_icon} alt="emotes" />
</div>
<div class="emote-panel" bind:this={emote_panel}> </div>
