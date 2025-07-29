<script lang="ts">
  import { env } from "$env/dynamic/public"
  import { browser } from "$app/environment"

  let { data } = $props()
  let session = $state(data.session)

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
</script>

<style lang="scss">
  #header {
    height: 40px;
    width: 100%;
    background-color: aquamarine;
  }
</style>

<svelte:head>
  <title>Swarm FM Player</title>
</svelte:head>

<div id="header"></div>
{session}
