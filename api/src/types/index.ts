import { z } from "zod";

export const COLUMNS = ["todo", "inprogress", "done"] as const;
export type Column = (typeof COLUMNS)[number];

export interface Task {
    id: string;
    title: string;
    description: string;
    column: Column;
    position: string;
    version: number;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserPresence {
    id: string;
    username: string;
    color: string;
    activeTaskId?: string;
    lastSeen: Date;
}

export interface CreateTaskPayload {
    title: string;
    description?: string;
    column: Column;
    position?: string;
}

export interface UpdateTaskPayload {
    id: string;
    title?: string;
    description?: string;
    version: number;
}

export interface MoveTaskPayload {
    id: string;
    column: Column;
    position: string;
    version: number;
}

export interface DeleteTaskPayload {
    id: string;
    version: number;
}

export interface PresencePayload {
    username: string;
    color: string;
    activeTaskId?: string;
}

export interface ConflictInfo {
    taskId: string;
    message: string;
    serverState: Task;
    type: "move_conflict" | "version_conflict" | "not_found";
}

export type ServiceResult<T> =
    | { success: true; data: T }
    | { success: false; conflict: ConflictInfo };

export interface BoardState {
    tasks: Task[];
    users: UserPresence[];
}

export const createTaskSchema = z.object({
    title: z.string().min(1, "Title is required").max(200, "Title too long"),
    description: z.string().max(2000, "Description too long").optional().default(""),
    column: z.enum(COLUMNS).default("todo"),
    position: z.string().optional(),
});

export const updateTaskSchema = z.object({
    id: z.string().uuid("Invalid task ID"),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    version: z.number().int().positive("Version must be positive"),
});

export const moveTaskSchema = z.object({
    id: z.string().uuid("Invalid task ID"),
    column: z.enum(COLUMNS),
    position: z.string().min(1, "Position is required"),
    version: z.number().int().positive("Version must be positive"),
});

export const deleteTaskSchema = z.object({
    id: z.string().uuid("Invalid task ID"),
    version: z.number().int().positive("Version must be positive"),
});

export const presenceSchema = z.object({
    username: z.string().min(1).max(50),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color hex"),
    activeTaskId: z.string().uuid().optional(),
});
