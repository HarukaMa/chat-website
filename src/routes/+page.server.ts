import type { PageServerLoad } from "./$types"

export const load: PageServerLoad = async ({ platform, cookies }) => {
  const session = cookies.get("swarm_fm_player_session")
  let twitch_logged_in = false
  let name: string | null = null
  let name_color: string | null = null
  if (session && platform) {
    const id = platform.env.DO.idFromName("chat")
    const stub = platform.env.DO.get(id)
    const user = await stub.twitch_session_check(session)
    if (user) {
      twitch_logged_in = true
      name = user.name
      name_color = user.name_color
    }
  }
  return {
    session: cookies.get("swarm_fm_player_session"),
    twitch_logged_in,
    name,
    name_color,
  }
}
