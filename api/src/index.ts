import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import env from "./config/env.js";
import taskRoutes from "./routes/taskRoutes.js";
import { registerTaskHandlers } from "./handlers/taskHandlers.js";
import { initCache, flushWriteBuffer } from "./services/taskService.js";

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
    env.CLIENT_URL,
    "http://localhost:5173",
    "http://localhost:3000",
];

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
                return callback(null, true);
            }
            callback(new Error("Not allowed by CORS"));
        },
        credentials: true,
    })
);

app.use(express.json());

app.use("/api", taskRoutes);

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
    },
});

io.on("connection", (socket) => {
    registerTaskHandlers(io, socket);
});

initCache().then(() => {
    httpServer.listen(env.PORT, () => {
        console.log(`Server running on port ${env.PORT}`);
    });
}).catch((err) => {
    console.error("Failed to initialize cache:", err);
    process.exit(1);
});

const shutdown = async () => {
    console.log("[Server] Shutting down — flushing write buffer...");
    await flushWriteBuffer();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app, httpServer, io };
