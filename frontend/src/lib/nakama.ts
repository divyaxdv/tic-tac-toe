import { Client, Session, Socket } from "@heroiclabs/nakama-js";

const NAKAMA_SERVER_KEY = "defaultkey";
const NAKAMA_HOST = "127.0.0.1";
const NAKAMA_PORT = "7350";
const NAKAMA_USE_SSL = false;

let client: Client;
let session: Session;
let socket: Socket;

export function getClient(): Client {
  if (!client) {
    client = new Client(
      NAKAMA_SERVER_KEY,
      NAKAMA_HOST,
      NAKAMA_PORT,
      NAKAMA_USE_SSL
    );
  }
  return client;
}

export async function authenticate(): Promise<Session> {
  const cl = getClient();
  const deviceId = getOrCreateDeviceId();
  session = await cl.authenticateDevice(deviceId, true);
  return session;
}

export function getSession(): Session {
  return session;
}

export async function connectSocket(): Promise<Socket> {
  const cl = getClient();
  socket = cl.createSocket(NAKAMA_USE_SSL, false);
  await socket.connect(session, true);
  return socket;
}

export function getSocket(): Socket {
  return socket;
}

export async function findMatch(): Promise<string> {
  const cl = getClient();
  const rpcResult = await cl.rpc(session, "find_match", {});
  const payload = rpcResult.payload as { matchId: string };
  return payload.matchId;
}

function getOrCreateDeviceId(): string {
  const key = "nakama_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
