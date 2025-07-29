// noinspection SqlNoDataSourceInspection

import sveltekit_worker from "./_worker.js"

import { DurableObject, env } from "cloudflare:workers"

export type WSMessageType =
  | { type: "new_message"; name: string; message: string; timestamp_ms: number }
  | { type: "user_join"; name: string }
  | { type: "user_leave"; name: string }
  | { type: "user_list"; users?: string[] }
  | { type: "authenticate"; session: string }
  | { type: "send_message"; message: string }
  | { type: "message_history"; messages?: [{ name: string; message: string; timestamp_ms: number }] }
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
  data: [{ display_name: string }]
}

export type TwitchEmote = {
  name: string
  images: {
    url_1x: string | null
    url_2x: string | null
    url_4x: string | null
  }
  animated: boolean
}

export type TwitchEmotes = Array<TwitchEmote>

export type TwitchEmotesServer = {
  data: [
    {
      id: string
      name: string
      format: ["static" | "animated"]
      scale: ["1.0" | "2.0" | "3.0"]
      theme_mode: ["light" | "dark"]
      [key: string]: unknown
    },
  ]
  template: string
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
        session.name = await this.twitch_get_user_name(token)
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
        this.broadcast({ type: "new_message", name: session.name, message: msg.message, timestamp_ms: now })
        break
      }

      case "message_history": {
        if (session.history_requested) {
          ws.send(JSON.stringify({ type: "error", message: "History already requested" }))
          return
        }
        session.history_requested = true
        ws.serializeAttachment(session)
        const messages = this.ctx.storage.sql.exec(
          `SELECT name, message, timestamp_ms
           FROM messages
           ORDER BY timestamp_ms`,
        )

        ws.send(JSON.stringify({ type: "message_history", messages: messages.toArray() }))
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

  async twitch_emotes(): Promise<Response> {
    let emote_data = await this.ctx.storage.get<TwitchEmotes>("emote_data")

    if (emote_data === undefined) {
      console.log("No emote data found, fetching from Twitch")
      let twitch_token = await this.ctx.storage.get<TwitchToken>("twitch_token")
      const now = Date.now() / 1000
      if (twitch_token === undefined || twitch_token.expires_at < now) {
        console.log("No valid Twitch token found, authenticating")
        twitch_token = await this.twitch_auth()
      }

      emote_data = await this.twitch_fetch_emotes(twitch_token)
    }
    return new Response(JSON.stringify(emote_data), { headers: { "Content-Type": "application/json" } })
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

  private async twitch_get_user_name(twitch_token: TwitchUserToken): Promise<string> {
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
    console.log(json)
    return json.data[0].display_name
  }

  private async twitch_fetch_emotes(twitch_token: TwitchToken): Promise<TwitchEmotes> {
    const response = await fetch("https://api.twitch.tv/helix/chat/emotes?broadcaster_id=85498365", {
      headers: {
        "Client-Id": env.PUBLIC_TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitch_token.access_token}`,
      },
    })
    console.log("Fetched Twitch emotes")
    const json = await response.json<TwitchEmotesServer>()
    const template = json.template
    const emote_data: TwitchEmotes = []
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
        name: data.name,
        animated: format === "animated",
        images: {
          url_1x: scale.includes("1.0") ? base_url.replace("{{scale}}", "1.0") : null,
          url_2x: scale.includes("2.0") ? base_url.replace("{{scale}}", "2.0") : null,
          url_4x: scale.includes("3.0") ? base_url.replace("{{scale}}", "3.0") : null,
        },
      }
      emote_data.push(emote)
    }
    await this.ctx.storage.put("emote_data", emote_data)
    console.log("Stored Twitch emotes")
    return emote_data
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
          redirect_uri: "https://chat.sw.arm.fm/twitch_auth",
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
      return Response.redirect("/", 303)
    } catch (e) {
      console.error(e)
      return new Response("Error authenticating with Twitch", { status: 500 })
    }
  }

  async twitch_session_check(request: Request): Promise<Response> {
    const session = this.get_player_session(request)
    if (session === undefined) {
      return new Response("Player session not found", { status: 400 })
    }
    const twitch_token = await this.ctx.storage.get<TwitchUserToken>(`twitch_user_token_${session}`)
    return new Response(JSON.stringify(twitch_token !== undefined), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
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
    } else if (url.pathname === "/twitch_emotes") {
      return stub.twitch_emotes()
    } else if (url.pathname === "/twitch_session_check") {
      return stub.twitch_session_check(request)
    }

    return await sveltekit_worker.fetch(request, env, _ctx)
  },
} satisfies ExportedHandler<Env>
