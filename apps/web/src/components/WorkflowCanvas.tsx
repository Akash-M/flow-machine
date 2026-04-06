import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkflowDefinition, WorkflowRun, WorkflowStepState } from '@flow-machine/shared-types';

interface WorkflowCanvasProps {
  definition: WorkflowDefinition;
  run?: WorkflowRun | null;
  selectedNodeId: string | null;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onSelectNode: (nodeId: string) => void;
}

const nodeWidth = 196;
const nodeHeight = 88;
const canvasPadding = 80;
const minCanvasWidth = 720;
const minCanvasHeight = 620;

function clampPosition(value: number): number {
  return Math.max(24, Math.round(value));
}

function buildEdgePath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const delta = Math.max(84, Math.abs(target.x - source.x) * 0.45);

  return `M ${source.x} ${source.y} C ${source.x + delta} ${source.y}, ${target.x - delta} ${target.y}, ${target.x} ${target.y}`;
}

function nodeStatusLabel(status: WorkflowStepState | 'queued' | null): string | null {
  if (!status) {
    return null;
  }

  switch (status) {
    case 'running':
      return 'Running';
    case 'waiting-approval':
      return 'Approval';
    case 'failed':
      return 'Failed';
    case 'success':
      return 'Done';
    case 'queued':
    case 'pending':
      return 'Queued';
    case 'skipped':
      return 'Skipped';
    default:
      return null;
  }
}

function nodeStatusClassName(status: WorkflowStepState | 'queued' | null): string {
  if (!status) {
    return '';
  }

  if (status === 'running') {
    return ' workflow-node--running';
  }

  if (status === 'waiting-approval') {
    return ' workflow-node--waiting';
  }

  if (status === 'failed') {
    return ' workflow-node--failed';
  }

  if (status === 'success' || status === 'skipped') {
    return ' workflow-node--success';
  }

  return ' workflow-node--queued';
}

export function WorkflowCanvas({ definition, run = null, selectedNodeId, onMoveNode, onSelectNode }: WorkflowCanvasProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const onMoveNodeRef = useRef(onMoveNode);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  useEffect(() => {
    onMoveNodeRef.current = onMoveNode;
  }, [onMoveNode]);

  const canvasSize = useMemo(() => {
    const maxX = definition.nodes.reduce((current, node) => Math.max(current, node.position.x + nodeWidth), 0);
    const maxY = definition.nodes.reduce((current, node) => Math.max(current, node.position.y + nodeHeight), 0);

    return {
      width: Math.max(minCanvasWidth, maxX + canvasPadding),
      height: Math.max(minCanvasHeight, maxY + canvasPadding)
    };
  }, [definition.nodes]);

  const runStateByNodeId = useMemo(() => {
    const nextStates = new Map<string, WorkflowStepState | 'queued'>();

    if (!run) {
      return nextStates;
    }

    for (const step of run.steps) {
      nextStates.set(step.nodeId, step.state);
    }

    if (run.currentNodeId && !nextStates.has(run.currentNodeId)) {
      nextStates.set(run.currentNodeId, run.status === 'waiting-approval' ? 'waiting-approval' : 'running');
    }

    for (const nodeId of run.pendingNodeIds) {
      if (!nextStates.has(nodeId)) {
        nextStates.set(nodeId, 'queued');
      }
    }

    return nextStates;
  }, [run]);

  useEffect(() => {
    if (!draggingNodeId) {
      return undefined;
    }

    function handlePointerMove(event: PointerEvent): void {
      const board = boardRef.current;
      const dragState = dragStateRef.current;

      if (!board || !dragState) {
        return;
      }

      const rect = board.getBoundingClientRect();

        onMoveNodeRef.current(dragState.nodeId, {
        x: clampPosition(event.clientX - rect.left - dragState.offsetX),
        y: clampPosition(event.clientY - rect.top - dragState.offsetY)
      });
    }

    function handlePointerUp(): void {
      dragStateRef.current = null;
      setDraggingNodeId(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingNodeId]);

  if (definition.nodes.length === 0) {
    return (
      <div className="workflow-canvas workflow-canvas--empty">
        <div className="empty-state">
          <h3>No nodes yet</h3>
          <p>Add a task node to start building the graph. You can drag nodes once they exist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-canvas" ref={boardRef} style={{ height: canvasSize.height }}>
      <div className="workflow-canvas__surface" style={{ width: canvasSize.width, height: canvasSize.height }}>
        <svg className="workflow-canvas__edges" height={canvasSize.height} width={canvasSize.width}>
          <defs>
            <marker id="workflow-canvas-arrow" markerHeight="8" markerWidth="8" orient="auto-start-reverse" refX="7" refY="4">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(20, 100, 92, 0.7)" />
            </marker>
          </defs>
          {definition.edges.map((edge) => {
            const sourceNode = definition.nodes.find((node) => node.id === edge.source);
            const targetNode = definition.nodes.find((node) => node.id === edge.target);

            if (!sourceNode || !targetNode) {
              return null;
            }

            const source = {
              x: sourceNode.position.x + nodeWidth,
              y: sourceNode.position.y + nodeHeight / 2
            };
            const target = {
              x: targetNode.position.x,
              y: targetNode.position.y + nodeHeight / 2
            };

            return (
              <path
                className="workflow-canvas__edge"
                d={buildEdgePath(source, target)}
                key={edge.id}
                markerEnd="url(#workflow-canvas-arrow)"
              />
            );
          })}
        </svg>

        {definition.nodes.map((node) => {
          const isActive = node.id === selectedNodeId;
          const isDragging = node.id === draggingNodeId;
          const runState = runStateByNodeId.get(node.id) ?? null;
          const runStateLabel = nodeStatusLabel(runState);

          return (
            <button
              className={`workflow-node${isActive ? ' workflow-node--active' : ''}${isDragging ? ' workflow-node--dragging' : ''}${nodeStatusClassName(
                runState
              )}`}
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              onPointerDown={(event) => {
                if (event.button !== 0 || !boardRef.current) {
                  return;
                }

                const rect = boardRef.current.getBoundingClientRect();

                dragStateRef.current = {
                  nodeId: node.id,
                  offsetX: event.clientX - rect.left - node.position.x,
                  offsetY: event.clientY - rect.top - node.position.y
                };
                setDraggingNodeId(node.id);
                onSelectNode(node.id);
              }}
              style={{ left: node.position.x, top: node.position.y }}
              type="button"
            >
              <div className="workflow-node__badges">
                {definition.startNodeId === node.id ? (
                  <span className="workflow-node__badge">Entry node</span>
                ) : (
                  <span aria-hidden="true" className="workflow-node__badge-placeholder" />
                )}
                {runStateLabel ? (
                  <span
                    className={`workflow-node__state workflow-node__state--${runState === 'waiting-approval' ? 'waiting' : runState === 'running' ? 'running' : runState === 'failed' ? 'failed' : runState === 'success' || runState === 'skipped' ? 'success' : 'queued'}`}
                  >
                    {runStateLabel}
                  </span>
                ) : null}
              </div>
              <strong>{node.name}</strong>
              <span>{node.taskKey}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}