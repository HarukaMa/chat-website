<script lang="ts">
    import { env } from "$env/dynamic/public"

    const isProd = env.PUBLIC_SESSION_DOMAIN === "player.sw.arm.fm" ? true : false
</script>

{#if isProd === false}
    <div id="instance-banner">
        You are currently on a dev instance.
        You may see in-development features, and the chat is separate from the prod.
        Any bugs should be reported on the Discord thread.
    </div>
{/if}

<style>
    #instance-banner {
        background-color: orange;
        text-align: center;
        color: black;
        padding: 3px;
    }
</style>