import { useState, useEffect, useCallback, useRef } from "react";
import type { QueuedAction, Task, Column } from "../types";
import type { Socket } from "socket.io-client";

const STORAGE_KEY = "kanban-offline-queue";
const DISCONNECT_TIME_KEY = "kanban-disconnect-time";

export function saveDisconnectTime(): void {
    try {
        localStorage.setItem(DISCONNECT_TIME_KEY, new Date().toISOString());
    } catch { /* noop */ }
}

export function loadDisconnectTime(): string | null {
    try {
        return localStorage.getItem(DISCONNECT_TIME_KEY);
    } catch {
        return null;
    }
}

export function clearDisconnectTime(): void {
    try {
        localStorage.removeItem(DISCONNECT_TIME_KEY);
    } catch { /* noop */ }
}

function loadFromStorage(): QueuedAction[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as QueuedAction[];
    } catch {
        return [];
    }
}

function saveToStorage(queue: QueuedAction[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch { /* noop */ }
}

export function useOfflineQueue() {
    const [queue, setQueue] = useState<QueuedAction[]>(loadFromStorage);

    const queueRef = useRef<QueuedAction[]>(queue);

    useEffect(() => {
        queueRef.current = queue;
        saveToStorage(queue);
    }, [queue]);

    const enqueue = useCallback((action: QueuedAction) => {
        setQueue((prev) => {
            if (action.type === "task:move" || action.type === "task:update") {
                const taskId = action.payload.id;
                const existingIndex = prev.findIndex(
                    (a) => a.type !== "task:create" && a.type === action.type && a.payload.id === taskId
                );
                if (existingIndex !== -1) {
                    const next = [...prev];
                    next[existingIndex] = action;
                    return next;
                }
            }
            return [...prev, action];
        });
    }, []);

    const removeByLocalId = useCallback((localId: string) => {
        setQueue((prev) => prev.filter((a) => {
            if (a.type === "task:create") return a.localId !== localId;
            return true;
        }));
    }, []);

    const clearQueue = useCallback(() => {
        setQueue([]);
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    }, []);

    const replayQueue = useCallback(
        (
            socket: Socket,
            onTaskCreated: (localId: string, task: Task) => void
        ) => {
            const current = queueRef.current;
            if (current.length === 0) return;

            socket.emit("board:sync");

            setTimeout(() => {
                current.forEach((action) => {
                    if (action.type === "task:create") {
                        socket.emit(action.type, action.payload);
                        socket.once("task:created", (task: Task) => {
                            onTaskCreated(action.localId, task);
                        });
                    } else {
                        socket.emit(action.type, action.payload);
                    }
                });
                setQueue([]);
                try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
            }, 600);
        },
        []
    );

    return {
        queue,
        enqueue,
        removeByLocalId,
        clearQueue,
        replayQueue,
        queueRef,
    };
}

export function buildPendingTask(
    localId: string,
    title: string,
    description: string,
    column: Column,
    position: string,
    createdBy: string
): Task {
    const now = new Date().toISOString();
    return {
        id: localId,
        localId,
        title,
        description,
        column,
        position,
        version: 1,
        createdBy,
        createdAt: now,
        updatedAt: now,
        pending: true,
    };
}
