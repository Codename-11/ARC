<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { VueFlow, Position } from '@vue-flow/core'
import ArcFlowNode from './ArcFlowNode.vue'

const props = defineProps<{
  diagram: string
  height?: string
}>()

const flowHeight = computed(() => props.height || '320px')

// ── Diagram definitions ─────────────────────────────────────────

interface DiagramDef {
  nodes: Array<{
    id: string
    type?: string
    position: { x: number; y: number }
    data: { label: string; color?: string; accent?: boolean }
    sourcePosition?: Position
    targetPosition?: Position
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    animated?: boolean
    label?: string
    style?: Record<string, string>
    type?: string
  }>
}

const edgeStyle = { stroke: '#2563EB', strokeWidth: 1.5 }
const edgeDim = { stroke: '#333', strokeWidth: 1 }
const edgeAnimated = true

const diagrams: Record<string, DiagramDef> = {
  'hook-pipeline': {
    nodes: [
      { id: '1', type: 'arc', position: { x: 0, y: 0 }, data: { label: 'Message In' }, sourcePosition: Position.Right },
      { id: '2', type: 'arc', position: { x: 150, y: 0 }, data: { label: 'Source Classify' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '3', type: 'arc', position: { x: 310, y: 0 }, data: { label: 'Interagent Routing' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '4', type: 'arc', position: { x: 500, y: 0 }, data: { label: 'Risk Detection' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '5', type: 'arc', position: { x: 660, y: 0 }, data: { label: 'Attempt Tracker' }, sourcePosition: Position.Bottom, targetPosition: Position.Left },
      { id: '6', type: 'arc', position: { x: 660, y: 80 }, data: { label: 'Roundtable', accent: true }, sourcePosition: Position.Bottom, targetPosition: Position.Top },
      { id: '7', type: 'arc', position: { x: 660, y: 160 }, data: { label: 'Agent Executes', accent: true }, sourcePosition: Position.Left, targetPosition: Position.Top },
      { id: '8', type: 'arc', position: { x: 480, y: 160 }, data: { label: 'Audit Score' }, sourcePosition: Position.Left, targetPosition: Position.Right },
      { id: '9', type: 'arc', position: { x: 290, y: 160 }, data: { label: 'Supervision Gate' }, sourcePosition: Position.Left, targetPosition: Position.Right },
      { id: '10', type: 'arc', position: { x: 110, y: 160 }, data: { label: 'Post Verify' }, sourcePosition: Position.Left, targetPosition: Position.Right },
      { id: '11', type: 'arc', position: { x: 0, y: 80 }, data: { label: 'Trace Written' }, targetPosition: Position.Right },
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: edgeAnimated, style: edgeStyle },
      { id: 'e2', source: '2', target: '3', animated: edgeAnimated, style: edgeStyle },
      { id: 'e3', source: '3', target: '4', animated: edgeAnimated, style: edgeStyle },
      { id: 'e4', source: '4', target: '5', animated: edgeAnimated, style: edgeStyle },
      { id: 'e5', source: '5', target: '6', animated: edgeAnimated, style: edgeStyle },
      { id: 'e6', source: '6', target: '7', animated: edgeAnimated, style: edgeStyle },
      { id: 'e7', source: '7', target: '8', animated: edgeAnimated, style: edgeStyle },
      { id: 'e8', source: '8', target: '9', animated: edgeAnimated, style: edgeStyle },
      { id: 'e9', source: '9', target: '10', animated: edgeAnimated, style: edgeStyle },
      { id: 'e10', source: '10', target: '11', animated: edgeAnimated, style: edgeStyle },
    ],
  },

  'data-flow': {
    nodes: [
      { id: '1', type: 'arc', position: { x: 0, y: 60 }, data: { label: 'Profile Resolution' }, sourcePosition: Position.Right },
      { id: '2', type: 'arc', position: { x: 190, y: 60 }, data: { label: 'arc.json?' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '3', type: 'arc', position: { x: 350, y: 10 }, data: { label: 'Workspace Override' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '4', type: 'arc', position: { x: 350, y: 110 }, data: { label: 'Profile Inheritance' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '5', type: 'arc', position: { x: 550, y: 60 }, data: { label: 'Adapter.launch()' }, sourcePosition: Position.Bottom, targetPosition: Position.Left },
      { id: '6', type: 'arc', position: { x: 550, y: 150 }, data: { label: 'Hook Pipeline', accent: true }, sourcePosition: Position.Bottom, targetPosition: Position.Top },
      { id: '7', type: 'arc', position: { x: 440, y: 240 }, data: { label: 'Agent Executes' }, sourcePosition: Position.Left, targetPosition: Position.Top },
      { id: '8', type: 'arc', position: { x: 640, y: 240 }, data: { label: 'Block + Log' }, targetPosition: Position.Top },
      { id: '9', type: 'arc', position: { x: 230, y: 240 }, data: { label: 'Post-Process' }, sourcePosition: Position.Left, targetPosition: Position.Right },
      { id: '10', type: 'arc', position: { x: 50, y: 240 }, data: { label: 'Trace Written' }, targetPosition: Position.Right },
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: edgeAnimated, style: edgeStyle },
      { id: 'e2', source: '2', target: '3', animated: edgeAnimated, style: edgeStyle, label: 'yes' },
      { id: 'e3', source: '2', target: '4', animated: edgeAnimated, style: edgeDim, label: 'no' },
      { id: 'e4', source: '3', target: '5', animated: edgeAnimated, style: edgeStyle },
      { id: 'e5', source: '4', target: '5', animated: edgeAnimated, style: edgeDim },
      { id: 'e6', source: '5', target: '6', animated: edgeAnimated, style: edgeStyle },
      { id: 'e7', source: '6', target: '7', animated: edgeAnimated, style: edgeStyle },
      { id: 'e8', source: '6', target: '8', style: { stroke: '#EF4444', strokeWidth: 1.5 }, label: 'blocked' },
      { id: 'e9', source: '7', target: '9', animated: edgeAnimated, style: edgeStyle },
      { id: 'e10', source: '9', target: '10', animated: edgeAnimated, style: edgeStyle },
    ],
  },

  'architecture': {
    nodes: [
      { id: 'cli', type: 'arc', position: { x: 0, y: 0 }, data: { label: 'CLI Commands' }, sourcePosition: Position.Right },
      { id: 'tui', type: 'arc', position: { x: 0, y: 70 }, data: { label: 'TUI Dashboard' }, sourcePosition: Position.Right },
      { id: 'web', type: 'arc', position: { x: 0, y: 140 }, data: { label: 'Web Dashboard' }, sourcePosition: Position.Right },
      { id: 'core', type: 'arc', position: { x: 220, y: 60 }, data: { label: 'ARC Core', accent: true }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: 'profiles', type: 'arc', position: { x: 420, y: -20 }, data: { label: 'Profiles' }, targetPosition: Position.Left },
      { id: 'hooks', type: 'arc', position: { x: 420, y: 40 }, data: { label: 'Hook Bus' }, targetPosition: Position.Left },
      { id: 'tasks', type: 'arc', position: { x: 420, y: 100 }, data: { label: 'Task Store' }, targetPosition: Position.Left },
      { id: 'memory', type: 'arc', position: { x: 560, y: -20 }, data: { label: 'Memory' }, targetPosition: Position.Left },
      { id: 'skills', type: 'arc', position: { x: 560, y: 40 }, data: { label: 'Skills' }, targetPosition: Position.Left },
      { id: 'sessions', type: 'arc', position: { x: 560, y: 100 }, data: { label: 'Sessions' }, targetPosition: Position.Left },
    ],
    edges: [
      { id: 'e1', source: 'cli', target: 'core', animated: edgeAnimated, style: edgeStyle },
      { id: 'e2', source: 'tui', target: 'core', animated: edgeAnimated, style: edgeStyle },
      { id: 'e3', source: 'web', target: 'core', animated: edgeAnimated, style: edgeStyle },
      { id: 'e4', source: 'core', target: 'profiles', style: edgeDim },
      { id: 'e5', source: 'core', target: 'hooks', style: edgeDim },
      { id: 'e6', source: 'core', target: 'tasks', style: edgeDim },
      { id: 'e7', source: 'core', target: 'memory', style: edgeDim },
      { id: 'e8', source: 'core', target: 'skills', style: edgeDim },
      { id: 'e9', source: 'core', target: 'sessions', style: edgeDim },
    ],
  },

  'roundtable': {
    nodes: [
      { id: '1', type: 'arc', position: { x: 0, y: 50 }, data: { label: 'Trigger' }, sourcePosition: Position.Right },
      { id: '2', type: 'arc', position: { x: 160, y: 50 }, data: { label: 'Active', accent: true }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '3', type: 'arc', position: { x: 350, y: 50 }, data: { label: 'Synthesizing' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '4', type: 'arc', position: { x: 530, y: 50 }, data: { label: 'Complete' }, targetPosition: Position.Left },
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: edgeAnimated, style: edgeStyle },
      { id: 'e2', source: '2', target: '2', animated: edgeAnimated, style: edgeStyle, label: 'next turn', type: 'smoothstep' },
      { id: 'e3', source: '2', target: '3', animated: edgeAnimated, style: edgeStyle, label: 'all rounds done' },
      { id: 'e4', source: '3', target: '4', animated: edgeAnimated, style: edgeStyle },
    ],
  },

  'delegation': {
    nodes: [
      { id: '1', type: 'arc', position: { x: 0, y: 0 }, data: { label: 'Delegator' }, sourcePosition: Position.Right },
      { id: '2', type: 'arc', position: { x: 180, y: 0 }, data: { label: 'Create Task' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '3', type: 'arc', position: { x: 360, y: 0 }, data: { label: 'Assign', accent: true }, sourcePosition: Position.Bottom, targetPosition: Position.Left },
      { id: '4', type: 'arc', position: { x: 360, y: 80 }, data: { label: 'Handoff Message' }, sourcePosition: Position.Bottom, targetPosition: Position.Top },
      { id: '5', type: 'arc', position: { x: 360, y: 160 }, data: { label: 'Assignee Accepts' }, sourcePosition: Position.Left, targetPosition: Position.Top },
      { id: '6', type: 'arc', position: { x: 180, y: 160 }, data: { label: 'Working' }, sourcePosition: Position.Left, targetPosition: Position.Right },
      { id: '7', type: 'arc', position: { x: 0, y: 160 }, data: { label: 'Complete' }, sourcePosition: Position.Top, targetPosition: Position.Right },
      { id: '8', type: 'arc', position: { x: 0, y: 80 }, data: { label: 'Notified' }, targetPosition: Position.Bottom },
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: edgeAnimated, style: edgeStyle },
      { id: 'e2', source: '2', target: '3', animated: edgeAnimated, style: edgeStyle },
      { id: 'e3', source: '3', target: '4', animated: edgeAnimated, style: edgeStyle },
      { id: 'e4', source: '4', target: '5', animated: edgeAnimated, style: edgeStyle },
      { id: 'e5', source: '5', target: '6', animated: edgeAnimated, style: edgeStyle },
      { id: 'e6', source: '6', target: '7', animated: edgeAnimated, style: edgeStyle },
      { id: 'e7', source: '7', target: '8', animated: edgeAnimated, style: edgeStyle },
    ],
  },

  'factory': {
    nodes: [
      { id: '1', type: 'arc', position: { x: 0, y: 50 }, data: { label: 'Idle' }, sourcePosition: Position.Right },
      { id: '2', type: 'arc', position: { x: 140, y: 50 }, data: { label: 'Planning' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '3', type: 'arc', position: { x: 280, y: 50 }, data: { label: 'Executing', accent: true }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '4', type: 'arc', position: { x: 430, y: 50 }, data: { label: 'Verifying' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '5', type: 'arc', position: { x: 570, y: 50 }, data: { label: 'Gating' }, sourcePosition: Position.Right, targetPosition: Position.Left },
      { id: '6', type: 'arc', position: { x: 570, y: 140 }, data: { label: 'Completed' }, targetPosition: Position.Top },
      { id: '7', type: 'arc', position: { x: 280, y: 140 }, data: { label: 'Failed' }, targetPosition: Position.Top },
      { id: '8', type: 'arc', position: { x: 140, y: 140 }, data: { label: 'Aborted' }, targetPosition: Position.Top },
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: edgeAnimated, style: edgeStyle },
      { id: 'e2', source: '2', target: '3', animated: edgeAnimated, style: edgeStyle },
      { id: 'e3', source: '3', target: '4', animated: edgeAnimated, style: edgeStyle },
      { id: 'e4', source: '4', target: '5', animated: edgeAnimated, style: edgeStyle },
      { id: 'e5', source: '5', target: '6', animated: edgeAnimated, style: edgeStyle, label: 'done' },
      { id: 'e6', source: '5', target: '3', style: edgeDim, label: 'next wave', type: 'smoothstep' },
      { id: 'e7', source: '3', target: '7', style: { stroke: '#EF4444', strokeWidth: 1 } },
      { id: 'e8', source: '3', target: '8', style: { stroke: '#F59E0B', strokeWidth: 1 } },
    ],
  },
}

const diagramData = computed(() => diagrams[props.diagram])
const isClient = ref(false)
const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null)

onMounted(() => { isClient.value = true })

function handleFitView() {
  // Access the Vue Flow instance and call fitView after a tick
  const instance = vueFlowRef.value
  if (instance) {
    (instance as any).fitView({ padding: 0.15 })
  }
}
</script>

<template>
  <div v-if="isClient && diagramData" class="arc-flow-wrapper" :style="{ height: flowHeight }">
    <VueFlow
      ref="vueFlowRef"
      :nodes="diagramData.nodes"
      :edges="diagramData.edges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :zoom-on-scroll="true"
      :pan-on-scroll="true"
      :pan-on-drag="true"
      :zoom-on-double-click="false"
      :prevent-scrolling="false"
      :min-zoom="0.3"
      :max-zoom="2"
      :fit-view-on-init="true"
      :fit-view-on-init-padding="0.2"
    >
      <template #node-arc="nodeProps">
        <ArcFlowNode v-bind="nodeProps" />
      </template>
    </VueFlow>

    <!-- Minimal custom controls -->
    <div class="arc-flow-controls">
      <button class="arc-flow-btn" title="Fit to view" @click="handleFitView">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>
    </div>
  </div>
  <div v-else-if="!diagramData" class="arc-flow-fallback">
    Unknown diagram: {{ diagram }}
  </div>
</template>

<style>
@import '@vue-flow/core/dist/style.css';

.arc-flow-wrapper {
  position: relative;
  border: 1px solid #222;
  border-radius: 8px;
  background: #0A0A0A;
  margin: 16px 0;
  overflow: hidden;
}

/* Override Vue Flow background */
.arc-flow-wrapper .vue-flow {
  background: #0A0A0A !important;
}

/* Edge labels */
.arc-flow-wrapper .vue-flow__edge-textbg {
  fill: #0A0A0A;
}

.arc-flow-wrapper .vue-flow__edge-text {
  fill: #999;
  font-family: 'Space Mono', monospace;
  font-size: 10px;
}

/* Animated edge dash */
.arc-flow-wrapper .vue-flow__edge.animated path {
  stroke-dasharray: 5;
  animation: arc-flow-dash 1s linear infinite;
}

@keyframes arc-flow-dash {
  to { stroke-dashoffset: -10; }
}

/* Hide default attribution */
.arc-flow-wrapper .vue-flow__attribution {
  display: none !important;
}

/* Custom controls */
.arc-flow-controls {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  z-index: 10;
}

.arc-flow-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #1A1A1A;
  border: 1px solid #333;
  border-radius: 4px;
  color: #999;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}

.arc-flow-btn:hover {
  border-color: #2563EB;
  color: #E8E8E8;
}

/* Pan cursor */
.arc-flow-wrapper .vue-flow__pane {
  cursor: grab;
}

.arc-flow-wrapper .vue-flow__pane:active {
  cursor: grabbing;
}

.arc-flow-fallback {
  color: #666;
  font-family: 'Space Mono', monospace;
  font-size: 12px;
  padding: 24px;
  text-align: center;
}
</style>
