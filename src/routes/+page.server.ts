import type { PageServerLoad } from "./$types"
import type { SevenTVEmoteSets, TwitchEmotes } from "../worker"

export const load: PageServerLoad = async ({ platform, cookies }) => {
  const session = cookies.get("swarm_fm_player_session")
  let twitch_logged_in = false
  let name: string | null = null
  let name_color: string | null = null
  let twitch_emotes: TwitchEmotes | null = null
  let seventv_emotes: SevenTVEmoteSets | null = null
  let admins: string[] = []

  if (session && platform) {
    const id = platform.env.DO.idFromName("chat")
    const stub = platform.env.DO.get(id)
    const user = await stub.twitch_session_check(session)
    if (user) {
      twitch_logged_in = true
      name = user.name
      name_color = user.name_color
    }
    twitch_emotes = await stub.twitch_emotes()
    seventv_emotes = await stub.seventv_emotes()
    admins = await stub.admin_list()
  }

  return {
    session: cookies.get("swarm_fm_player_session"),
    twitch_logged_in,
    name,
    name_color,
    twitch_emotes,
    seventv_emotes,
    admins,
  }
}
