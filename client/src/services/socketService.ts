import { io, Socket } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL || "";

let socket: Socket | null = null;

export function getSocket(): Socket {
    if (!socket) {
        socket = io(API_URL, {
            autoConnect: false,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 10000,
            transports: ["websocket", "polling"],
        });
    }
    return socket;
}

export function connectSocket(): Socket {
    const s = getSocket();
    if (!s.connected) {
        s.connect();
    }
    return s;
}

export function disconnectSocket(): void {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
