<script lang="ts">
  // single use but the main page is already way too cluttered
  import users_icon from "$lib/assets/fa-users.svg"
  import { computePosition, flip, shift, offset } from "@floating-ui/dom"

  type ChatConnectionCountProps = {
    chat_session_counts: { session: number; logged_in: number; unique_logged_in: number }
  }

  let { chat_session_counts }: ChatConnectionCountProps = $props()

  let root_element: HTMLDivElement
  let popup_element: HTMLDivElement

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
  #chat-session-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    img {
      filter: invert(1);
      height: 1rem;
      width: 1rem;
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
</style>

<div id="chat-session-count" bind:this={root_element} onmouseenter={show_popup} onmouseleave={hide_popup}>
  <img src={users_icon} alt="Chat users" />
  {chat_session_counts.session}
</div>
<div class="popup" bind:this={popup_element}>
  {chat_session_counts.logged_in} logged in, {chat_session_counts.unique_logged_in} unique
</div>
