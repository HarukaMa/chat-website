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
    bot: { icon: "🤖", color: "#808080", title: "Bot" }
  }

  let badge = $derived(badges[role] || { icon: "🏷️", color: "#666666", title: role })
</script>

<style>
  .chat-badge {
    display: inline-block;
    font-size: 0.75rem;
    padding: 0.1rem 0.25rem;
    margin: 0 0.15rem;
    border-radius: 0.25rem;
    background-color: var(--badge-color);
    color: white;
    font-weight: bold;
    vertical-align: middle;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
</style>

<span 
  class="chat-badge" 
  style="--badge-color: {badge.color}" 
  title={badge.title}
>
  {badge.icon}
</span>