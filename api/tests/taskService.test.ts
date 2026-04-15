import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { PrismaClient } from "@prisma/client";
import * as taskService from "../src/services/taskService";
import { generatePositionAtEnd } from "../src/utils/fractional";

/**
 * Service-layer tests covering edge cases:
 *  - moveTask on a non-existent task
 *  - deleteTask with a stale version (version_conflict)
 *  - updateTask with only description
 *  - getAllTasks ordering by column then position
 *  - createTask with an explicit position
 *
 * Tests use the in-memory cache. Tasks are created via taskService.createTask
 * and the cache is re-initialized from DB between tests.
 */

const prisma = new PrismaClient();

describe("taskService — edge cases", () => {
    beforeAll(async () => {
        await prisma.$connect();
    });

    afterEach(async () => {
        await taskService.flushWriteBuffer();
        await prisma.task.deleteMany({});
        taskService.clearCache();
    });

    afterAll(async () => {
        await taskService.flushWriteBuffer();
        await prisma.$disconnect();
    });

    // ─── getAllTasks ──────────────────────────────────────────

    describe("getAllTasks", () => {
        test("returns an empty array when there are no tasks", async () => {
            await taskService.initCache();
            const tasks = await taskService.getAllTasks();
            expect(tasks).toEqual([]);
        });

        test("orders tasks by column asc then position asc", async () => {
            const posA = generatePositionAtEnd(null);
            const posB = generatePositionAtEnd(posA);

            await taskService.initCache();
            await taskService.createTask({ title: "Done Task", column: "done", position: posA }, "test-user");
            await taskService.createTask({ title: "Todo 2", column: "todo", position: posB }, "test-user");
            await taskService.createTask({ title: "Todo 1", column: "todo", position: posA }, "test-user");

            const tasks = await taskService.getAllTasks();
            // column order: "done" < "inprogress" < "todo" (alphabetical)
            expect(tasks[0].title).toBe("Done Task");
            // Within "todo", posA < posB
            expect(tasks[1].title).toBe("Todo 1");
            expect(tasks[2].title).toBe("Todo 2");
        });
    });

    // ─── createTask ───────────────────────────────────────────

    describe("createTask", () => {
        test("creates a task with default version of 1", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "New Task", column: "todo" },
                "user1"
            );
            expect(task.version).toBe(1);
            expect(task.createdBy).toBe("user1");
            expect(task.column).toBe("todo");
        });

        test("uses provided position when given", async () => {
            await taskService.initCache();
            const pos = "zzz";
            const task = await taskService.createTask(
                { title: "Positioned Task", column: "inprogress", position: pos },
                "user1"
            );
            expect(task.position).toBe(pos);
        });

        test("auto-places task after the last task in the column", async () => {
            await taskService.initCache();
            const first = await taskService.createTask({ title: "A", column: "done" }, "u");
            const second = await taskService.createTask({ title: "B", column: "done" }, "u");
            expect(second.position > first.position).toBe(true);
        });

        test("description defaults to empty string when omitted", async () => {
            await taskService.initCache();
            const task = await taskService.createTask({ title: "No Desc", column: "todo" }, "u");
            expect(task.description).toBe("");
        });
    });

    // ─── updateTask ───────────────────────────────────────────

    describe("updateTask", () => {
        test("updates only the description, leaving title unchanged", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "Original", description: "Old", column: "todo" },
                "test-user"
            );
            const result = await taskService.updateTask({
                id: task.id,
                description: "New description",
                version: task.version,
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.title).toBe("Original");
                expect(result.data.description).toBe("New description");
                expect(result.data.version).toBe(task.version + 1);
            }
        });

        test("increments version on each successive update", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "Versioned", column: "todo" },
                "test-user"
            );

            const r1 = await taskService.updateTask({
                id: task.id,
                title: "V2",
                version: task.version,
            });
            expect(r1.success).toBe(true);

            const r2 = await taskService.updateTask({
                id: task.id,
                title: "V3",
                version: r1.success ? r1.data.version : -1,
            });
            expect(r2.success).toBe(true);
            if (r2.success) {
                expect(r2.data.version).toBe(task.version + 2);
            }
        });

        test("returns not_found when task does not exist", async () => {
            await taskService.initCache();
            const fakeId = "00000000-0000-0000-0000-000000000000";
            const result = await taskService.updateTask({
                id: fakeId,
                title: "Ghost",
                version: 1,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.conflict.type).toBe("not_found");
                expect(result.conflict.taskId).toBe(fakeId);
            }
        });
    });

    // ─── moveTask ────────────────────────────────────────────

    describe("moveTask", () => {
        test("successfully moves task to a different column", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "Moveable", column: "todo" },
                "test-user"
            );
            const result = await taskService.moveTask({
                id: task.id,
                column: "done",
                position: generatePositionAtEnd(null),
                version: task.version,
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.column).toBe("done");
                expect(result.data.version).toBe(task.version + 1);
            }
        });

        test("returns not_found conflict when task does not exist", async () => {
            await taskService.initCache();
            const fakeId = "00000000-0000-0000-0000-000000000001";
            const result = await taskService.moveTask({
                id: fakeId,
                column: "done",
                position: generatePositionAtEnd(null),
                version: 1,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.conflict.type).toBe("not_found");
            }
        });

        test("returns move_conflict when version is stale", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "Move Me", column: "todo" },
                "test-user"
            );

            // First move succeeds
            await taskService.moveTask({
                id: task.id,
                column: "inprogress",
                position: generatePositionAtEnd(null),
                version: task.version,
            });

            // Second move with original (now stale) version
            const result = await taskService.moveTask({
                id: task.id,
                column: "done",
                position: generatePositionAtEnd(null),
                version: task.version, // stale
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.conflict.type).toBe("move_conflict");
                expect(result.conflict.serverState.column).toBe("inprogress");
                expect(result.conflict.message).toContain("another user");
            }
        });
    });

    // ─── deleteTask ──────────────────────────────────────────

    describe("deleteTask", () => {
        test("successfully deletes an existing task", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "Delete Me", column: "todo" },
                "test-user"
            );
            const result = await taskService.deleteTask({
                id: task.id,
                version: task.version,
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.id).toBe(task.id);
            }

            const allTasks = await taskService.getAllTasks();
            const found = allTasks.find((t) => t.id === task.id);
            expect(found).toBeUndefined();
        });

        test("returns not_found when task is already deleted", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "Delete Twice", column: "todo" },
                "test-user"
            );
            await taskService.deleteTask({ id: task.id, version: task.version });

            const result = await taskService.deleteTask({ id: task.id, version: task.version });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.conflict.type).toBe("not_found");
            }
        });

        test("returns version_conflict when version is stale (task was moved first)", async () => {
            await taskService.initCache();
            const task = await taskService.createTask(
                { title: "Move Then Delete", column: "todo" },
                "test-user"
            );

            // Someone else moved the task (bumps version)
            await taskService.moveTask({
                id: task.id,
                column: "done",
                position: generatePositionAtEnd(null),
                version: task.version,
            });

            // Now try to delete with the original (stale) version
            const result = await taskService.deleteTask({
                id: task.id,
                version: task.version, // stale
            });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.conflict.type).toBe("version_conflict");
                expect(result.conflict.serverState.column).toBe("done");
            }
        });
    });
});
