<script lang="ts">
  type ChatBadgeProps = {
    role: string
  }

  let { role }: ChatBadgeProps = $props()

  // Define badge configurations
  const badges: Record<string, { icon: string; color: string; title: string }> = {
    mod: { icon: "🛡️", color: "#00ad03", title: "Moderator" },
    vip: { icon: "💎", color: "#e91e63", title: "VIP" },
    dev: { icon: "🔧", color: "#9146ff", title: "Developer" },
    art: { icon: "🎨", color: "#ff6b35", title: "Artist" },
    stream: { icon: "📺", color: "#ff0000", title: "Streamer" },
    bot: { icon: "🤖", color: "#808080", title: "Bot" },
  }

  let badge = $derived(badges[role] || null)
</script>

<style>
  .chat-badge {
    display: inline-flex;
    font-size: 0.75rem;
    border-radius: 0.25rem;
    color: white;
    font-weight: bold;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    align-items: center;
    justify-content: center;
    height: 20px;
    width: 20px;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
    top: -2px;
    position: relative;
  }

  :global(.chat-badge + .chat-badge) {
    margin-left: 0.25rem;
  }
</style>

{#if badge}
  <span class="chat-badge" style:background-color={badge.color} title={badge.title}>
    {badge.icon}
  </span>
{/if}
