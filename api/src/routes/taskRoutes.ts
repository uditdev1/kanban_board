import { Router } from "express";
import * as taskService from "../services/taskService.js";
import { createTaskSchema } from "../types/index.js";

const router = Router();

router.get("/tasks", async (_req, res) => {
    try {
        const tasks = await taskService.getAllTasks();
        res.json({ tasks });
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ error: "Failed to fetch tasks" });
    }
});

router.post("/tasks", async (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid task data", details: parsed.error.flatten() });
        return;
    }

    try {
        const task = await taskService.createTask(parsed.data, "rest-user");
        res.status(201).json({ task });
    } catch (error) {
        console.error("Error creating task:", error);
        res.status(500).json({ error: "Failed to create task" });
    }
});

router.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
