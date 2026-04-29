export const HEARTBEAT_INTERVAL_MS = 15_000;
export const INITIAL_RECONNECT_DELAY_MS = 500;
export const MAX_RECONNECT_DELAY_MS = 10_000;

export const API_KEY_HEADER = "x-api-key";

export const SOCKET_EVENT_CONNECT = "connect";
export const SOCKET_EVENT_DISCONNECT = "disconnect";
export const SOCKET_EVENT_CONNECT_ERROR = "connect_error";
export const SOCKET_EVENT_PING = "ping";

export const SOCKET_EVENT_START_TYPING = "startTyping";
export const SOCKET_EVENT_STOP_TYPING = "stopTyping";

export const EVENT_USER_ONLINE = "user_online";
export const EVENT_USER_OFFLINE = "user_offline";
export const EVENT_TYPING_START = "typing_start";
export const EVENT_TYPING_STOP = "typing_stop";

export const PRESENCE_BATCH_PATH = "/presence/batch";
