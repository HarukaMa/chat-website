<script lang="ts">
  import type { SevenTVEmotes, TwitchEmotes } from "../../worker"
  import emote_icon from "$lib/assets/fa-face-smile.svg"
  import { computePosition, flip, shift, offset } from "@floating-ui/dom"
  import ChatMessageEmote from "$lib/components/ChatMessageEmote.svelte"
  import { lower_cmp } from "$lib/utils"

  type EmotePanelProps = {
    twitch_emotes: TwitchEmotes | null
    seventv_emotes: SevenTVEmotes | null
    insert_emote: (emote: string) => void
  }

  type PanelTwitchEmotes = Map<string, string[]>
  type PanelSevenTVEmotes = Map<string, string[]>

  let { twitch_emotes: twitch_emotes_map, seventv_emotes: seventv_emotes_map, insert_emote }: EmotePanelProps = $props()

  let twitch_emotes: PanelTwitchEmotes = $state(new Map())
  let seventv_emotes: PanelSevenTVEmotes = $state(new Map())

  if (twitch_emotes_map !== null) {
    for (const [name, emote] of twitch_emotes_map) {
      if (!twitch_emotes.has(emote.channel)) {
        twitch_emotes.set(emote.channel, [])
      }
      twitch_emotes.get(emote.channel)!.push(name)
    }
    for (const emotes of twitch_emotes) {
      emotes[1].sort(lower_cmp)
    }
  }
  if (seventv_emotes_map !== null) {
    for (const [name, emote] of seventv_emotes_map) {
      if (!seventv_emotes.has(emote.set_name)) {
        seventv_emotes.set(emote.set_name, [])
      }
      seventv_emotes.get(emote.set_name)!.push(name)
    }
    for (const emotes of seventv_emotes) {
      emotes[1].sort(lower_cmp)
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

  let twitch_button: HTMLButtonElement | undefined = $state(undefined)
  let seventv_button: HTMLButtonElement | undefined = $state(undefined)

  let current_tab = $state("twitch")
  let emote_search_value = $state("")
  let filtered_emotes: string[] = $state([])

  function switch_tab(event: MouseEvent) {
    const tab = event.currentTarget === twitch_button ? "twitch" : "seventv"
    current_tab = tab
    if (tab === "twitch") {
      twitch_button!.classList.add("active")
      seventv_button!.classList.remove("active")
    } else {
      twitch_button!.classList.remove("active")
      seventv_button!.classList.add("active")
    }
  }

  function search_emotes(_event: Event) {
    emote_search_value = (_event.target as HTMLInputElement).value
    filtered_emotes = []
    if (emote_search_value === "") return
    for (const emotes of twitch_emotes.values()) {
      filtered_emotes.push(...emotes.filter((emote) => emote.toLowerCase().includes(emote_search_value.toLowerCase())))
    }
    for (const emotes of seventv_emotes.values()) {
      filtered_emotes.push(...emotes.filter((emote) => emote.toLowerCase().includes(emote_search_value.toLowerCase())))
    }
    filtered_emotes.sort(lower_cmp)
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
    width: 300px;
    height: 500px;
    background-color: #000000c0;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    overflow-y: scroll;
    color: white;
  }

  .emote-search-input {
    width: 100%;
    background-color: black;
    border: 1px solid #555;
    color: #ccc;
    padding: 0.25rem;

    &:focus {
      outline: none;
    }
  }

  .emote-panel-tabs {
    display: flex;
    gap: 0.25rem;
  }

  .emote-panel-tab {
    all: unset;
    flex-grow: 1;
    text-align: center;
    font-size: 14px;
    padding: 0.25rem;
    background-color: #111;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;

    &.active {
      background-color: #333;
    }
  }

  .emote-panel-list-page {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    row-gap: 0.5rem;
    justify-content: center;
  }

  .emote-panel-list-header {
    width: 100%;
    background-color: #333;
    padding: 0.25rem;
    text-align: center;
  }

  .emote-panel-list-emote {
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;

    img {
      height: 32px;
      object-fit: contain;
    }
  }
</style>

<div class="emote-button" bind:this={emote_button} onclick={toggle_emote_panel}>
  <img src={emote_icon} alt="emotes" />
</div>
<div class="emote-panel" bind:this={emote_panel}>
  <input type="search" class="emote-search-input" bind:value={emote_search_value} placeholder="Search emotes" oninput={search_emotes} />
  <div class="emote-panel-tabs" style:display={emote_search_value === "" ? "" : "none"}>
    <button class="emote-panel-tab active" bind:this={twitch_button} onclick={switch_tab}>Twitch</button>
    <button class="emote-panel-tab" bind:this={seventv_button} onclick={switch_tab}>7TV</button>
  </div>
  <div class="emote-panel-list">
    <div class="emote-panel-list-page" style:display={emote_search_value === "" ? "none" : ""}>
      {#each filtered_emotes as name (name)}
        <div class="emote-panel-list-emote" onclick={() => insert_emote(name)}>
          <ChatMessageEmote {name} zero_widths={[]} twitch_emotes={twitch_emotes_map} seventv_emotes={seventv_emotes_map} />
        </div>
      {/each}
    </div>
    <div class="emote-panel-list-page" style:display={emote_search_value === "" && current_tab === "twitch" ? "" : "none"}>
      {#each twitch_emotes as [channel, emotes] (channel)}
        <div class="emote-panel-list-header">
          {channel}
        </div>
        {#each emotes as name (name)}
          <div class="emote-panel-list-emote" onclick={() => insert_emote(name)}>
            <ChatMessageEmote {name} zero_widths={[]} twitch_emotes={twitch_emotes_map} seventv_emotes={seventv_emotes_map} />
          </div>
        {/each}
      {/each}
    </div>
    <div class="emote-panel-list-page" style:display={emote_search_value === "" && current_tab === "seventv" ? "" : "none"}>
      {#each seventv_emotes as [set_name, emotes] (set_name)}
        <div class="emote-panel-list-header">
          {set_name}
        </div>
        {#each emotes as name (name)}
          <div class="emote-panel-list-emote" onclick={() => insert_emote(name)}>
            <ChatMessageEmote {name} zero_widths={[]} twitch_emotes={twitch_emotes_map} seventv_emotes={seventv_emotes_map} />
          </div>
        {/each}
      {/each}
    </div>
  </div>
</div>
