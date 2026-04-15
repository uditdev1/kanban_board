import type { Server, Socket } from "socket.io";
import * as taskService from "../services/taskService.js";
import {
    createTaskSchema,
    updateTaskSchema,
    moveTaskSchema,
    deleteTaskSchema,
    presenceSchema,
} from "../types/index.js";
import type { UserPresence } from "../types/index.js";
import { z } from "zod";

const activitySchema = z.object({
    taskId: z.string().uuid().optional(),
});

const connectedUsers = new Map<string, UserPresence>();

export function registerTaskHandlers(io: Server, socket: Socket) {
    const userId = socket.id;

    const sendBoardState = async () => {
        try {
            const tasks = await taskService.getAllTasks();
            const users = Array.from(connectedUsers.values());
            socket.emit("board:state", { tasks, users });
        } catch (error) {
            socket.emit("error", { message: "Failed to load board state" });
        }
    };

    sendBoardState();

    socket.on("presence:join", (data: unknown) => {
        const parsed = presenceSchema.safeParse(data);
        if (!parsed.success) {
            socket.emit("error", { message: "Invalid presence data", errors: parsed.error.flatten() });
            return;
        }

        const presence: UserPresence = {
            id: userId,
            username: parsed.data.username,
            color: parsed.data.color,
            lastSeen: new Date(),
        };

        connectedUsers.set(userId, presence);
        io.emit("presence:update", Array.from(connectedUsers.values()));
    });

    socket.on("presence:activity", (data: unknown) => {
        const user = connectedUsers.get(userId);
        if (!user) return;

        const parsed = activitySchema.safeParse(data);
        user.activeTaskId = parsed.success ? parsed.data.taskId : undefined;
        user.lastSeen = new Date();
        io.emit("presence:update", Array.from(connectedUsers.values()));
    });

    socket.on("task:create", async (data: unknown) => {
        const parsed = createTaskSchema.safeParse(data);
        if (!parsed.success) {
            socket.emit("error", { message: "Invalid task data", errors: parsed.error.flatten() });
            return;
        }

        try {
            const task = await taskService.createTask(parsed.data, userId);
            io.emit("task:created", task);
        } catch (error) {
            socket.emit("error", { message: "Failed to create task" });
        }
    });

    socket.on("task:update", async (data: unknown) => {
        const parsed = updateTaskSchema.safeParse(data);
        if (!parsed.success) {
            socket.emit("error", { message: "Invalid update data", errors: parsed.error.flatten() });
            return;
        }

        try {
            const result = await taskService.updateTask(parsed.data);

            if (result.success) {
                io.emit("task:updated", result.data);
            } else {
                socket.emit("task:conflict", result.conflict);
            }
        } catch (error) {
            socket.emit("error", { message: "Failed to update task" });
        }
    });

    socket.on("task:move", async (data: unknown) => {
        const parsed = moveTaskSchema.safeParse(data);
        if (!parsed.success) {
            socket.emit("error", { message: "Invalid move data", errors: parsed.error.flatten() });
            return;
        }

        try {
            const result = await taskService.moveTask(parsed.data);

            if (result.success) {
                io.emit("task:moved", result.data);
            } else {
                socket.emit("task:conflict", result.conflict);
            }
        } catch (error) {
            socket.emit("error", { message: "Failed to move task" });
        }
    });

    socket.on("task:delete", async (data: unknown) => {
        const parsed = deleteTaskSchema.safeParse(data);
        if (!parsed.success) {
            socket.emit("error", { message: "Invalid delete data", errors: parsed.error.flatten() });
            return;
        }

        try {
            const result = await taskService.deleteTask(parsed.data);

            if (result.success) {
                io.emit("task:deleted", result.data);
            } else {
                socket.emit("task:conflict", result.conflict);
            }
        } catch (error) {
            socket.emit("error", { message: "Failed to delete task" });
        }
    });

    socket.on("board:sync", async () => {
        await sendBoardState();
    });

    socket.on("disconnect", () => {
        connectedUsers.delete(userId);
        io.emit("presence:update", Array.from(connectedUsers.values()));
    });
}
