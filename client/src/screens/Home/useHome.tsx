import { useState, useEffect, useCallback, useRef } from "react";
import { connectSocket, getSocket } from "../../services/socketService";
import type { Task, UserPresence, Column, ConflictInfo, UnresolvedConflict, PendingAttempt, QueuedAction } from "../../types";
import { generatePositionAtEnd } from "../../utils/fractional";
import { useOfflineQueue, buildPendingTask, saveDisconnectTime, loadDisconnectTime, clearDisconnectTime } from "../../hooks/useOfflineQueue";
import toast from "react-hot-toast";

const ADJECTIVES = ["Swift", "Calm", "Bold", "Keen", "Wise", "Kind", "Warm", "Cool", "Fast", "Pure"];
const NOUNS = ["Fox", "Owl", "Bear", "Wolf", "Hawk", "Lynx", "Deer", "Seal", "Dove", "Wren"];
const COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];

function generateUsername(): string {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj}${noun}${num}`;
}

function generateColor(): string {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
}

const useHome = () => {
    const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
    const tasksRef = useRef<Map<string, Task>>(new Map());
    const [users, setUsers] = useState<UserPresence[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [currentUser, setCurrentUser] = useState<{ username: string; color: string } | null>(null);
    const [unresolvedConflicts, setUnresolvedConflicts] = useState<UnresolvedConflict[]>([]);

    const { queue: offlineQueue, enqueue, clearQueue, replayQueue, queueRef } = useOfflineQueue();

    const pendingIds = useRef<Set<string>>(new Set());
    const pendingAttempts = useRef<Map<string, PendingAttempt>>(new Map());

    useEffect(() => {
        offlineQueue.forEach((action) => {
            if (action.type === "task:create") pendingIds.current.add(action.localId);
            else if ("payload" in action && "id" in action.payload) {
                pendingIds.current.add((action.payload as { id: string }).id);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    const getTasksByColumn = useCallback(
        (column: Column): Task[] => {
            const result: Task[] = [];
            tasks.forEach((task) => {
                if (task.column === column) result.push(task);
            });
            return result.sort((a, b) => a.position.localeCompare(b.position));
        },
        [tasks]
    );

    useEffect(() => {
        let username = sessionStorage.getItem("kanban-username");
        let color = sessionStorage.getItem("kanban-color");

        if (!username) {
            username = generateUsername();
            color = generateColor();
            sessionStorage.setItem("kanban-username", username);
            sessionStorage.setItem("kanban-color", color!);
        }

        setCurrentUser({ username, color: color || generateColor() });
    }, []);

    useEffect(() => {
        if (!currentUser || offlineQueue.length === 0) return;

        setTasks((prev) => {
            const next = new Map(prev);
            offlineQueue.forEach((action) => {
                if (action.type === "task:create" && !next.has(action.localId)) {
                    const position = action.payload.position ?? generatePositionAtEnd(null);
                    const pendingTask = buildPendingTask(
                        action.localId,
                        action.payload.title,
                        action.payload.description ?? "",
                        action.payload.column,
                        position,
                        currentUser.username
                    );
                    next.set(action.localId, pendingTask);
                    pendingIds.current.add(action.localId);
                }
            });
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) return;

        const socket = connectSocket();

        socket.on("connect", () => {
            setIsConnected(true);
            setIsReconnecting(false);

            socket.emit("presence:join", {
                username: currentUser.username,
                color: currentUser.color,
            });

            const currentQueue = queueRef.current;
            const disconnectedAt = loadDisconnectTime();

            if (currentQueue.length > 0 && disconnectedAt) {
                setIsSyncing(true);

                socket.once("board:state", (data: { tasks: Task[] }) => {
                    const serverTaskMap = new Map<string, Task>();
                    data.tasks.forEach((t) => serverTaskMap.set(t.id, t));

                    const conflicts: UnresolvedConflict[] = [];
                    const safeToReplay: QueuedAction[] = [];

                    currentQueue.forEach((action) => {
                        if (action.type === "task:create") {
                            safeToReplay.push(action);
                            return;
                        }

                        const taskId = action.payload.id;
                        const serverTask = serverTaskMap.get(taskId);

                        if (!serverTask) {
                            if (action.type === "task:delete") {
                                return;
                            }
                            const existingTask = tasksRef.current.get(taskId) ?? action.taskSnapshot;
                            if (existingTask) {
                                let localVersion: Task = { ...existingTask };
                                if (action.type === "task:update") {
                                    if (action.payload.title !== undefined) localVersion.title = action.payload.title;
                                    if (action.payload.description !== undefined) localVersion.description = action.payload.description;
                                } else if (action.type === "task:move") {
                                    localVersion.column = action.payload.column;
                                    localVersion.position = action.payload.position;
                                }
                                conflicts.push({
                                    taskId,
                                    yourVersion: localVersion,
                                    serverVersion: null,
                                    action,
                                    conflictKind: "they_deleted_you_edited",
                                });
                            }
                            return;
                        }

                        const serverUpdated = new Date(serverTask.updatedAt).getTime();
                        const disconnectTime = new Date(disconnectedAt).getTime();

                        if (serverUpdated > disconnectTime) {
                            if (action.type === "task:delete") {
                                conflicts.push({
                                    taskId,
                                    yourVersion: serverTask,
                                    serverVersion: serverTask,
                                    action,
                                    conflictKind: "you_deleted_they_edited",
                                });
                            } else {
                                const existingTask = tasksRef.current.get(taskId) ?? action.taskSnapshot;
                                const yourVersion = existingTask || serverTask;

                                let localVersion: Task = { ...yourVersion };
                                if (action.type === "task:update") {
                                    if (action.payload.title !== undefined) localVersion.title = action.payload.title;
                                    if (action.payload.description !== undefined) localVersion.description = action.payload.description;
                                } else if (action.type === "task:move") {
                                    localVersion.column = action.payload.column;
                                    localVersion.position = action.payload.position;
                                }

                                conflicts.push({
                                    taskId,
                                    yourVersion: localVersion,
                                    serverVersion: serverTask,
                                    action,
                                    conflictKind: "edit_vs_edit",
                                });
                            }
                        } else {
                            safeToReplay.push(action);
                        }
                    });

                    clearDisconnectTime();

                    if (conflicts.length > 0) {
                        setUnresolvedConflicts(conflicts);
                        toast(`${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""} found — please resolve`, {
                            icon: "⚡",
                            id: "conflicts",
                            duration: 5000,
                        });
                    }

                    if (safeToReplay.length > 0) {
                        safeToReplay.forEach((action) => {
                            if (action.type === "task:create") {
                                socket.emit(action.type, action.payload);
                                socket.once("task:created", (task: Task) => {
                                    setTasks((prev) => {
                                        const next = new Map(prev);
                                        next.delete(action.localId);
                                        next.set(task.id, { ...task, pending: false });
                                        return next;
                                    });
                                    pendingIds.current.delete(action.localId);
                                });
                            } else {
                                socket.emit(action.type, action.payload);
                            }
                        });
                    }

                    clearQueue();

                    setIsSyncing(false);
                });

                socket.emit("board:sync");
            } else if (currentQueue.length > 0) {
                toast(`Syncing ${currentQueue.length} offline change${currentQueue.length > 1 ? "s" : ""}...`, {
                    icon: "🔄",
                    id: "syncing",
                });
                setIsSyncing(true);
                replayQueue(socket, (localId: string, confirmedTask: Task) => {
                    setTasks((prev) => {
                        const next = new Map(prev);
                        next.delete(localId);
                        next.set(confirmedTask.id, { ...confirmedTask, pending: false });
                        return next;
                    });
                    pendingIds.current.delete(localId);
                });
            } else {
                clearDisconnectTime();
            }
        });

        socket.on("disconnect", (reason) => {
            setIsConnected(false);
            setIsSyncing(false);
            if (reason !== "io client disconnect") {
                setIsReconnecting(true);
                saveDisconnectTime();
                toast.error("Connection lost — changes will sync when reconnected");
            }
        });

        socket.on("reconnect_attempt", () => setIsReconnecting(true));

        socket.on("board:state", (data: { tasks: Task[]; users: UserPresence[] }) => {
            setTasks((prev) => {
                const next = new Map<string, Task>();
                data.tasks.forEach((t) => next.set(t.id, t));
                prev.forEach((task) => {
                    const hasPendingAttempt = pendingAttempts.current.has(task.id);
                    if (task.pending && !next.has(task.id)) {
                        next.set(task.id, task);
                    } else if (hasPendingAttempt) {
                        next.set(task.id, task);
                    }
                });
                tasksRef.current = next;
                return next;
            });
            setUsers(data.users);
        });

        socket.on("task:created", (task: Task) => {
            setTasks((prev) => {
                const next = new Map(prev);
                next.set(task.id, task);
                return next;
            });
            pendingAttempts.current.delete(task.id);
        });

        socket.on("task:updated", (task: Task) => {
            setTasks((prev) => {
                const next = new Map(prev);
                const existing = next.get(task.id);
                if (pendingAttempts.current.has(task.id)) {
                    pendingAttempts.current.delete(task.id);
                    return prev;
                }
                next.set(task.id, existing ? { ...existing, ...task, pending: false } : task);
                return next;
            });
        });

        socket.on("task:moved", (task: Task) => {
            setTasks((prev) => {
                const next = new Map(prev);
                const existing = next.get(task.id);
                if (pendingAttempts.current.has(task.id)) {
                    pendingAttempts.current.delete(task.id);
                    return prev;
                }
                if (existing) next.set(task.id, { ...existing, ...task, pending: false });
                return next;
            });
        });

        socket.on("task:deleted", (data: { id: string }) => {
            if (pendingIds.current.has(data.id)) {
                return;
            }
            setTasks((prev) => {
                const next = new Map(prev);
                const deleted = next.get(data.id);
                if (deleted && !deleted.pending) {
                    toast(`Task "${deleted.title}" was deleted by another user`, {
                        icon: "🗑️",
                        duration: 3000,
                        id: `deleted-${data.id}`,
                    });
                }
                next.delete(data.id);
                return next;
            });
            pendingIds.current.delete(data.id);
            pendingAttempts.current.delete(data.id);
        });

        socket.on("presence:update", (userList: UserPresence[]) => setUsers(userList));

        socket.on("task:conflict", (conflict: ConflictInfo) => {
            const attempt = pendingAttempts.current.get(conflict.taskId);

            if (conflict.type === "not_found") {
                setTasks((prev) => {
                    const next = new Map(prev);
                    next.delete(conflict.taskId);
                    return next;
                });
                pendingAttempts.current.delete(conflict.taskId);
                toast(`Task was deleted by another user`, { icon: "🗑️", duration: 3000 });
                return;
            }

            if (attempt && conflict.serverState) {
                setUnresolvedConflicts((prev) => [
                    ...prev,
                    {
                        taskId: conflict.taskId,
                        yourVersion: attempt.yourVersion,
                        serverVersion: conflict.serverState,
                        action: attempt.action,
                        conflictKind: "edit_vs_edit",
                    },
                ]);
                setTasks((prev) => {
                    const next = new Map(prev);
                    next.set(conflict.taskId, { ...conflict.serverState, pending: false });
                    return next;
                });
                pendingAttempts.current.delete(conflict.taskId);
            } else {
                if (conflict.serverState) {
                    setTasks((prev) => {
                        const next = new Map(prev);
                        next.set(conflict.taskId, { ...conflict.serverState, pending: false });
                        return next;
                    });
                }
                toast.error(conflict.message);
            }
        });

        socket.on("error", (error: { message: string }) => {
            toast.error(error.message);
        });

        return () => {
            socket.off("connect");
            socket.off("disconnect");
            socket.off("reconnect_attempt");
            socket.off("board:state");
            socket.off("task:created");
            socket.off("task:updated");
            socket.off("task:moved");
            socket.off("task:deleted");
            socket.off("task:conflict");
            socket.off("presence:update");
            socket.off("error");
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser]);

    const handleCreateTask = useCallback(
        (title: string, description: string, column: Column) => {
            const socket = getSocket();
            const columnTasks = getTasksByColumn(column);
            const lastPos = columnTasks.length > 0 ? columnTasks[columnTasks.length - 1].position : null;
            const position = generatePositionAtEnd(lastPos);

            if (socket.connected) {
                socket.emit("task:create", { title, description, column, position });
            } else {
                const localId = crypto.randomUUID();
                const pendingTask = buildPendingTask(
                    localId, title, description, column, position,
                    currentUser?.username ?? "you"
                );
                setTasks((prev) => {
                    const next = new Map(prev);
                    next.set(localId, pendingTask);
                    return next;
                });
                pendingIds.current.add(localId);
                enqueue({ type: "task:create", localId, payload: { title, description, column, position } });
                toast("Task saved offline — will sync when reconnected", { icon: "📴", id: "offline-queue" });
            }
        },
        [enqueue, getTasksByColumn, currentUser]
    );

    const handleEditTask = useCallback(
        (id: string, title: string, description: string, version: number) => {
            const socket = getSocket();
            const existingTask = tasks.get(id);
            if (!existingTask) return;

            const yourVersion: Task = { ...existingTask, title, description, version: version + 1, pending: false };
            const action: QueuedAction = { type: "task:update", payload: { id, title, description, version }, taskSnapshot: yourVersion };

            setTasks((prev) => {
                const next = new Map(prev);
                next.set(id, { ...yourVersion, pending: !socket.connected });
                return next;
            });

            if (socket.connected) {
                pendingAttempts.current.set(id, { yourVersion, action });
                socket.emit("task:update", { id, title, description, version });
            } else {
                pendingIds.current.add(id);
                enqueue(action);
                toast("Edit saved offline — will sync when reconnected", { icon: "📴", id: "offline-queue" });
            }
        },
        [enqueue, tasks]
    );

    const handleDeleteTask = useCallback(
        (id: string, version: number) => {
            const socket = getSocket();
            setTasks((prev) => {
                const next = new Map(prev);
                next.delete(id);
                return next;
            });
            pendingIds.current.delete(id);
            pendingAttempts.current.delete(id);

            if (socket.connected) {
                socket.emit("task:delete", { id, version });
            } else {
                enqueue({ type: "task:delete", payload: { id, version } });
                toast("Delete saved offline — will sync when reconnected", { icon: "📴", id: "offline-queue" });
            }
        },
        [enqueue]
    );

    const moveTaskLocally = useCallback(
        (id: string, column: Column, position: string) => {
            setTasks((prev) => {
                const next = new Map(prev);
                const existing = next.get(id);
                if (!existing) return prev;
                next.set(id, { ...existing, column, position });
                return next;
            });
        },
        []
    );

    const handleMoveTask = useCallback(
        (id: string, column: Column, position: string, version: number) => {
            const socket = getSocket();
            const existingTask = tasks.get(id);
            if (!existingTask) return;

            const yourVersion: Task = { ...existingTask, column, position, version: version + 1, pending: false };
            const action: QueuedAction = { type: "task:move", payload: { id, column, position, version }, taskSnapshot: yourVersion };

            setTasks((prev) => {
                const next = new Map(prev);
                next.set(id, { ...yourVersion, pending: !socket.connected });
                return next;
            });

            if (socket.connected) {
                pendingAttempts.current.set(id, { yourVersion, action });
                socket.emit("task:move", { id, column, position, version });
            } else {
                pendingIds.current.add(id);
                enqueue(action);
                toast("Move saved offline — will sync when reconnected", { icon: "📴", id: "offline-queue" });
            }
        },
        [enqueue, tasks]
    );

    const resolveConflict = useCallback(
        (taskId: string, pick: "mine" | "theirs") => {
            const socket = getSocket();

            setUnresolvedConflicts((prev) => {
                const conflict = prev.find((c) => c.taskId === taskId);
                if (!conflict) return prev;

                const { conflictKind, action, serverVersion, yourVersion } = conflict;

                if (conflictKind === "you_deleted_they_edited") {
                    if (pick === "mine") {
                        if (serverVersion) {
                            socket.emit("task:delete", { id: taskId, version: serverVersion.version });
                        }
                        setTasks((p) => {
                            const next = new Map(p);
                            next.delete(taskId);
                            return next;
                        });
                    } else {
                        if (serverVersion) {
                            setTasks((p) => {
                                const next = new Map(p);
                                next.set(taskId, { ...serverVersion, pending: false });
                                return next;
                            });
                        }
                    }
                } else if (conflictKind === "they_deleted_you_edited") {
                    if (pick === "mine") {
                        socket.emit("task:create", {
                            title: yourVersion.title,
                            description: yourVersion.description,
                            column: yourVersion.column,
                            position: yourVersion.position,
                        });
                        setTasks((p) => {
                            const next = new Map(p);
                            next.delete(taskId);
                            return next;
                        });
                        pendingIds.current.delete(taskId);
                    } else {
                        setTasks((p) => {
                            const next = new Map(p);
                            next.delete(taskId);
                            return next;
                        });
                    }
                } else {
                    if (pick === "mine") {
                        if (action.type === "task:update" && serverVersion) {
                            socket.emit("task:update", {
                                ...action.payload,
                                version: serverVersion.version,
                            });
                        } else if (action.type === "task:move" && serverVersion) {
                            socket.emit("task:move", {
                                ...action.payload,
                                version: serverVersion.version,
                            });
                        }
                        setTasks((p) => {
                            const next = new Map(p);
                            next.set(taskId, { ...yourVersion, pending: false });
                            return next;
                        });
                    } else {
                        if (serverVersion) {
                            setTasks((p) => {
                                const next = new Map(p);
                                next.set(taskId, { ...serverVersion, pending: false });
                                return next;
                            });
                        }
                    }
                }

                return prev.filter((c) => c.taskId !== taskId);
            });
        },
        []
    );

    return {
        tasks,
        users,
        isConnected,
        isReconnecting,
        isSyncing,
        offlineQueue,
        currentUser,
        unresolvedConflicts,
        resolveConflict,
        getTasksByColumn,
        handleCreateTask,
        handleEditTask,
        handleDeleteTask,
        handleMoveTask,
        moveTaskLocally,
        setTasks,
    };
};

export default useHome;
