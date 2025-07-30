// noinspection SqlNoDataSourceInspection

import sveltekit_worker from "./_worker.js"

import { DurableObject, env } from "cloudflare:workers"

export type WSMessageType =
  | { type: "new_message"; name: string; name_color: string; message: string; timestamp_ms: number }
  | { type: "user_join"; name: string }
  | { type: "user_leave"; name: string }
  | { type: "user_list"; users?: string[] }
  | { type: "authenticate"; session: string }
  | { type: "send_message"; message: string }
  | { type: "message_history"; messages?: { name: string; name_color: string; message: string; timestamp_ms: number }[] }
  | { type: "error"; message: string }

export type Session = {
  authenticated: boolean
  name: string
  history_requested: boolean
}

export type TwitchTokenServer = {
  access_token: string
  expires_in: number
  token_type: string
}

export type TwitchToken = {
  access_token: string
  expires_at: number
}

export type TwitchUserTokenServer = {
  access_token: string
  expires_in: number
  refresh_token: string
  token_type: string
}

export type TwitchUserToken = {
  access_token: string
  expires_at: number
  refresh_token: string
}

export type TwitchUserServer = {
  data: { id: string; display_name: string }[]
}

export type TwitchUserColorServer = {
  data: { color: string }[]
}

export type TwitchEmote = {
  images: {
    url_1x: string | null
    url_2x: string | null
    url_4x: string | null
  }
  animated: boolean
}

export type TwitchEmotes = Map<string, TwitchEmote>

export type TwitchEmotesCache = {
  data: TwitchEmotes
  expires_at: number
}

export type TwitchEmotesServer = {
  data: {
    id: string
    name: string
    format: ["static" | "animated"]
    scale: ["1.0" | "2.0" | "3.0"]
    theme_mode: ["light" | "dark"]
    [key: string]: unknown
  }[]
  template: string
}

export type SevenTVEmoteSetServer = {
  data: {
    emoteSet: {
      emote_count: number
      flags: number
      owner: {
        display_name: string
      }
      name: string
      emotes: [
        {
          flags: number
          name: string
          data: {
            animated: boolean
            flags: number
            host: {
              url: string
            }
            owner: {
              username: string
            }
          }
        },
      ]
    }
  }
}

export type SevenTVEmoteSet = {
  name: string
  emote_count: number
  emotes: Map<
    string,
    {
      zero_width: boolean
      animated: boolean
      url: string
      owner: string
    }
  >
}

export type SevenTVEmoteSets = {
  global_emotes: SevenTVEmoteSet
  vedal_emotes: SevenTVEmoteSet
}

