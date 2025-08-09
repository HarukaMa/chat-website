/**
 * KV used:
 *
 * `twitch_token`: app twitch token
 *
 * `twitch_user_token_{session}`: session -> twitch tokens (incl. refresh token)
 *
 * `twitch_user_name_{session}`: session -> display name cache (legacy)
 *
 * `twitch_user_cache_expires_{session}`: session -> timestamp of user info cache expiration (legacy)
 *
 * `timeout_{display_name}`: display name -> timestamp of timeout expiration (legacy)
 *
 * `ban_{display_name}`: display name -> true if user is banned (legacy)
 *
 * `twitch_user_id_{session}`: session -> user id
 *
 * `twitch_user_cache_expires_{id}`: id -> timestamp of user info cache expiration
 *
 * `twitch_user_id_from_name_{display_name}`: display name -> user id for operations on name
 *
 * `twitch_user_name_{id}`: user id -> display name
 *
 * `twitch_user_color_{id}`: user id -> display name color
 *
 * `twitch_user_color_{display_name}`: display name -> display name color (keep for db compat)
 *
 * `timeout_{id}`: user id -> timestamp of timeout expiration
 *
 * `ban_{id}`: user id -> true if user is banned
 *
 * `twitch_emotes`: emote cache
 *
 * `seventv_emotes`: emote cache
 *
 *
 */

import sveltekit_worker from "./_worker.js"

import { DurableObject, env } from "cloudflare:workers"

export type ChatMessage = {
  id: number
  name: string
  name_color: string
  message: string
  timestamp_ms: number
  roles: string[] // Add roles to chat messages
  user_id: string
}

export type WSMessageType =
  // server -> client
  | { type: "new_message"; message: ChatMessage }
  | { type: "message_history"; messages: ChatMessage[] }
  | { type: "message_deleted"; id: number }
  | { type: "user_timed_out"; name: string; duration: number }
  | { type: "user_banned"; name: string }
  | { type: "user_join"; name: string }
  | { type: "user_leave"; name: string }
  | { type: "connection_count"; count: number }
  | { type: "connection_counts"; data: { session: number; logged_in: number; unique_logged_in: number } }
  | { type: "auth_success"; name: string; user_id: number; name_color: string; timed_out_until: number | null; banned: boolean }
  | { type: "role_updated"; name: string; roles: string[] } // Add role update message
  // client -> server
  | { type: "authenticate"; session: string }
  | { type: "send_message"; message: string }
  | { type: "delete_message"; id: number }
  | { type: "timeout_user"; name: string; duration: number }
  | { type: "ban_user"; name: string }
  | { type: "unban_user"; name: string }
  | { type: "user_list"; users?: string[] }
  | { type: "history_request" }
  | { type: "get_connection_count" }
  | { type: "get_connection_counts" }
  | { type: "assign_role"; name: string; role: string } // Add role assignment
  | { type: "remove_role"; name: string; role: string } // Add role removal
  // messages from server
  | { type: "error"; message: string }
  | { type: "notification"; message: string }

export type Session = {
  authenticated: boolean
  name: string
  history_requested: boolean
  // MAKE SURE THIS IS NOT PRINTED OUT FOR LOGGED-IN USERS
  client_ip: string
  last_messages: number[]
  user_id: string
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
  channel: string
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
      emotes: {
        flags: number
        name: string
        data: {
          animated: boolean
          flags: number
          host: {
            url: string
            files: {
              height: number
              width: number
            }[]
          }
          owner: {
            username: string
          }
        }
      }[]
    }
  }
}

export type SevenTVEmote = {
  zero_width: boolean
  animated: boolean
  url: string
  owner: string
  height: number
  width: number
  set_name: string
}

export type SevenTVEmotes = Map<string, SevenTVEmote>

