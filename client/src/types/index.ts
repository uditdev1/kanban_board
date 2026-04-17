export const COLUMNS = ["todo", "inprogress", "done"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
    todo: "To Do",
    inprogress: "In Progress",
    done: "Done",
};

export const COLUMN_COLORS: Record<Column, string> = {
    todo: "#6366f1",
    inprogress: "#f59e0b",
    done: "#10b981",
};

export interface Task {
    id: string;
    title: string;
    description: string;
    column: Column;
    position: string;
    version: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    pending?: boolean;
    localId?: string;
}

export interface UserPresence {
    id: string;
    username: string;
    color: string;
    activeTaskId?: string;
    lastSeen: string;
}

export interface BoardState {
    tasks: Task[];
    users: UserPresence[];
}

export type QueuedAction =
    | {
        type: "task:create";
        localId: string;
        payload: { title: string; description?: string; column: Column; position?: string };
    }
    | { type: "task:update"; payload: { id: string; title?: string; description?: string; version: number }; taskSnapshot?: Task }
    | { type: "task:move"; payload: { id: string; column: Column; position: string; version: number }; taskSnapshot?: Task }
    | { type: "task:delete"; payload: { id: string; version: number }; taskSnapshot?: Task };

export interface ConflictInfo {
    taskId: string;
    message: string;
    serverState: Task;
    type: "move_conflict" | "version_conflict" | "not_found";
}

export interface PendingAttempt {
    yourVersion: Task;
    action: QueuedAction;
}

export interface UnresolvedConflict {
    taskId: string;
    yourVersion: Task;
    serverVersion: Task | null;
    action: QueuedAction;
    conflictKind: "edit_vs_edit" | "you_deleted_they_edited" | "they_deleted_you_edited";
}
