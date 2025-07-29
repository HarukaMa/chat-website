<script lang="ts">
  import { env } from "$env/dynamic/public"
  import { browser } from "$app/environment"
  import twitch_logo from "$lib/assets/glitch_flat_black-ops.svg"

  let { data } = $props()
  let session = $state(data.session)
  let twitch_logged_in = $state(data.twitch_logged_in)
  let name = $state(data.name)
  let name_color = $state(data.name_color)
  let twitch_emotes = $state(data.twitch_emotes)
  let seventv_emotes = $state(data.seventv_emotes)

  if (!session && browser) {
    const cookies = document.cookie
    let has_session = false
    for (const cookie of cookies.split(";")) {
      const [key, value] = cookie.trim().split("=")
      if (key === "swarm_fm_player_session") {
        has_session = true
        session = value
      }
    }
    if (!has_session) {
      const uuid = self.crypto.randomUUID()
      document.cookie = `swarm_fm_player_session=${uuid}; domain=${env.PUBLIC_SESSION_DOMAIN}; expires=Fri, 31 Dec 9999 23:59:59 GMT; secure; samesite=lax`
      session = uuid
    }
  }

  const twitch_login_url = `https://id.twitch.tv/oauth2/authorize?client_id=${env.PUBLIC_TWITCH_CLIENT_ID}&redirect_uri=https://${env.PUBLIC_SESSION_DOMAIN}/twitch_auth&response_type=code&scope=`
</script>

<style lang="scss">
  #header {
    display: flex;
    height: 3rem;
    width: 100%;
    background-color: aquamarine;
    justify-content: end;
    align-items: center;
    gap: 0.5rem;
    padding: 0 1rem;
  }
  #twitch-login {
    all: unset;
    display: flex;
    padding: 0.25rem 0.5rem;
    gap: 0.25rem;
    background-color: #9146ff;
    border-radius: 4px;
    align-items: center;
    cursor: pointer;
    color: white;

    img {
      height: 1.5rem;
      width: 1.5rem;
    }
  }
</style>

<svelte:head>
  <title>Swarm FM Player</title>
</svelte:head>

<div id="header">
  {#if !twitch_logged_in}
    <a id="twitch-login" href={twitch_login_url}>
      <img src={twitch_logo} alt="Twitch logo" />
      Login with Twitch
    </a>
  {:else}
    Logged in as <span style="color: {name_color}">{name}</span>
  {/if}
</div>
{session}
