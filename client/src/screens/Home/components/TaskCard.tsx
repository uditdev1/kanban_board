import { useState, useContext } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../../../types";
import HomeContext from "../context";
import TaskForm from "./TaskForm";

interface TaskCardProps {
    task: Task;
    onEdit: (id: string, title: string, description: string, version: number) => void;
    onDelete: (id: string, version: number) => void;
}

function TaskCard({ task, onEdit, onDelete }: TaskCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const { users, currentUser } = useContext(HomeContext);

    const isPending = Boolean(task.pending);

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: task.id,
        data: { type: "task", task },
        disabled: isPending,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const activeUser = users.find(
        (u: any) =>
            u.activeTaskId === task.id &&
            currentUser &&
            u.username !== currentUser.username
    );

    if (isEditing) {
        return (
            <div ref={setNodeRef} style={style} className="task-card editing">
                <TaskForm
                    column={task.column}
                    initialTitle={task.title}
                    initialDescription={task.description}
                    isEditing
                    onSubmit={(title: string, description: string) => {
                        onEdit(task.id, title, description, task.version);
                        setIsEditing(false);
                    }}
                    onCancel={() => setIsEditing(false)}
                />
            </div>
        );
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`task-card ${isDragging ? "dragging" : ""} ${isPending ? "task-card--pending" : ""}`}
            {...attributes}
            {...(!isPending ? listeners : {})}
        >
            {isPending && (
                <span className="task-pending-dot" title="Not yet synced to server" />
            )}

            {activeUser && !isPending && (
                <div
                    className="task-active-user"
                    style={{ backgroundColor: activeUser.color }}
                    title={`${activeUser.username} is viewing this task`}
                >
                    {activeUser.username.charAt(0).toUpperCase()}
                </div>
            )}

            <div className="task-card-header">
                <h4 className="task-title" onClick={() => setIsExpanded(!isExpanded)}>
                    {task.title}
                </h4>
                <div className="task-actions">
                    <button
                        className="task-btn edit"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!isPending) setIsEditing(true);
                        }}
                        title={isPending ? "Waiting to sync…" : "Edit task"}
                        disabled={isPending}
                    >
                        ✏️
                    </button>
                    <button
                        className="task-btn delete"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!isPending) onDelete(task.id, task.version);
                        }}
                        title={isPending ? "Waiting to sync…" : "Delete task"}
                        disabled={isPending}
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {(isExpanded || task.description) && task.description && (
                <p className="task-description">{task.description}</p>
            )}

            <div className="task-meta">
                {isPending ? (
                    <span className="task-pending-badge">⏳ Pending sync</span>
                ) : (
                    <>
                        <span className="task-creator" title={`Created by ${task.createdBy}`}>
                            {task.createdBy.slice(0, 8)}
                        </span>
                        <span className="task-version" title="Version">v{task.version}</span>
                    </>
                )}
            </div>
        </div>
    );
}

export default TaskCard;
