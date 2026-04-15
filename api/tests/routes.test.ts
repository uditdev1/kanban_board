import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { app } from "../src/index";
import { flushWriteBuffer, clearCache, initCache } from "../src/services/taskService";

/**
 * REST API integration tests for `GET /api/tasks`, `POST /api/tasks`,
 * and `GET /api/health`.
 *
 * Uses Bun's built-in fetch against the real Express app (no external server
 * needed — we call app.listen on an ephemeral port).
 */

const prisma = new PrismaClient();

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
    await prisma.$connect();
    // Spin up the Express app on a random available port
    server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://localhost:${port}`;
});

afterEach(async () => {
    await flushWriteBuffer();
    await prisma.task.deleteMany({});
    clearCache();
});

afterAll(async () => {
    await flushWriteBuffer();
    server?.close();
    await prisma.$disconnect();
});

// ─── GET /api/health ─────────────────────────────────────────

describe("GET /api/health", () => {
    test("returns status ok with a timestamp", async () => {
        const res = await fetch(`${baseUrl}/api/health`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe("ok");
        expect(typeof body.timestamp).toBe("string");
        // Timestamp should be a valid ISO date string
        expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
    });
});

// ─── GET /api/tasks ──────────────────────────────────────────

describe("GET /api/tasks", () => {
    test("returns an empty tasks array when no tasks exist", async () => {
        const res = await fetch(`${baseUrl}/api/tasks`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(Array.isArray(body.tasks)).toBe(true);
        expect(body.tasks.length).toBe(0);
    });

    test("returns all persisted tasks", async () => {
        // Seed two tasks directly via Prisma
        await prisma.task.create({
            data: { title: "Task A", column: "todo", position: "a0", createdBy: "test" },
        });
        await prisma.task.create({
            data: { title: "Task B", column: "done", position: "a0", createdBy: "test" },
        });
        await initCache();

        const res = await fetch(`${baseUrl}/api/tasks`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.tasks.length).toBe(2);
    });

    test("task objects include expected fields", async () => {
        await prisma.task.create({
            data: { title: "Fielded Task", column: "inprogress", position: "a0", createdBy: "u1" },
        });
        await initCache();

        const res = await fetch(`${baseUrl}/api/tasks`);
        const body = await res.json();
        const task = body.tasks[0];

        expect(task).toHaveProperty("id");
        expect(task).toHaveProperty("title");
        expect(task).toHaveProperty("description");
        expect(task).toHaveProperty("column");
        expect(task).toHaveProperty("position");
        expect(task).toHaveProperty("version");
        expect(task).toHaveProperty("createdBy");
        expect(task).toHaveProperty("createdAt");
        expect(task).toHaveProperty("updatedAt");
    });
});

// ─── POST /api/tasks ─────────────────────────────────────────

describe("POST /api/tasks", () => {
    test("creates a task and returns 201 with the task", async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Created via REST", column: "todo" }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.task.title).toBe("Created via REST");
        expect(body.task.column).toBe("todo");
        expect(body.task.version).toBe(1);
        expect(body.task.createdBy).toBe("rest-user");
    });

    test("sets column to 'todo' by default when column is omitted", async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Default Column Task" }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.task.column).toBe("todo");
    });

    test("persists the task so it appears in GET /api/tasks", async () => {
        await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Persisted Task", column: "done" }),
        });

        const res = await fetch(`${baseUrl}/api/tasks`);
        const body = await res.json();
        expect(body.tasks.some((t: { title: string }) => t.title === "Persisted Task")).toBe(true);
    });

    test("returns 400 for missing title", async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ column: "todo" }), // no title
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("Invalid task data");
        expect(body.details).toBeDefined();
    });

    test("returns 400 for empty title", async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "", column: "todo" }),
        });

        expect(res.status).toBe(400);
    });

    test("returns 400 for an invalid column value", async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Bad Column", column: "backlog" }),
        });

        expect(res.status).toBe(400);
    });

    test("returns 400 for a title exceeding 200 characters", async () => {
        const longTitle = "a".repeat(201);
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: longTitle, column: "todo" }),
        });

        expect(res.status).toBe(400);
    });

    test("accepts a description and stores it", async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Has Desc", column: "todo", description: "My description" }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.task.description).toBe("My description");
    });

    test("auto-generates position placing new tasks at the end of the column", async () => {
        const r1 = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "First", column: "todo" }),
        });
        const r2 = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Second", column: "todo" }),
        });

        const b1 = await r1.json();
        const b2 = await r2.json();
        expect(b2.task.position > b1.task.position).toBe(true);
    });
});