export type SevenTVEmotesCache = {
  data: SevenTVEmotes
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
  commands: Map<string, (msg: WSMessageType, session: Session, ws: WebSocket) => Promise<void>>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sessions = new Map()
    this.ctx.getWebSockets().forEach((ws) => {
      const session = ws.deserializeAttachment()
      this.sessions.set(ws, session)
    })
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("PING", "PONG"))

    this.commands = new Map([
      ["/timeout", this.command_timeout_user.bind(this)],
      ["/ban", this.command_ban_user.bind(this)],
      ["/unban", this.command_unban_user.bind(this)],
      ["/role", this.command_assign_role.bind(this)],
      ["/removerole", this.command_remove_role.bind(this)],
    ])

    this.init_database()
    this.init_roles().then((_) => {})
    this.ctx.storage.getAlarm().then((alarm_time) => {
      if (alarm_time === null) {
        this.ctx.storage.setAlarm(Date.now() + 3600 * 1000).catch((e) => console.error(e))
      }
    })
  }

  private async init_roles() {
    // Initialize default roles if they don't exist
    const modRoles = await this.ctx.storage.get<string[]>("role_mod")
    if (!modRoles) {
      await this.ctx.storage.put("role_mod", [
        "51241857", // haruka_ff
        "278730238", // boop_dot
        "752652273", // key0__0
      ])
    }

    const devRoles = await this.ctx.storage.get<string[]>("role_dev")
    if (!devRoles) {
      await this.ctx.storage.put("role_dev", [
        "51241857", // haruka_ff
        "560576477", // KTrain5369
      ])
    }

    const artistRoles = await this.ctx.storage.get<string[]>("role_art")
    if (!artistRoles) {
      await this.ctx.storage.put("role_art", [
        "752652273", // key0__0
      ])
    }

    // Initialize empty arrays for other roles if they don't exist
    const roleTypes = ["vip", "bot", "stream"]
    for (const roleType of roleTypes) {
      const existing = await this.ctx.storage.get<string>(`role_${roleType}`)
      if (!existing) {
        await this.ctx.storage.put(`role_${roleType}`, [])
      }
    }
  }

  // Helper method to check if user has a specific role
  private async hasRole(userId: string, role: string): Promise<boolean> {
    const usersWithRole = await this.ctx.storage.get<string[]>(`role_${role}`)
    return usersWithRole ? usersWithRole.includes(userId) : false
  }

  // Helper method to get all users with a specific role
  private async getUsersWithRole(role: string): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>(`role_${role}`)) || []
  }

  // Updated method to get user roles
  async get_user_roles(nameOrUserId: string): Promise<string[]> {
    const roles: string[] = []
    const roleTypes = ["mod", "vip", "dev", "art", "stream", "bot"]

    for (const roleType of roleTypes) {
      if (await this.hasRole(nameOrUserId, roleType)) {
        roles.push(roleType)
      }
    }

    return roles
  }

  private init_database() {
    let cursor = this.ctx.storage.sql.exec(`PRAGMA table_list`)
    const tables = cursor.toArray()

    // init migrations table
    if (!tables.find((t) => t.name === "migrations")) {
      this.ctx.storage.sql.exec(
        `CREATE TABLE migrations (
          id INTEGER PRIMARY KEY
        )`,
      )
    }

    // init messages table
    if (!tables.find((t) => t.name === "messages")) {
      this.ctx.storage.sql.exec(
        `CREATE TABLE messages ( 
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp_ms INTEGER NOT NULL
        )`,
      )
      this.ctx.storage.sql.exec(`CREATE INDEX idx_timestamp ON messages (timestamp_ms DESC)`)
    }

    // migration 1: add user_id column to messages table
    cursor = this.ctx.storage.sql.exec("SELECT id FROM migrations WHERE id = 1")
    if (cursor.toArray().length === 0) {
      this.ctx.storage.sql.exec(`ALTER TABLE messages ADD COLUMN user_id TEXT NOT NULL DEFAULT ""`)
      this.ctx.storage.sql.exec(`INSERT INTO migrations (id) VALUES (1)`)
    }
  }

  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)
    this.ctx.acceptWebSocket(server)
    const session: Session = {
      authenticated: false,
      name: "",
      history_requested: false,
      client_ip: request.headers.get("cf-connecting-ip") || "",
      last_messages: [],
      user_id: "",
    }
    server.serializeAttachment(session)
    this.sessions.set(server, session)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  private broadcast(message: WSMessageType) {
    this.ctx.getWebSockets().forEach((ws) => {
      ws.send(JSON.stringify(message))
    })
  }

  private get_user_list() {
    return Array.from(this.sessions.values(), (s) => s.name)
      .filter(Boolean)
      .sort()
  }

  private async is_user_banned(name: string, user_id: string) {
    // unfortunately we do have a banned user, so we need to check both keys
    return (await this.ctx.storage.get<boolean>(`ban_${name}`)) || (await this.ctx.storage.get<boolean>(`ban_${user_id}`))
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
      case "message_history":
        ws.close(1007, "invalid message type")
        return

      case "user_list":
        ws.send(JSON.stringify({ type: "user_list", users: this.get_user_list() }))
        break

      case "authenticate": {
        await this.ws_authenticate(msg, session, ws)
        break
      }

      case "send_message": {
        await this.ws_send_message(msg, session, ws)
        break
      }

      case "history_request": {
        await this.ws_history_request(msg, session, ws)
        break
      }

      case "delete_message": {
        await this.ws_delete_message(msg, session, ws)
        break
      }

      case "timeout_user": {
        await this.ws_timeout_user(msg, session, ws)
        break
      }

      case "ban_user": {
        await this.ws_ban_user(msg, session, ws)
        break
      }

      case "unban_user": {
        await this.ws_unban_user(msg, session, ws)
        break
      }

      case "assign_role": {
        await this.ws_assign_role(msg, session, ws)
        break
      }

      case "remove_role": {
        await this.ws_remove_role(msg, session, ws)
        break
      }

      case "get_connection_count":
        ws.send(JSON.stringify({ type: "connection_count", count: this.ctx.getWebSockets().length }))
        break

      case "get_connection_counts":
        await this.ws_get_connection_counts(msg, session, ws)
        break

      default:
        ws.close(1007, "invalid message type")
        return
    }
  }

  async ws_authenticate(msg: WSMessageType, session: Session, ws: WebSocket) {
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
    const user_data = await this.twitch_get_user_info(token, msg.session)
    session.name = user_data.name
    session.user_id = user_data.user_id
    session.authenticated = true
    ws.serializeAttachment(session)
    ws.send(
      JSON.stringify({
        type: "auth_success",
        name: session.name,
        name_color: user_data.name_color,
        timed_out_until: (await this.ctx.storage.get<number>(`timeout_${user_data.user_id}`)) || null,
        banned: await this.is_user_banned(user_data.name, user_data.user_id),
      }),
    )
    this.broadcast({ type: "user_join", name: session.name })
  }

  private async ws_send_message(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "send_message") {
      return
    }
    if (!session.authenticated) {
      ws.close(1007, "unauthenticated")
      return
    }
    if (!("message" in msg)) {
      ws.close(1007, "invalid message content")
      return
    }
    const user_ban = await this.is_user_banned(session.name, session.user_id)
    if (user_ban) {
      ws.send(JSON.stringify({ type: "error", message: "You are banned from chat" }))
      return
    }
    const user_timeout = await this.ctx.storage.get<number>(`timeout_${session.user_id}`)
    if (user_timeout !== undefined && user_timeout > Date.now()) {
      ws.send(JSON.stringify({ type: "error", message: "You are currently timed out" }))
      return
    }
    if (msg.message.trim() === "") {
      ws.send(JSON.stringify({ type: "error", message: "Message cannot be empty" }))
      return
    }
    const now = Date.now()
    session.last_messages.push(now)
    if (session.last_messages.length > 5) {
      session.last_messages.shift()
    }
    if (session.last_messages.length == 5) {
      if (!(await this.hasRole(session.user_id, "mod")) && now - session.last_messages[0] < 5000) {
        await this.ctx.storage.put(`timeout_${session.user_id}`, now + 10000)
        this.broadcast({ type: "user_timed_out", name: session.name, duration: 30 })
        return
      }
    }
    if (msg.message.length > 500) {
      ws.send(JSON.stringify({ type: "error", message: "Message too long" }))
      return
    }

    if (msg.message.startsWith("/")) {
      const command = msg.message.split(" ")[0]
      const command_func = this.commands.get(command)
      if (command_func !== undefined) {
        await command_func(msg, session, ws)
        return
      }
      ws.send(JSON.stringify({ type: "error", message: "Unknown command" }))
      return
    }

    const result = this.ctx.storage.sql.exec<{ id: number }>(
      `INSERT INTO messages (name, message, timestamp_ms, user_id)
           VALUES (?, ?, ?, ?) RETURNING id`,
      ...[session.name, msg.message, now, session.user_id],
    )
    let id: number | undefined
    for (const row of result) {
      id = row.id
    }
    if (id === undefined) {
      ws.send(JSON.stringify({ type: "error", message: "Failed to store message" }))
      return
    }
    let color = await this.ctx.storage.get<string>(`twitch_user_color_${session.user_id}`)
    if (color === undefined) {
      color = ""
    }
    const roles = await this.get_user_roles(session.user_id) // Get user roles
    this.broadcast({
      type: "new_message",
      message: { id, name: session.name, name_color: color, message: msg.message, timestamp_ms: now, roles, user_id: session.user_id },
    })
  }

  private async ws_history_request(_msg: WSMessageType, session: Session, ws: WebSocket) {
    if (session.history_requested) {
      ws.send(JSON.stringify({ type: "error", message: "History already requested" }))
      return
    }
    session.history_requested = true
    ws.serializeAttachment(session)
    const messages = this.ctx.storage.sql.exec<{ id: number; name: string; message: string; timestamp_ms: number; user_id: string }>(
      `SELECT id, name, message, timestamp_ms, user_id
           FROM messages
           ORDER BY timestamp_ms DESC
           LIMIT 500`,
    )
    const history_messages: ChatMessage[] = []
    const name_color_cache = new Map<string, string>()
    const roles_cache = new Map<string, string[]>()
    for (const db_message of messages) {
      const { id, name, message, timestamp_ms, user_id } = db_message
      let name_color: string | undefined
      if (user_id) {
        name_color = name_color_cache.get(user_id)
        if (name_color === undefined) {
          name_color = await this.ctx.storage.get<string>(`twitch_user_color_${user_id}`)
          if (name_color !== undefined) {
            name_color_cache.set(user_id, name_color)
          }
        }
      } else {
        name_color = name_color_cache.get(name)
        if (name_color === undefined) {
          name_color = await this.ctx.storage.get<string>(`twitch_user_color_${name}`)
          if (name_color !== undefined) {
            name_color_cache.set(name, name_color)
          }
        }
      }
      let roles = roles_cache.get(user_id)
      if (roles === undefined) {
        roles = await this.get_user_roles(user_id)
        roles_cache.set(user_id, roles)
      }
      history_messages.push({ id, name, name_color: name_color || "", message, timestamp_ms, roles, user_id })
    }
    ws.send(JSON.stringify({ type: "message_history", messages: history_messages.toReversed() }))
  }

  private async ws_delete_message(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "delete_message") {
      return
    }
    if (!session.authenticated) {
      ws.close(1007, "unauthenticated")
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }
    if (!("id" in msg)) {
      ws.close(1007, "invalid message content")
      return
    }
    this.ctx.storage.sql.exec(`DELETE FROM messages WHERE id = ?`, ...[msg.id])
    this.broadcast({ type: "message_deleted", id: msg.id })
  }

  private async ws_timeout_user(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "timeout_user") {
      return
    }
    if (!session.authenticated) {
      ws.close(1007, "unauthenticated")
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }
    await this.timeout_user(msg.name, msg.duration, ws)
  }

  private async command_timeout_user(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "send_message") {
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }
    const message_parts = msg.message.split(" ")
    if (message_parts.length < 3) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid command format (/timeout <user> <duration>)" }))
      return
    }
    await this.timeout_user(message_parts[1], parseInt(message_parts[2]), ws)
  }

  private async timeout_user(name: string, duration: number, ws: WebSocket) {
    const user_id = await this.ctx.storage.get<string>(`twitch_user_id_from_name_${name}`)
    if (user_id === undefined) {
      ws.send(JSON.stringify({ type: "error", message: "User not found" }))
      return
    }
    if (await this.hasRole(user_id, "mod")) {
      ws.send(JSON.stringify({ type: "error", message: "You cannot timeout other moderators" }))
      return
    }
    await this.ctx.storage.put(`timeout_${user_id}`, Date.now() + duration * 1000)
    this.broadcast({ type: "user_timed_out", name, duration })
  }

  private async ws_ban_user(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "ban_user") {
      return
    }
    if (!session.authenticated) {
      ws.close(1007, "unauthenticated")
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }
    await this.ban_user(msg.name, ws)
  }

  private async command_ban_user(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "send_message") {
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }
    const message_parts = msg.message.split(" ")
    if (message_parts.length < 2) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid command format (/ban <user>)" }))
      return
    }
    await this.ban_user(message_parts[1], ws)
  }

  private async ban_user(name: string, ws: WebSocket) {
    const user_id = await this.ctx.storage.get<string>(`twitch_user_id_from_name_${name}`)
    if (user_id === undefined) {
      ws.send(JSON.stringify({ type: "error", message: "User not found" }))
      return
    }
    if (await this.hasRole(user_id, "mod")) {
      ws.send(JSON.stringify({ type: "error", message: "You cannot ban other moderators" }))
      return
    }
    await this.ctx.storage.put(`ban_${user_id}`, true)
    this.broadcast({ type: "user_banned", name })
  }

  private async unban_user(name: string, ws: WebSocket) {
    const user_id = await this.ctx.storage.get<string>(`twitch_user_id_from_name_${name}`)
    if (user_id === undefined) {
      ws.send(JSON.stringify({ type: "error", message: "User not found" }))
      return
    }
    await this.ctx.storage.delete(`ban_${user_id}`)
    ws.send(JSON.stringify({ type: "notification", message: `User ${name} has been unbanned` }))
  }

  private async ws_unban_user(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "unban_user") {
      return
    }
    if (!session.authenticated) {
      ws.close(1007, "unauthenticated")
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }
    await this.unban_user(msg.name, ws)
  }

  private async command_unban_user(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "send_message") {
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }
    const message_parts = msg.message.split(" ")
    if (message_parts.length < 2) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid command format (/unban <user>)" }))
      return
    }
    await this.unban_user(message_parts[1], ws)
  }

  // Updated role assignment methods
  async command_assign_role(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "send_message") {
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }

    const message_parts = msg.message.split(" ")
    if (message_parts.length < 3) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid command format (/role <user> <role>)" }))
      return
    }

    const targetName = message_parts[1]
    const role = message_parts[2]

    const validRoles = ["mod", "vip", "dev", "art", "stream", "bot"]
    if (!validRoles.includes(role)) {
      ws.send(JSON.stringify({ type: "error", message: `Invalid role. Valid roles: ${validRoles.join(", ")}` }))
      return
    }

    const targetUserId = await this.ctx.storage.get<string>(`twitch_user_id_from_name_${targetName}`)
    if (!targetUserId) {
      ws.send(JSON.stringify({ type: "error", message: "User not found" }))
      return
    }

    await this.assign_role(targetUserId, role)
    ws.send(JSON.stringify({ type: "notification", message: `Assigned role ${role} to ${targetName}` }))
    this.broadcast({ type: "role_updated", name: targetName, roles: await this.get_user_roles(targetUserId) })
  }

  private async ws_assign_role(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "assign_role") {
      return
    }
    if (!session.authenticated) {
      ws.close(1007, "unauthenticated")
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }

    const validRoles = ["mod", "vip", "dev", "art", "stream", "bot"]
    if (!validRoles.includes(msg.role)) {
      ws.send(JSON.stringify({ type: "error", message: `Invalid role. Valid roles: ${validRoles.join(", ")}` }))
      return
    }

    const targetUserId = await this.ctx.storage.get<string>(`twitch_user_id_from_name_${msg.name}`)
    if (!targetUserId) {
      ws.send(JSON.stringify({ type: "error", message: "User not found" }))
      return
    }

    await this.assign_role(targetUserId, msg.role)
    ws.send(JSON.stringify({ type: "notification", message: `Assigned role ${msg.role} to ${msg.name}` }))
    this.broadcast({ type: "role_updated", name: msg.name, roles: await this.get_user_roles(targetUserId) })
  }

  async assign_role(userId: string, role: string): Promise<void> {
    const usersWithRole = await this.getUsersWithRole(role)
    if (!usersWithRole.includes(userId)) {
      usersWithRole.push(userId)
      await this.ctx.storage.put(`role_${role}`, usersWithRole)
    }
  }

  async command_remove_role(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "send_message") {
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }

    const message_parts = msg.message.split(" ")
    if (message_parts.length < 3) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid command format (/removerole <user> <role>)" }))
      return
    }

    const targetName = message_parts[1]
    const role = message_parts[2]

    const targetUserId = await this.ctx.storage.get<string>(`twitch_user_id_from_name_${targetName}`)
    if (!targetUserId) {
      ws.send(JSON.stringify({ type: "error", message: "User not found" }))
      return
    }

    await this.remove_role(targetUserId, role)
    ws.send(JSON.stringify({ type: "notification", message: `Removed role ${role} from ${targetName}` }))
    this.broadcast({ type: "role_updated", name: targetName, roles: await this.get_user_roles(targetUserId) })
  }

  private async ws_remove_role(msg: WSMessageType, session: Session, ws: WebSocket) {
    if (msg.type !== "remove_role") {
      return
    }
    if (!session.authenticated) {
      ws.close(1007, "unauthenticated")
      return
    }
    if (!(await this.hasRole(session.user_id, "mod"))) {
      ws.close(1007, "unauthorized")
      return
    }

    const targetUserId = await this.ctx.storage.get<string>(`twitch_user_id_from_name_${msg.name}`)
    if (!targetUserId) {
      ws.send(JSON.stringify({ type: "error", message: "User not found" }))
      return
    }

    await this.remove_role(targetUserId, msg.role)
    ws.send(JSON.stringify({ type: "notification", message: `Removed role ${msg.role} from ${msg.name}` }))
    this.broadcast({ type: "role_updated", name: msg.name, roles: await this.get_user_roles(targetUserId) })
  }

  async remove_role(userId: string, role: string): Promise<void> {
    const usersWithRole = await this.getUsersWithRole(role)
    const updatedUsers = usersWithRole.filter((id) => id !== userId)
    await this.ctx.storage.put(`role_${role}`, updatedUsers)
  }

  private async ws_get_connection_counts(msg: WSMessageType, _session: Session, ws: WebSocket) {
    if (msg.type !== "get_connection_counts") {
      return
    }
    const ws_connections = this.ctx.getWebSockets()
    const ws_connection_count = ws_connections.filter((ws) => {
      return (this.sessions.has(ws) && this.sessions.get(ws)?.history_requested) || false
    }).length
    let ws_logged_in_count = 0
    const ws_logged_in_names = new Set<string>()
    ws_connections.forEach((ws) => {
      if (this.sessions.has(ws)) {
        const session = this.sessions.get(ws)!
        if (session.authenticated) {
          ws_logged_in_count++
          ws_logged_in_names.add(session.name)
        }
      }
    })

    ws.send(
      JSON.stringify({
        type: "connection_counts",
        data: {
          session: ws_connection_count,
          logged_in: ws_logged_in_count,
          unique_logged_in: ws_logged_in_names.size,
        },
      }),
    )
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

  private async fetch_twitch_user_info(
    twitch_token: TwitchUserToken,
    session: string,
  ): Promise<{ name: string; name_color: string; user_id: string }> {
    const now = Date.now() / 1000

    let response = await fetch("https://api.twitch.tv/helix/users", {
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
    const display_name = json.data[0].display_name
    const user_id = json.data[0].id
    await this.ctx.storage.put(`twitch_user_id_${session}`, user_id)
    await this.ctx.storage.put(`twitch_user_name_${user_id}`, display_name)
    await this.ctx.storage.put(`twitch_user_id_from_name_${display_name}`, user_id)

    response = await fetch(`https://api.twitch.tv/helix/chat/color?user_id=${user_id}`, {
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
    const name_color = color_json.data[0].color
    await this.ctx.storage.put(`twitch_user_color_${user_id}`, name_color)

    await this.ctx.storage.put(`twitch_user_cache_expires_${user_id}`, now + 3600)
    return { name: display_name, name_color, user_id }
  }

  private async twitch_get_user_info(
    twitch_token: TwitchUserToken,
    session: string,
  ): Promise<{ name: string; name_color: string; user_id: string }> {
    const user_id = await this.ctx.storage.get<string>(`twitch_user_id_${session}`)
    let user_data: { name: string; name_color: string; user_id: string } | null

    // make sure that after the logic, the cache is valid and has everything
    if (user_id === undefined) {
      // fresh session, just fetch everything
      user_data = await this.fetch_twitch_user_info(twitch_token, session)
    } else {
      // check cached data
      const cache_expires = await this.ctx.storage.get<number>(`twitch_user_cache_expires_${user_id}`)
      const now = Date.now() / 1000
      if (cache_expires === undefined || cache_expires < now) {
        // cache expired, remove old data and fetch new
        const cached_name = await this.ctx.storage.get<string>(`twitch_user_name_${user_id}`)
        await this.ctx.storage.delete(`twitch_user_name_${user_id}`)
        await this.ctx.storage.delete(`twitch_user_color_${user_id}`)
        await this.ctx.storage.delete(`twitch_user_id_from_name_${cached_name}`)
        user_data = await this.fetch_twitch_user_info(twitch_token, session)
      } else {
        // otherwise, try to use the cached data
        const cached_name = await this.ctx.storage.get<string>(`twitch_user_name_${user_id}`)
        const cached_name_color = await this.ctx.storage.get<string>(`twitch_user_color_${user_id}`)
        if (cached_name === undefined || cached_name_color === undefined) {
          // just in case we have race condition, refetch
          user_data = await this.fetch_twitch_user_info(twitch_token, session)
        } else {
          user_data = { name: cached_name, name_color: cached_name_color, user_id }
        }
      }
    }

    return user_data
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

  async twitch_session_check(session: string): Promise<{ name: string; name_color: string; user_id: string } | null> {
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
    return await this.twitch_get_user_info(twitch_token, session)
  }

  private async get_twitch_emotes(twitch_token: TwitchToken, channel_id: number, channel_name: string): Promise<TwitchEmotes> {
    const emote_data = new Map<string, TwitchEmote>()
    const response = await fetch(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${channel_id}`, {
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
        channel: channel_name,
      }
      emote_data.set(data.name, emote)
    }
    return emote_data
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
      const channel_list: [number, string][] = [
        [85498365, "vedal987"],
        [56418014, "anny"],
        [469632185, "camila"],
        [825937345, "Ellie_Minibot"],
        [852880224, "cerberVT"],
        [1004060561, "MinikoMew"],
      ]
      for (const [channel_id, channel_name] of channel_list) {
        const channel_emotes = await this.get_twitch_emotes(twitch_token, channel_id, channel_name)
        for (const [name, emote] of channel_emotes) {
          emote_data.set(name, emote)
        }
      }
      const emote_cache: TwitchEmotesCache = {
        data: emote_data,
        expires_at: Date.now() / 1000 + 86400,
      }
      await this.ctx.storage.put("twitch_emotes", emote_cache)
    } else {
      emote_data = emote_cache.data
    }
    console.log("Stored Twitch emotes")
    return emote_data
  }

  private async get_seventv_emote_set(emote_set_id: string): Promise<SevenTVEmotes> {
    const gql = `
query EmoteSet($emoteSetId: ObjectID!, $formats: [ImageFormat!]) {
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
          files(formats: $formats) {
            height
            width
          }
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
          formats: ["AVIF"],
        },
      }),
    })
    const json = await response.json<SevenTVEmoteSetServer>()
    const emote_set_name = `${json.data.emoteSet.owner.display_name} - ${json.data.emoteSet.name}`
    const emotes = new Map()
    for (const emote of json.data.emoteSet.emotes) {
      const emote_name = emote.name
      const emote_animated = emote.data.animated
      const emote_flags = emote.flags
      const emote_url = emote.data.host.url
      const emote_owner = emote.data.owner.username
      const emote_height = emote.data.host.files[0].height
      const emote_width = emote.data.host.files[0].width
      const emote_data = {
        animated: emote_animated,
        zero_width: (emote_flags & 1) === 1,
        url: emote_url,
        owner: emote_owner,
        height: emote_height,
        width: emote_width,
        set_name: emote_set_name,
      }
      emotes.set(emote_name, emote_data)
    }
    return emotes
  }

  async seventv_emotes(): Promise<SevenTVEmotes> {
    const emote_set_ids = [
      "01GN2QZDS0000BKRM8E4JJD3NV", // vedal
      "01JKCEZS0D4MGWVNGKQWBTWSYT", // swarmfm whisper
      "01JKCF444J7HTNKE4TEQ0DBP1F", // swarmfm emotes
      "01K1H87ZZVE92Y3Z37H3ES6BK8", // dafox
      "01HKQT8EWR000ESSWF3625XCS4", // global
    ]

    let emote_sets = await this.ctx.storage.get<SevenTVEmotesCache>("seventv_emotes")
    if (emote_sets === undefined || emote_sets.expires_at < Date.now() / 1000) {
      const emotes = new Map() as SevenTVEmotes
      for (const emote_set_id of emote_set_ids.toReversed()) {
        const set_emotes = await this.get_seventv_emote_set(emote_set_id)
        set_emotes.forEach((emote_data, emote_name) => {
          emotes.set(emote_name, emote_data)
        })
      }
      emote_sets = { data: emotes, expires_at: Date.now() / 1000 + 86400 }
      await this.ctx.storage.put("seventv_emotes", emote_sets)
    }
    return emote_sets.data
  }

  private async ensure_admin(request: Request, _allow_dev: boolean = true): Promise<boolean> {
    const cookie_header = request.headers.get("cookie")
    if (cookie_header) {
      const cookies = cookie_header.split(";")
      for (const cookie of cookies) {
        const [key, value] = cookie.trim().split("=")
        if (key === "swarm_fm_player_session") {
          const session = await this.twitch_session_check(value)
          if (session && (await this.hasRole(session.user_id, "mod"))) {
            return true
          }
        }
      }
    }
    return false
  }

  async flush_emote_cache(request: Request): Promise<Response> {
    if (!(await this.ensure_admin(request))) {
      return new Response("Unauthorized", { status: 401 })
    }

    await this.ctx.storage.delete("twitch_emotes")
    await this.ctx.storage.delete("seventv_emotes")
    return new Response("OK")
  }

  async session_debug(request: Request): Promise<Response> {
    if (!(await this.ensure_admin(request))) {
      return new Response("Unauthorized", { status: 401 })
    }

    const ws_connections = this.ctx.getWebSockets()
    const ws_connection_count = ws_connections.length
    const sessions = new Map(this.sessions)
    const session_count = sessions.size
    let output = "Connection count: " + ws_connection_count + "\n"
    output += "Session count: " + session_count + "\n"
    for (let i = 0; i < ws_connections.length; i++) {
      const ws = ws_connections[i]
      output += `${i}: state: ${ws.readyState}\n`
      const session = sessions.get(ws)
      if (session) {
        output += `  auth: ${session.authenticated} hist: ${session.history_requested} `
        if (session.authenticated) {
          output += `name: ${session.name}`
        } else {
          output += `ip: ${session.client_ip}`
        }
        output += "\n"
        sessions.delete(ws)
      }
    }
    output += "\nSessions without WS connection:\n"
    for (const session of sessions.values()) {
      output += `${JSON.stringify(session)}\n`
    }
    return new Response(output)
  }

  async admin_list(): Promise<string[]> {
    return await this.getUsersWithRole("mod")
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
      return stub.flush_emote_cache(request)
    } else if (url.pathname === "/session_debug") {
      return stub.session_debug(request)
    } else if (url.pathname.startsWith("/7tv/")) {
      return seventv_cache_proxy(request)
    }

    return await sveltekit_worker.fetch(request, env, _ctx)
  },
} satisfies ExportedHandler<Env>

async function seventv_cache_proxy(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.substring("/7tv/".length)
  if (!(path.toLowerCase().endsWith(".avif") || path.toLowerCase().endsWith(".webp"))) {
    return new Response("Unsupported image format", { status: 400 })
  }
  return await fetch(`https://cdn.7tv.app/${path}`)
}
