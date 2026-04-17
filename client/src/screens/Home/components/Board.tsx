import { useState, useCallback, useContext } from "react";
import toast from "react-hot-toast";
import {
    DndContext,
    DragOverlay,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
    type DragStartEvent,
    type DragEndEvent,
    type DragOverEvent,
} from "@dnd-kit/core";
import HomeContext from "../context";
import type { Column as ColumnType, Task } from "../../../types";
import { generatePositionBetween, generatePositionAtEnd, generatePositionAtStart } from "../../../utils/fractional";
import Column from "./Column";
import TaskCard from "./TaskCard";
import PresenceBar from "./PresenceBar";
import ConnectionStatus from "./ConnectionStatus";
import ErrorBoundary from "./ErrorBoundary";

const COLUMN_IDS: ColumnType[] = ["todo", "inprogress", "done"];

function Board() {
    const {
        tasks,
        getTasksByColumn,
        handleCreateTask,
        handleEditTask,
        handleDeleteTask,
        handleMoveTask,
        moveTaskLocally,
    } = useContext(HomeContext);

    const [activeTask, setActiveTask] = useState<Task | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        })
    );

    const handleDragStart = useCallback(
        (event: DragStartEvent) => {
            const { active } = event;
            const task = tasks.get(active.id as string);
            if (task) setActiveTask(task);
        },
        [tasks]
    );

    const handleDragOver = useCallback(
        (event: DragOverEvent) => {
            const { active, over } = event;
            if (!over) return;

            const activeId = active.id as string;
            const overId = over.id as string;
            const draggedTask = tasks.get(activeId);
            if (!draggedTask) return;

            let targetColumn: ColumnType;

            if (COLUMN_IDS.includes(overId as ColumnType)) {
                targetColumn = overId as ColumnType;
            } else {
                const overTask = tasks.get(overId);
                if (!overTask) return;
                targetColumn = overTask.column;
            }

            if (draggedTask.column !== targetColumn) {
                const targetTasks = getTasksByColumn(targetColumn);
                const position = generatePositionAtEnd(
                    targetTasks.length > 0 ? targetTasks[targetTasks.length - 1].position : null
                );
                moveTaskLocally(activeId, targetColumn, position);
            }
        },
        [tasks, getTasksByColumn, moveTaskLocally]
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            setActiveTask(null);

            if (!over) return;

            const activeId = active.id as string;
            const overId = over.id as string;
            const task = tasks.get(activeId);
            if (!task) {
                toast.error("This task was deleted by another user", {
                    icon: "🗑️",
                    duration: 3000,
                });
                return;
            }

            let targetColumn: ColumnType;
            let newPosition: string;

            if (COLUMN_IDS.includes(overId as ColumnType)) {
                targetColumn = overId as ColumnType;
                const columnTasks = getTasksByColumn(targetColumn).filter(
                    (t: Task) => t.id !== activeId
                );
                newPosition = generatePositionAtEnd(
                    columnTasks.length > 0 ? columnTasks[columnTasks.length - 1].position : null
                );
            } else {
                const overTask = tasks.get(overId);
                if (!overTask) return;

                targetColumn = overTask.column;
                const columnTasks = getTasksByColumn(targetColumn).filter(
                    (t: Task) => t.id !== activeId
                );

                const overIndex = columnTasks.findIndex((t: Task) => t.id === overId);

                if (overIndex === -1) {
                    newPosition = generatePositionAtEnd(
                        columnTasks.length > 0 ? columnTasks[columnTasks.length - 1].position : null
                    );
                } else if (overIndex === 0) {
                    newPosition = generatePositionAtStart(columnTasks[0].position);
                } else {
                    newPosition = generatePositionBetween(
                        columnTasks[overIndex - 1].position,
                        columnTasks[overIndex].position
                    );
                }
            }

            handleMoveTask(activeId, targetColumn, newPosition, task.version);
        },
        [tasks, getTasksByColumn, handleMoveTask]
    );

    return (
        <div className="board-wrapper">
            <header className="board-header">
                <div className="header-left">
                    <h1 className="board-title">📋 Kanban Board</h1>
                    <ConnectionStatus />
                </div>
                <PresenceBar />
            </header>

            <ErrorBoundary>
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                >
                    <div className="board">
                        {COLUMN_IDS.map((column) => (
                            <Column
                                key={column}
                                column={column}
                                tasks={getTasksByColumn(column)}
                                onCreateTask={handleCreateTask}
                                onEditTask={handleEditTask}
                                onDeleteTask={handleDeleteTask}
                            />
                        ))}
                    </div>

                    <DragOverlay>
                        {activeTask ? (
                            <TaskCard
                                task={activeTask}
                                onEdit={() => { }}
                                onDelete={() => { }}
                            />
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </ErrorBoundary>
        </div>
    );
}

export default Board;