export type SevenTVEmoteSetCache = {
  data: SevenTVEmoteSets
  expires_at: number
}

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class DO extends DurableObject<Env> {
  sessions: Map<WebSocket, Session>

  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   *    `DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sessions = new Map()
    this.ctx.getWebSockets().forEach((ws) => {
      const session = ws.deserializeAttachment()
      this.sessions.set(ws, session)
    })
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("PING", "PONG"))

    this.init_database()
    this.ctx.storage.getAlarm().then((alarm_time) => {
      if (alarm_time === null) {
        this.ctx.storage.setAlarm(Date.now() + 3600 * 1000).catch((e) => console.error(e))
      }
    })
  }

  async fetch(_request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)
    this.ctx.acceptWebSocket(server)
    const session: Session = { authenticated: false, name: "", history_requested: false }
    server.serializeAttachment(session)
    this.sessions.set(server, session)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  private init_database() {
    const cursor = this.ctx.storage.sql.exec(`PRAGMA table_list`)
    if ([...cursor].find((t) => t.name === "messages")) {
      return
    }

    this.ctx.storage.sql.exec(
      `CREATE TABLE messages ( \
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL
      )`,
    )
    this.ctx.storage.sql.exec(`CREATE INDEX idx_timestamp ON messages (timestamp_ms DESC)`)
  }

  broadcast(message: WSMessageType) {
    this.ctx.getWebSockets().forEach((ws) => {
      ws.send(JSON.stringify(message))
    })
  }

  private get_user_list() {
    return Array.from(this.sessions.values(), (s) => s.name)
      .filter(Boolean)
      .sort()
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message instanceof ArrayBuffer) {
      ws.close(1003, "unsupported message type")
      return
    }

    const session = this.sessions.get(ws)
    if (session === undefined) {
      ws.close(1011, "invalid internal state")
      console.error("ERROR: session not found for existing connection")
      return
    }

    try {
      JSON.parse(message)
    } catch (e) {
      console.error("ERROR: invalid message: ", e)
      ws.close(1007, "invalid message content")
      return
    }
    const msg = JSON.parse(message) as WSMessageType
    switch (msg.type) {
      case "new_message":
      case "user_join":
      case "user_leave":
        ws.close(1007, "invalid message type")
        return

      case "user_list":
        ws.send(JSON.stringify({ type: "user_list", users: this.get_user_list() }))
        break

      case "authenticate": {
        if (!("session" in msg)) {
          ws.close(1007, "invalid message content")
          return
        }
        if (session.authenticated) {
          ws.send(JSON.stringify({ type: "error", message: "Already authenticated" }))
          return
        }
        let token = await this.ctx.storage.get<TwitchUserToken>(`twitch_user_token_${msg.session}`)
        if (token === undefined) {
          ws.send(JSON.stringify({ type: "error", message: "Twitch account not linked" }))
          return
        }
        if (token.expires_at < Date.now() / 1000) {
          try {
            token = await this.twitch_refresh_user_token(token)
            await this.ctx.storage.put(`twitch_user_token_${msg.session}`, token)
          } catch (e) {
            console.error("ERROR: failed to refresh token: ", e)
            ws.send(JSON.stringify({ type: "error", message: "Failed to authenticate with twitch" }))
            await this.ctx.storage.delete(`twitch_user_token_${msg.session}`)
            return
          }
        }
        session.name = await this.twitch_get_user_name(token, msg.session)
        session.authenticated = true
        ws.serializeAttachment(session)
        this.broadcast({ type: "user_join", name: session.name })
        break
      }

      case "send_message": {
        if (!session.authenticated) {
          ws.close(1007, "unauthenticated")
          return
        }
        if (!("message" in msg)) {
          ws.close(1007, "invalid message content")
          return
        }
        const now = Date.now()
        this.ctx.storage.sql.exec(
          `INSERT INTO messages (name, message, timestamp_ms)
           VALUES (?, ?, ?)`,
          ...[session.name, msg.message, now],
        )
        let color = await this.ctx.storage.get<string>(`twitch_user_color_${session.name}`)
        if (color === undefined) {
          color = ""
        }
        this.broadcast({ type: "new_message", name: session.name, name_color: color, message: msg.message, timestamp_ms: now })
        break
      }

      case "message_history": {
        if (session.history_requested) {
          ws.send(JSON.stringify({ type: "error", message: "History already requested" }))
          return
        }
        session.history_requested = true
        ws.serializeAttachment(session)
        const messages = this.ctx.storage.sql.exec<{ name: string; chat_message: string; timestamp_ms: number }>(
          `SELECT name, message, timestamp_ms
           FROM messages
           ORDER BY timestamp_ms`,
        )
        const history_messages = []
        const name_color_cache = new Map<string, string>()
        for (const message of messages) {
          const { name, chat_message, timestamp_ms } = message
          let name_color = name_color_cache.get(name)
          if (name_color === undefined) {
            name_color = await this.ctx.storage.get<string>(`twitch_user_color_${name}`)
            if (name_color === undefined) {
              name_color = ""
            }
            name_color_cache.set(name, name_color)
          }
          history_messages.push({ name, name_color, message: chat_message, timestamp_ms })
        }
        ws.send(JSON.stringify({ type: "message_history", messages: history_messages }))
        break
      }

      default:
        ws.close(1007, "invalid message type")
        return
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const session = this.sessions.get(ws)
    if (session) {
      if (session.authenticated) {
        this.broadcast({ type: "user_leave", name: session.name })
      }
      this.sessions.delete(ws)
    }
    ws.close(code, "closed")
    console.log("WebSocket closed", code, reason, wasClean)
  }

  async webSocketError(ws: WebSocket, error: Error) {
    console.log("WebSocket error", error)
    ws.close(1006, "error")
  }

  private async twitch_auth(): Promise<TwitchToken> {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.PUBLIC_TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    })
    console.log("Authenticated with Twitch")
    const json = await response.json<TwitchTokenServer>()
    const twitch_token = {
      access_token: json.access_token,
      expires_at: Date.now() / 1000 + json.expires_in,
    }
    await this.ctx.storage.put("twitch_token", twitch_token)
    console.log("Stored Twitch token")
    return twitch_token
  }

  private async twitch_refresh_user_token(twitch_token: TwitchUserToken): Promise<TwitchUserToken> {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.PUBLIC_TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: twitch_token.refresh_token,
      }),
    })
    if (!response.ok) {
      console.error("ERROR: Twitch user token refresh failed:", await response.text())
      throw new Error("Error refreshing Twitch user token")
    }
    const json = await response.json<TwitchUserTokenServer>()
    return {
      access_token: json.access_token,
      expires_at: Date.now() / 1000 + json.expires_in,
      refresh_token: json.refresh_token,
    }
  }

  private async twitch_get_user_name(twitch_token: TwitchUserToken, session: string): Promise<string> {
    let display_name = await this.ctx.storage.get<string>(`twitch_user_name_${session}`)
    let user_id: string | undefined
    if (display_name === undefined) {
      const response = await fetch("https://api.twitch.tv/helix/users", {
        headers: {
          "Client-Id": env.PUBLIC_TWITCH_CLIENT_ID,
          Authorization: `Bearer ${twitch_token.access_token}`,
        },
      })
      if (!response.ok) {
        console.error("ERROR: Twitch user name fetch failed:", await response.text())
        throw new Error("Error fetching Twitch user name")
      }
      const json = await response.json<TwitchUserServer>()
      display_name = json.data[0].display_name
      user_id = json.data[0].id
      await this.ctx.storage.put(`twitch_user_name_${session}`, display_name)
    }
    let name_color = await this.ctx.storage.get<string>(`twitch_user_color_${display_name}`)
    if (name_color === undefined) {
      const response = await fetch(`https://api.twitch.tv/helix/chat/color?user_id=${user_id}`, {
        headers: {
          "Client-Id": env.PUBLIC_TWITCH_CLIENT_ID,
          Authorization: `Bearer ${twitch_token.access_token}`,
        },
      })
      if (!response.ok) {
        console.error("ERROR: Twitch user color fetch failed:", await response.text())
        throw new Error("Error fetching Twitch user color")
      }
      const color_json = await response.json<TwitchUserColorServer>()
      name_color = color_json.data[0].color
      await this.ctx.storage.put(`twitch_user_color_${display_name}`, name_color)
    }
    return display_name
  }

  private get_player_session(request: Request) {
    const cookies = request.headers.get("cookie") || ""
    let session: string | undefined
    cookies.split(";").forEach((cookie) => {
      const [key, value] = cookie.trim().split("=")
      if (key === "swarm_fm_player_session") {
        session = value
      }
    })
    return session
  }

  async twitch_user_auth(request: Request): Promise<Response> {
    const session = this.get_player_session(request)
    if (session === undefined) {
      return new Response("Player session not found", { status: 400 })
    }

    const url = new URL(request.url)
    const authorization_code = url.searchParams.get("code")
    if (authorization_code === null) {
      return new Response("Authorization code not found", { status: 400 })
    }
    try {
      const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: env.PUBLIC_TWITCH_CLIENT_ID,
          client_secret: env.TWITCH_CLIENT_SECRET,
          code: authorization_code,
          grant_type: "authorization_code",
          redirect_uri: "https://player.sw.arm.fm/twitch_auth",
        }),
      })
      if (!response.ok) {
        console.error("ERROR: Twitch user auth failed:", await response.text())
        return new Response("Error authenticating with Twitch", { status: 500 })
      }
      const json = await response.json<TwitchUserTokenServer>()
      const twitch_token: TwitchUserToken = {
        access_token: json.access_token,
        expires_at: Date.now() / 1000 + json.expires_in,
        refresh_token: json.refresh_token,
      }
      await this.ctx.storage.put(`twitch_user_token_${session}`, twitch_token)
      return Response.redirect(url.origin, 303)
    } catch (e) {
      console.error(e)
      return new Response("Error authenticating with Twitch", { status: 500 })
    }
  }

  async twitch_session_check(session: string): Promise<{ name: string; name_color: string } | null> {
    let twitch_token = await this.ctx.storage.get<TwitchUserToken>(`twitch_user_token_${session}`)
    if (twitch_token === undefined) {
      return null
    }
    if (twitch_token.expires_at < Date.now() / 1000) {
      try {
        twitch_token = await this.twitch_refresh_user_token(twitch_token)
        await this.ctx.storage.put(`twitch_user_token_${session}`, twitch_token)
      } catch (e) {
        console.error("ERROR: failed to refresh token: ", e)
        throw e
      }
    }
    const name = await this.twitch_get_user_name(twitch_token, session)
    const name_color = (await this.ctx.storage.get<string>(`twitch_user_color_${name}`)) || ""
    return { name, name_color }
  }

  async twitch_emotes(): Promise<TwitchEmotes> {
    let twitch_token = await this.ctx.storage.get<TwitchToken>("twitch_token")
    const now = Date.now() / 1000
    if (twitch_token === undefined || twitch_token.expires_at < now) {
      console.log("No valid Twitch token found, authenticating")
      twitch_token = await this.twitch_auth()
    }

    const emote_cache = await this.ctx.storage.get<TwitchEmotesCache>("twitch_emotes")
    let emote_data: TwitchEmotes = new Map()
    if (emote_cache === undefined || emote_cache.expires_at < Date.now() / 1000) {
      const response = await fetch("https://api.twitch.tv/helix/chat/emotes?broadcaster_id=85498365", {
        headers: {
          "Client-Id": env.PUBLIC_TWITCH_CLIENT_ID,
          Authorization: `Bearer ${twitch_token.access_token}`,
        },
      })
      console.log("Fetched Twitch emotes")
      const json = await response.json<TwitchEmotesServer>()
      const template = json.template
      for (const data of json.data) {
        const id = data.id
        let format = "static"
        if (data.format.includes("animated")) {
          format = "animated"
        }
        let theme_mode = "light"
        if (!data.theme_mode.includes("light")) {
          theme_mode = "dark"
        }
        const scale = data.scale
        const base_url = template.replace("{{id}}", id).replace("{{format}}", format).replace("{{theme_mode}}", theme_mode)
        const emote: TwitchEmote = {
          animated: format === "animated",
          images: {
            url_1x: scale.includes("1.0") ? base_url.replace("{{scale}}", "1.0") : null,
            url_2x: scale.includes("2.0") ? base_url.replace("{{scale}}", "2.0") : null,
            url_4x: scale.includes("3.0") ? base_url.replace("{{scale}}", "3.0") : null,
          },
        }
        emote_data.set(data.name, emote)
        const emote_cache: TwitchEmotesCache = {
          data: emote_data,
          expires_at: Date.now() / 1000 + 86400,
        }
        await this.ctx.storage.put("twitch_emotes", emote_cache)
      }
    } else {
      emote_data = emote_cache.data
    }
    console.log("Stored Twitch emotes")
    return emote_data
  }

  private async get_seventv_emote_set(emote_set_id: string): Promise<SevenTVEmoteSet> {
    const gql = `
query EmoteSet($emoteSetId: ObjectID!) {
  emoteSet(id: $emoteSetId) {
    emote_count
    flags
    owner {
      display_name
    }
    name
    emotes {
      flags
      name
      data {
        animated
        flags
        host {
          url
        }
        owner {
          username
        }
      }
    }
  }
}`
    const response = await fetch("https://7tv.io/v3/gql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationName: "EmoteSet",
        query: gql,
        variables: {
          emoteSetId: emote_set_id,
        },
      }),
    })
    const json = await response.json<SevenTVEmoteSetServer>()
    const emote_set_name = `${json.data.emoteSet.owner.display_name} - ${json.data.emoteSet.name}`
    const emote_count = json.data.emoteSet.emote_count
    const emotes = new Map()
    for (const emote of json.data.emoteSet.emotes) {
      const emote_name = emote.name
      const emote_animated = emote.data.animated
      const emote_flags = emote.flags
      const emote_url = emote.data.host.url
      const emote_owner = emote.data.owner.username
      const emote_data = {
        animated: emote_animated,
        zero_width: (emote_flags & 1) === 1,
        url: emote_url,
        owner: emote_owner,
      }
      emotes.set(emote_name, emote_data)
    }
    return {
      name: emote_set_name,
      emote_count: emote_count,
      emotes: emotes,
    }
  }

  async seventv_emotes(): Promise<SevenTVEmoteSets> {
    const vedal_emote_set_id = "01GN2QZDS0000BKRM8E4JJD3NV"
    const global_emote_set_id = "01HKQT8EWR000ESSWF3625XCS4"

    let emote_sets = await this.ctx.storage.get<SevenTVEmoteSetCache>("seventv_emotes")
    if (emote_sets === undefined || emote_sets.expires_at < Date.now() / 1000) {
      const vedal_emote_set = await this.get_seventv_emote_set(vedal_emote_set_id)
      const global_emote_set = await this.get_seventv_emote_set(global_emote_set_id)
      emote_sets = {
        data: {
          vedal_emotes: vedal_emote_set,
          global_emotes: global_emote_set,
        },
        expires_at: Date.now() / 1000 + 86400,
      }
      await this.ctx.storage.put("seventv_emotes", emote_sets)
    }
    return {
      global_emotes: emote_sets.data.global_emotes,
      vedal_emotes: emote_sets.data.vedal_emotes,
    }
  }

  async flush_emote_cache(): Promise<Response> {
    await this.ctx.storage.delete("twitch_emotes")
    await this.ctx.storage.delete("seventv_emotes")
    return new Response("OK")
  }

  alarm(_alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
    this.ctx.storage.sql.exec(
      `DELETE
       FROM messages
       WHERE timestamp_ms < ${Date.now() - 86400 * 1000 * 3}`,
    )
    this.ctx.storage.setAlarm(Date.now() + 3600 * 1000).catch((e) => console.error(e))
  }
}

export default {
  /**
   * This is the standard fetch handler for a Cloudflare Worker
   *
   * @param request - The request submitted to the Worker from the client
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   * @param _ctx - The execution context of the Worker
   * @returns The response to be sent back to the client
   */
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url)
    const id = env.DO.idFromName("chat")
    const stub = env.DO.get(id)

    if (url.pathname === "/twitch_auth") {
      return stub.twitch_user_auth(request)
    } else if (url.pathname === "/chat") {
      const upgradeHeader = request.headers.get("Upgrade")
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("expected Upgrade: websocket", {
          status: 426,
        })
      }
      return stub.fetch(request)
    } else if (url.pathname === "/flush_emote_cache") {
      return stub.flush_emote_cache()
    }

    return await sveltekit_worker.fetch(request, env, _ctx)
  },
} satisfies ExportedHandler<Env>
