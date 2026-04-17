import { useState } from "react";
import type { Column } from "../../../types";

interface TaskFormProps {
    column: Column;
    onSubmit: (title: string, description: string) => void;
    onCancel: () => void;
    initialTitle?: string;
    initialDescription?: string;
    isEditing?: boolean;
}

function TaskForm({
    onSubmit,
    onCancel,
    initialTitle = "",
    initialDescription = "",
    isEditing = false,
}: TaskFormProps) {
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSubmit(title.trim(), description.trim());
        setTitle("");
        setDescription("");
    };

    return (
        <form className="task-form" onSubmit={handleSubmit}>
            <input
                type="text"
                placeholder="Task title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="task-form-input"
                autoFocus
                maxLength={200}
            />
            <textarea
                placeholder="Description (optional)..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="task-form-textarea"
                rows={2}
                maxLength={2000}
            />
            <div className="task-form-actions">
                <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
                    {isEditing ? "Save" : "Add Task"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </form>
    );
}

export default TaskForm;
