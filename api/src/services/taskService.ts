import { PrismaClient } from "@prisma/client";
import type {
    Task,
    CreateTaskPayload,
    UpdateTaskPayload,
    MoveTaskPayload,
    DeleteTaskPayload,
    ServiceResult,
} from "../types/index.js";
import { generatePositionAtEnd } from "../utils/fractional.js";
import { randomUUID } from "crypto";

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
});

const taskCache = new Map<string, Task>();
let cacheReady = false;

export async function initCache(): Promise<void> {
    taskCache.clear();
    const tasks = await prisma.task.findMany({
        orderBy: [{ column: "asc" }, { position: "asc" }],
    });
    for (const task of tasks) {
        taskCache.set(task.id, task as Task);
    }
    cacheReady = true;
}

export function clearCache(): void {
    taskCache.clear();
}

const BATCH_SIZE = 5;
const FLUSH_INTERVAL_MS = 10 * 60 * 1000;

const writeBuffer: Array<() => Promise<unknown>> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function startFlushTimer(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushWriteBuffer();
    }, FLUSH_INTERVAL_MS);
}

export async function flushWriteBuffer(): Promise<void> {
    if (writeBuffer.length === 0) return;

    const ops = writeBuffer.splice(0, writeBuffer.length);

    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    const results = await Promise.allSettled(ops.map((op) => op()));
    const failed = results.filter((r) => r.status === "rejected");

    if (failed.length > 0) {
        console.error(`[Cache] ${failed.length}/${ops.length} writes failed`);
    } else {
        console.log(`[Cache] Flushed ${ops.length} writes successfully`);
    }
}

function persistToDb(operation: () => Promise<unknown>): void {
    writeBuffer.push(operation);
    startFlushTimer();
    if (writeBuffer.length >= BATCH_SIZE) {
        flushWriteBuffer();
    }
}

export async function getAllTasks(): Promise<Task[]> {
    if (!cacheReady) {
        await initCache();
    }
    const tasks = Array.from(taskCache.values());
    tasks.sort((a, b) => {
        if (a.column !== b.column) return a.column.localeCompare(b.column);
        return a.position.localeCompare(b.position);
    });
    return tasks;
}

export async function createTask(
    payload: CreateTaskPayload,
    userId: string
): Promise<Task> {
    let position = payload.position;
    if (!position) {
        const columnTasks = Array.from(taskCache.values())
            .filter((t) => t.column === payload.column)
            .sort((a, b) => a.position.localeCompare(b.position));
        const lastPos = columnTasks.length > 0 ? columnTasks[columnTasks.length - 1].position : null;
        position = generatePositionAtEnd(lastPos);
    }

    const now = new Date();
    const task: Task = {
        id: randomUUID(),
        title: payload.title,
        description: payload.description || "",
        column: payload.column,
        position,
        version: 1,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
    };

    taskCache.set(task.id, task);

    persistToDb(() =>
        prisma.task.create({
            data: {
                id: task.id,
                title: task.title,
                description: task.description,
                column: task.column,
                position: task.position,
                createdBy: task.createdBy,
            },
        })
    );

    return task;
}

export async function updateTask(
    payload: UpdateTaskPayload
): Promise<ServiceResult<Task>> {
    const existing = taskCache.get(payload.id);

    if (!existing) {
        return {
            success: false,
            conflict: {
                taskId: payload.id,
                message: "Task not found — it may have been deleted",
                serverState: null as unknown as Task,
                type: "not_found",
            },
        };
    }

    if (existing.version !== payload.version) {
        return {
            success: false,
            conflict: {
                taskId: payload.id,
                message: `Task was edited by another user (your version: ${payload.version}, server version: ${existing.version})`,
                serverState: existing,
                type: "version_conflict",
            },
        };
    }

    const updated: Task = {
        ...existing,
        title: payload.title !== undefined ? payload.title : existing.title,
        description: payload.description !== undefined ? payload.description : existing.description,
        version: existing.version + 1,
        updatedAt: new Date(),
    };

    taskCache.set(updated.id, updated);

    persistToDb(() =>
        prisma.task.update({
            where: { id: payload.id },
            data: {
                title: updated.title,
                description: updated.description,
                version: updated.version,
            },
        })
    );

    return { success: true, data: updated };
}

export async function moveTask(
    payload: MoveTaskPayload
): Promise<ServiceResult<Task>> {
    const existing = taskCache.get(payload.id);

    if (!existing) {
        return {
            success: false,
            conflict: {
                taskId: payload.id,
                message: "Task not found — it may have been deleted",
                serverState: null as unknown as Task,
                type: "not_found",
            },
        };
    }

    if (existing.version !== payload.version) {
        return {
            success: false,
            conflict: {
                taskId: payload.id,
                message: `Task was moved by another user (your version: ${payload.version}, server version: ${existing.version})`,
                serverState: existing,
                type: "move_conflict",
            },
        };
    }

    const updated: Task = {
        ...existing,
        column: payload.column,
        position: payload.position,
        version: existing.version + 1,
        updatedAt: new Date(),
    };

    taskCache.set(updated.id, updated);

    persistToDb(() =>
        prisma.task.update({
            where: { id: payload.id },
            data: {
                column: updated.column,
                position: updated.position,
                version: updated.version,
            },
        })
    );

    return { success: true, data: updated };
}

export async function deleteTask(
    payload: DeleteTaskPayload
): Promise<ServiceResult<{ id: string }>> {
    const existing = taskCache.get(payload.id);

    if (!existing) {
        return {
            success: false,
            conflict: {
                taskId: payload.id,
                message: "Task not found — it may have been already deleted",
                serverState: null as unknown as Task,
                type: "not_found",
            },
        };
    }

    if (existing.version !== payload.version) {
        return {
            success: false,
            conflict: {
                taskId: payload.id,
                message: "Task was modified by another user since you last saw it",
                serverState: existing,
                type: "version_conflict",
            },
        };
    }

    taskCache.delete(payload.id);

    persistToDb(() =>
        prisma.task.delete({ where: { id: payload.id } })
    );

    return { success: true, data: { id: payload.id } };
}

export { prisma };
