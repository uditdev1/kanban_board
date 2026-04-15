import {
    describe,
    test,
    expect,
    beforeAll,
    afterAll,
    afterEach,
    beforeEach,
} from "bun:test";
import { PrismaClient } from "@prisma/client";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { httpServer } from "../src/index";
import { flushWriteBuffer, clearCache, initCache } from "../src/services/taskService";
import { generatePositionAtEnd, generatePositionAtStart } from "../src/utils/fractional";

/**
 * Socket.IO handler integration tests.
 *
 * Each test spins up a real connected client against the same HTTP server
 * that Express uses. We listen for broadcasted events to verify correct
 * handler behaviour — including conflict paths.
 */

const prisma = new PrismaClient();
let port: number;

// ─── Utilities ───────────────────────────────────────────────

/**
 * Connect a new Socket.IO client and resolve only after the initial
 * `board:state` event is received. This prevents the beforeEach race
 * condition where the event fires before a second listener is attached.
 */
function connectClient(): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
        const client = ioc(`http://localhost:${port}`, {
            transports: ["websocket"],
            forceNew: true,
        });
        const timer = setTimeout(() => reject(new Error("connectClient timed out")), 5000);
        // Register board:state BEFORE connect fires to avoid race
        client.once("board:state", () => {
            clearTimeout(timer);
            resolve(client);
        });
        client.on("connect_error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/** Disconnect a client gracefully. */
function disconnectClient(client: ClientSocket): Promise<void> {
    return new Promise((resolve) => {
        if (!client.connected) return resolve();
        client.once("disconnect", () => resolve());
        client.disconnect();
    });
}

/**
 * Emit an event and await a specific response event.
 * Returns the payload of the response event.
 */
function emitAndWait<T>(
    client: ClientSocket,
    emitEvent: string,
    emitData: unknown,
    responseEvent: string,
    timeoutMs = 4000
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for "${responseEvent}"`)),
            timeoutMs
        );
        client.once(responseEvent, (data: T) => {
            clearTimeout(timer);
            resolve(data);
        });
        client.emit(emitEvent, emitData);
    });
}

/** Wait for a named event on an already-connected client. */
function waitForEvent<T>(client: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for "${event}"`)),
            timeoutMs
        );
        client.once(event, (data: T) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

// ─── Global Setup / Teardown ─────────────────────────────────

beforeAll(async () => {
    await prisma.$connect();

    await new Promise<void>((resolve) => {
        if (!httpServer.listening) {
            httpServer.listen(0, () => resolve());
        } else {
            resolve();
        }
    });

    const addr = httpServer.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 3001;
});

afterEach(async () => {
    await flushWriteBuffer();
    await prisma.task.deleteMany({});
    clearCache();
});

afterAll(async () => {
    await flushWriteBuffer();
    await prisma.$disconnect();
});

// ─── board:state on connect ───────────────────────────────────

describe("board:state on connect", () => {
    let client: ClientSocket;

    afterEach(async () => {
        await disconnectClient(client);
    });

    test("server sends board:state immediately upon connection", async () => {
        // This test manually creates the client so it can capture board:state assignation
        const boardStatePromise = new Promise<{ tasks: unknown[]; users: unknown[] }>(
            (resolve, reject) => {
                const c = ioc(`http://localhost:${port}`, {
                    transports: ["websocket"],
                    forceNew: true,
                });
                const timer = setTimeout(
                    () => reject(new Error("Timed out waiting for board:state")),
                    4000
                );
                c.once("board:state", (data) => {
                    clearTimeout(timer);
                    client = c;
                    resolve(data);
                });
                c.on("connect_error", reject);
            }
        );

        const state = await boardStatePromise;
        expect(Array.isArray(state.tasks)).toBe(true);
        expect(Array.isArray(state.users)).toBe(true);
    });

    test("board:state includes existing tasks seeded in the DB", async () => {
        await prisma.task.create({
            data: { title: "Seed Task", column: "todo", position: "a0", createdBy: "seed" },
        });
        await initCache();

        const boardStatePromise = new Promise<{ tasks: { title: string }[] }>(
            (resolve, reject) => {
                const c = ioc(`http://localhost:${port}`, {
                    transports: ["websocket"],
                    forceNew: true,
                });
                const timer = setTimeout(() => reject(new Error("timeout")), 4000);
                c.once("board:state", (data) => {
                    clearTimeout(timer);
                    client = c;
                    resolve(data);
                });
                c.on("connect_error", reject);
            }
        );

        const state = await boardStatePromise;
        expect(state.tasks.some((t) => t.title === "Seed Task")).toBe(true);
    });
});

// ─── board:sync ──────────────────────────────────────────────

describe("board:sync", () => {
    let client: ClientSocket;

    beforeEach(async () => { client = await connectClient(); });
    afterEach(async () => { await disconnectClient(client); });

    test("emitting board:sync triggers a fresh board:state response", async () => {
        const statePromise = waitForEvent<{ tasks: unknown[] }>(client, "board:state");
        client.emit("board:sync");
        const state = await statePromise;
        expect(Array.isArray(state.tasks)).toBe(true);
    });
});

// ─── presence:join ───────────────────────────────────────────

describe("presence:join", () => {
    let client: ClientSocket;

    beforeEach(async () => { client = await connectClient(); });
    afterEach(async () => { await disconnectClient(client); });

    test("valid presence join broadcasts presence:update listing the new user", async () => {
        const updatePromise = waitForEvent<{ username: string }[]>(client, "presence:update");
        client.emit("presence:join", { username: "alice", color: "#ff0000" });
        const users = await updatePromise;
        expect(users.some((u) => u.username === "alice")).toBe(true);
    });

    test("invalid presence data emits an error back to the sender", async () => {
        const errPromise = waitForEvent<{ message: string }>(client, "error");
        client.emit("presence:join", { username: "", color: "not-a-color" });
        const err = await errPromise;
        expect(err.message).toContain("Invalid presence data");
    });
});

// ─── task:create ─────────────────────────────────────────────

describe("task:create", () => {
    let client: ClientSocket;

    beforeEach(async () => { client = await connectClient(); });
    afterEach(async () => { await disconnectClient(client); });

    test("creates a task and broadcasts task:created with correct fields", async () => {
        const created = await emitAndWait<{ title: string; column: string; version: number }>(
            client,
            "task:create",
            { title: "Socket Task", column: "todo" },
            "task:created"
        );

        expect(created.title).toBe("Socket Task");
        expect(created.column).toBe("todo");
        expect(created.version).toBe(1);
    });

    test("created task is actually persisted to the database", async () => {
        await emitAndWait(client, "task:create", { title: "Persisted", column: "done" }, "task:created");

        await flushWriteBuffer();
        const task = await prisma.task.findFirst({ where: { title: "Persisted" } });
        expect(task).not.toBeNull();
        expect(task?.column).toBe("done");
    });

    test("invalid task:create payload emits an error to the sender", async () => {
        const err = await emitAndWait<{ message: string }>(
            client,
            "task:create",
            { title: "", column: "todo" }, // empty title is invalid
            "error"
        );
        expect(err.message).toContain("Invalid task data");
    });
});

// ─── task:update ─────────────────────────────────────────────

describe("task:update", () => {
    let client: ClientSocket;

    beforeEach(async () => { client = await connectClient(); });
    afterEach(async () => { await disconnectClient(client); });

    test("valid update broadcasts task:updated with incremented version", async () => {
        const task = await prisma.task.create({
            data: { title: "Old Title", column: "todo", position: "a0", createdBy: "u" },
        });
        await initCache();

        const updated = await emitAndWait<{ id: string; title: string; version: number }>(
            client,
            "task:update",
            { id: task.id, title: "New Title", version: task.version },
            "task:updated"
        );

        expect(updated.id).toBe(task.id);
        expect(updated.title).toBe("New Title");
        expect(updated.version).toBe(task.version + 1);
    });

    test("updating a deleted task emits task:conflict with type 'not_found'", async () => {
        const task = await prisma.task.create({
            data: { title: "Will Be Deleted", column: "todo", position: "a0", createdBy: "u" },
        });
        await prisma.task.delete({ where: { id: task.id } });
        await initCache();

        const conflict = await emitAndWait<{ type: string; taskId: string }>(
            client,
            "task:update",
            { id: task.id, title: "Ghost Edit", version: task.version },
            "task:conflict"
        );

        expect(conflict.type).toBe("not_found");
        expect(conflict.taskId).toBe(task.id);
    });

    test("invalid task:update payload emits an error to the sender", async () => {
        const err = await emitAndWait<{ message: string }>(
            client,
            "task:update",
            { id: "bad-uuid", title: "X", version: 1 },
            "error"
        );
        expect(err.message).toContain("Invalid update data");
    });
});

// ─── task:move ───────────────────────────────────────────────

describe("task:move", () => {
    let client: ClientSocket;

    beforeEach(async () => { client = await connectClient(); });
    afterEach(async () => { await disconnectClient(client); });

    test("valid move broadcasts task:moved with updated column and incremented version", async () => {
        const task = await prisma.task.create({
            data: { title: "Moveable", column: "todo", position: "a0", createdBy: "u" },
        });
        await initCache();

        const moved = await emitAndWait<{ id: string; column: string; version: number }>(
            client,
            "task:move",
            { id: task.id, column: "done", position: generatePositionAtEnd(null), version: task.version },
            "task:moved"
        );

        expect(moved.id).toBe(task.id);
        expect(moved.column).toBe("done");
        expect(moved.version).toBe(task.version + 1);
    });

    test("moving a non-existent task emits task:conflict with type 'not_found'", async () => {
        const fakeId = "00000000-0000-0000-0000-000000000001";

        const conflict = await emitAndWait<{ type: string; taskId: string }>(
            client,
            "task:move",
            { id: fakeId, column: "done", position: generatePositionAtEnd(null), version: 1 },
            "task:conflict"
        );

        expect(conflict.type).toBe("not_found");
        expect(conflict.taskId).toBe(fakeId);
    });

    test("move with stale version emits task:conflict with type 'move_conflict'", async () => {
        const task = await prisma.task.create({
            data: { title: "Stale Move", column: "todo", position: "a0", createdBy: "u" },
        });

        // Simulate another user having moved it first (bumps the version)
        await prisma.task.update({
            where: { id: task.id },
            data: { column: "inprogress", version: task.version + 1 },
        });
        await initCache();

        const conflict = await emitAndWait<{
            type: string;
            taskId: string;
            serverState: { column: string };
        }>(
            client,
            "task:move",
            { id: task.id, column: "done", position: generatePositionAtEnd(null), version: task.version },
            "task:conflict"
        );

        expect(conflict.type).toBe("move_conflict");
        expect(conflict.serverState.column).toBe("inprogress");
    });

    test("invalid task:move payload emits an error to the sender", async () => {
        const err = await emitAndWait<{ message: string }>(
            client,
            "task:move",
            { id: "not-a-uuid", column: "done", position: "a1", version: 1 },
            "error"
        );
        expect(err.message).toContain("Invalid move data");
    });
});

// ─── task:delete ─────────────────────────────────────────────

describe("task:delete", () => {
    let client: ClientSocket;

    beforeEach(async () => { client = await connectClient(); });
    afterEach(async () => { await disconnectClient(client); });

    test("valid delete broadcasts task:deleted and removes the task from DB", async () => {
        const task = await prisma.task.create({
            data: { title: "Delete Me", column: "todo", position: "a0", createdBy: "u" },
        });
        await initCache();

        const deleted = await emitAndWait<{ id: string }>(
            client,
            "task:delete",
            { id: task.id, version: task.version },
            "task:deleted"
        );

        expect(deleted.id).toBe(task.id);
        await flushWriteBuffer();
        const gone = await prisma.task.findUnique({ where: { id: task.id } });
        expect(gone).toBeNull();
    });

    test("deleting an already-deleted task emits task:conflict with type 'not_found'", async () => {
        const task = await prisma.task.create({
            data: { title: "Gone", column: "todo", position: "a0", createdBy: "u" },
        });
        await prisma.task.delete({ where: { id: task.id } });
        await initCache();

        const conflict = await emitAndWait<{ type: string }>(
            client,
            "task:delete",
            { id: task.id, version: task.version },
            "task:conflict"
        );

        expect(conflict.type).toBe("not_found");
    });

    test("deleting with a stale version emits task:conflict with type 'version_conflict'", async () => {
        const task = await prisma.task.create({
            data: { title: "Stale Delete", column: "todo", position: "a0", createdBy: "u" },
        });

        // Bump version: simulate someone else editing first
        await prisma.task.update({
            where: { id: task.id },
            data: { title: "Edited by someone else", version: task.version + 1 },
        });
        await initCache();

        const conflict = await emitAndWait<{ type: string; serverState: { version: number } }>(
            client,
            "task:delete",
            { id: task.id, version: task.version }, // stale version
            "task:conflict"
        );

        expect(conflict.type).toBe("version_conflict");
        expect(conflict.serverState.version).toBe(task.version + 1);
    });

    test("invalid task:delete payload emits an error to the sender", async () => {
        const err = await emitAndWait<{ message: string }>(
            client,
            "task:delete",
            { id: "not-a-uuid", version: 1 },
            "error"
        );
        expect(err.message).toContain("Invalid delete data");
    });
});

// ─── Multi-client broadcast ───────────────────────────────────

describe("multi-client broadcast", () => {
    let clientA: ClientSocket;
    let clientB: ClientSocket;

    beforeEach(async () => {
        // connectClient() already awaits the initial board:state internally
        clientA = await connectClient();
        clientB = await connectClient();
    });

    afterEach(async () => {
        await Promise.all([disconnectClient(clientA), disconnectClient(clientB)]);
    });

    test("task created by client A is received by client B as task:created", async () => {
        // Register clientB listener BEFORE clientA emits to avoid race
        const receivedByB = waitForEvent<{ title: string }>(clientB, "task:created");
        clientA.emit("task:create", { title: "Broadcast Task", column: "inprogress" });
        const task = await receivedByB;
        expect(task.title).toBe("Broadcast Task");
    });

    test("task moved by client A is received by client B as task:moved", async () => {
        const dbTask = await prisma.task.create({
            data: { title: "Multi Move", column: "todo", position: "a0", createdBy: "u" },
        });
        await initCache();

        const receivedByB = waitForEvent<{ id: string; column: string }>(clientB, "task:moved");
        clientA.emit("task:move", {
            id: dbTask.id,
            column: "done",
            position: generatePositionAtEnd(null),
            version: dbTask.version,
        });

        const moved = await receivedByB;
        expect(moved.id).toBe(dbTask.id);
        expect(moved.column).toBe("done");
    });

    test("task deleted by client A is received by client B as task:deleted", async () => {
        const dbTask = await prisma.task.create({
            data: { title: "Multi Delete", column: "todo", position: "a0", createdBy: "u" },
        });
        await initCache();

        const receivedByB = waitForEvent<{ id: string }>(clientB, "task:deleted");
        clientA.emit("task:delete", { id: dbTask.id, version: dbTask.version });

        const deleted = await receivedByB;
        expect(deleted.id).toBe(dbTask.id);
    });

    test("conflict events are sent ONLY to the requesting client, not broadcast to others", async () => {
        const dbTask = await prisma.task.create({
            data: { title: "Conflict Target", column: "todo", position: "a0", createdBy: "u" },
        });

        // Force a version mismatch so client A's move conflicts
        await prisma.task.update({
            where: { id: dbTask.id },
            data: { version: dbTask.version + 1 },
        });
        await initCache();

        let clientBGotConflict = false;
        clientB.on("task:conflict", () => { clientBGotConflict = true; });

        const conflictOnA = waitForEvent<{ type: string }>(clientA, "task:conflict");
        clientA.emit("task:move", {
            id: dbTask.id,
            column: "done",
            position: generatePositionAtEnd(null),
            version: dbTask.version, // stale
        });

        await conflictOnA;
        // Give clientB 200 ms to receive any spurious events
        await new Promise((r) => setTimeout(r, 200));
        expect(clientBGotConflict).toBe(false);
    });
});

describe("assignment conflict scenario: concurrent move + edit", () => {
    let clientA: ClientSocket;
    let clientB: ClientSocket;

    beforeEach(async () => {
        clientA = await connectClient();
        clientB = await connectClient();
    });

    afterEach(async () => {
        await Promise.all([disconnectClient(clientA), disconnectClient(clientB)]);
    });

    test("User A moves task, User B edits same task — second mutation gets conflict", async () => {
        const task = await prisma.task.create({
            data: { title: "Shared Task", column: "todo", position: "a0", createdBy: "u" },
        });
        await initCache();

        // User A moves it to "done" → succeeds (arrives first)
        const movedByA = waitForEvent<{ id: string; column: string; version: number }>(
            clientA,
            "task:moved"
        );
        clientA.emit("task:move", {
            id: task.id,
            column: "done",
            position: generatePositionAtEnd(null),
            version: task.version,
        });
        const moved = await movedByA;
        expect(moved.column).toBe("done");
        expect(moved.version).toBe(task.version + 1);

        // User B edits the title with the OLD version → conflict
        const conflictOnB = waitForEvent<{
            type: string;
            taskId: string;
            serverState: { column: string; version: number };
        }>(clientB, "task:conflict");
        clientB.emit("task:update", {
            id: task.id,
            title: "Updated by B",
            version: task.version, // stale — A already bumped it
        });
        const conflict = await conflictOnB;

        expect(conflict.type).toBe("version_conflict");
        expect(conflict.taskId).toBe(task.id);
        // Server state should reflect A's move
        expect(conflict.serverState.column).toBe("done");
        expect(conflict.serverState.version).toBe(task.version + 1);
    });
});

describe("assignment conflict scenario: concurrent move + move", () => {
    let clientA: ClientSocket;
    let clientB: ClientSocket;

    beforeEach(async () => {
        clientA = await connectClient();
        clientB = await connectClient();
    });

    afterEach(async () => {
        await Promise.all([disconnectClient(clientA), disconnectClient(clientB)]);
    });

    test("User A moves to 'inprogress', User B moves to 'done' — second gets conflict with winner's column", async () => {
        const task = await prisma.task.create({
            data: { title: "Tug of War", column: "todo", position: "a0", createdBy: "u" },
        });
        await initCache();

        // User A moves to "inprogress" → succeeds
        const movedByA = waitForEvent<{ column: string; version: number }>(clientA, "task:moved");
        clientA.emit("task:move", {
            id: task.id,
            column: "inprogress",
            position: generatePositionAtEnd(null),
            version: task.version,
        });
        const moved = await movedByA;
        expect(moved.column).toBe("inprogress");

        // User B tries to move to "done" with stale version → conflict
        const conflictOnB = waitForEvent<{
            type: string;
            serverState: { column: string; version: number };
        }>(clientB, "task:conflict");
        clientB.emit("task:move", {
            id: task.id,
            column: "done",
            position: generatePositionAtEnd(null),
            version: task.version, // stale
        });
        const conflict = await conflictOnB;

        expect(conflict.type).toBe("move_conflict");
        // Server state should show A won — column is "inprogress"
        expect(conflict.serverState.column).toBe("inprogress");
        expect(conflict.serverState.version).toBe(task.version + 1);
    });
});

describe("assignment conflict scenario: concurrent reorder + insert", () => {
    let clientA: ClientSocket;
    let clientB: ClientSocket;

    beforeEach(async () => {
        clientA = await connectClient();
        clientB = await connectClient();
    });

    afterEach(async () => {
        await Promise.all([disconnectClient(clientA), disconnectClient(clientB)]);
    });

    test("User A reorders within column while User B inserts — both succeed via fractional indexing", async () => {
        // Seed 3 tasks in "todo"
        const t1 = await prisma.task.create({
            data: { title: "Task 1", column: "todo", position: "a0", createdBy: "u" },
        });
        const t3 = await prisma.task.create({
            data: { title: "Task 3", column: "todo", position: "a2", createdBy: "u" },
        });
        await initCache();

        // User A reorders: moves Task 3 between nothing and Task 1 (to the top)
        const posBeforeT1 = generatePositionAtStart(t1.position);
        const movedByA = waitForEvent<{ id: string; position: string }>(clientA, "task:moved");
        clientA.emit("task:move", {
            id: t3.id,
            column: "todo",
            position: posBeforeT1,
            version: t3.version,
        });
        const moved = await movedByA;
        expect(moved.id).toBe(t3.id);
        expect(moved.position < t1.position).toBe(true); // now before Task 1

        // User B inserts a new task at the end of "todo" — should succeed independently
        const createdByB = waitForEvent<{ title: string; column: string; position: string }>(
            clientB,
            "task:created"
        );
        clientB.emit("task:create", { title: "Task 4", column: "todo" });
        const created = await createdByB;

        expect(created.title).toBe("Task 4");
        expect(created.column).toBe("todo");

        // Verify all tasks have unique positions in cache
        await flushWriteBuffer();
        const allTasks = await prisma.task.findMany({
            where: { column: "todo" },
            orderBy: { position: "asc" },
        });
        const positions = allTasks.map((t) => t.position);
        const uniquePositions = new Set(positions);
        expect(uniquePositions.size).toBe(positions.length);

        // Verify ordering is consistent
        for (let i = 1; i < positions.length; i++) {
            expect(positions[i] > positions[i - 1]).toBe(true);
        }
    });
});
