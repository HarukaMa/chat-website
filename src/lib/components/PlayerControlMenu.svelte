<script lang="ts">
  import { computePosition, flip, shift, offset } from "@floating-ui/dom"

  type PlayerControlMenuProps = {
    control_name: string
    control_options: string[]
    selected_index: number
    select: (index: number) => void
  }

  let { control_name, control_options, selected_index, select }: PlayerControlMenuProps = $props()

  let button: HTMLButtonElement
  let menu: HTMLMenuElement
  let menu_on = $state(false)

  function toggle_menu() {
    menu_on = !menu_on
    menu.style.display = menu_on ? "flex" : "none"
    if (menu_on) {
      computePosition(button, menu, {
        placement: "top",
        middleware: [flip(), shift(), offset(20)],
      }).then(({ x, y }) => {
        menu.style.left = `${x}px`
        menu.style.top = `${y}px`
      })
    }
  }

  function menu_select(index: number) {
    select(index)
    toggle_menu()
  }
</script>

<style lang="scss">
  .control-button {
    all: unset;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;

    &:hover {
      background-color: #555;
    }
  }

  menu {
    position: absolute;
    top: 0;
    left: 0;
    background-color: #333c;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 4px;
    align-items: center;
    z-index: 100;
  }
</style>

<button class="control-button" bind:this={button} onclick={toggle_menu}>{control_name}: {control_options[selected_index]}</button>
<menu style:display={menu_on ? "flex" : "none"} bind:this={menu}>
  {#each control_options as option, index (option)}
    <button class="control-button" onclick={() => menu_select(index)}>{option}</button>
  {/each}
</menu>
