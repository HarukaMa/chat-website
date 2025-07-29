import type { PageServerLoad } from "./$types"

export const load: PageServerLoad = async ({ cookies }) => {
  return {
    session: cookies.get("swarm_fm_player_session"),
  }
}
