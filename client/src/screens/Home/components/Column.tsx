import { useState } from "react";
import {
    SortableContext,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { Column as ColumnType, Task } from "../../../types";
import { COLUMN_LABELS, COLUMN_COLORS } from "../../../types";
import TaskCard from "./TaskCard";
import TaskForm from "./TaskForm";

interface ColumnProps {
    column: ColumnType;
    tasks: Task[];
    onCreateTask: (title: string, description: string, column: ColumnType) => void;
    onEditTask: (id: string, title: string, description: string, version: number) => void;
    onDeleteTask: (id: string, version: number) => void;
}

function Column({ column, tasks, onCreateTask, onEditTask, onDeleteTask }: ColumnProps) {
    const [isAdding, setIsAdding] = useState(false);

    const { setNodeRef, isOver } = useDroppable({
        id: column,
        data: { type: "column", column },
    });

    const taskIds = tasks.map((t) => t.id);

    return (
        <div className={`column ${isOver ? "column-over" : ""}`}>
            <div className="column-header" style={{ borderColor: COLUMN_COLORS[column] }}>
                <div className="column-title-row">
                    <span
                        className="column-dot"
                        style={{ backgroundColor: COLUMN_COLORS[column] }}
                    />
                    <h3 className="column-title">{COLUMN_LABELS[column]}</h3>
                    <span className="column-count">{tasks.length}</span>
                </div>
                <button
                    className="column-add-btn"
                    onClick={() => setIsAdding(true)}
                    title="Add task"
                >
                    +
                </button>
            </div>

            {isAdding && (
                <TaskForm
                    column={column}
                    onSubmit={(title, description) => {
                        onCreateTask(title, description, column);
                        setIsAdding(false);
                    }}
                    onCancel={() => setIsAdding(false)}
                />
            )}

            <div ref={setNodeRef} className="column-tasks">
                <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                    {tasks.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onEdit={onEditTask}
                            onDelete={onDeleteTask}
                        />
                    ))}
                </SortableContext>

                {tasks.length === 0 && !isAdding && (
                    <div className="column-empty">
                        <p>No tasks yet</p>
                        <button className="btn btn-ghost" onClick={() => setIsAdding(true)}>
                            + Add a task
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Column;
