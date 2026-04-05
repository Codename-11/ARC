<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
  data: {
    label: string
    color?: string
    accent?: boolean
  }
  sourcePosition?: Position
  targetPosition?: Position
}>()
</script>

<template>
  <div class="arc-flow-node" :class="{ 'arc-flow-node--accent': data.accent }">
    <Handle v-if="targetPosition" type="target" :position="targetPosition ?? Position.Left" />
    <span class="arc-flow-node__label">{{ data.label }}</span>
    <Handle v-if="sourcePosition" type="source" :position="sourcePosition ?? Position.Right" />
  </div>
</template>

<style>
.arc-flow-node {
  background: #0A0A0A;
  border: 1px solid #2A2A2A;
  border-radius: 8px;
  padding: 8px 16px;
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.03em;
  color: #E8E8E8;
  white-space: nowrap;
  transition: border-color 0.2s;
}

.arc-flow-node:hover {
  border-color: #2563EB;
}

.arc-flow-node--accent {
  border-color: #2563EB;
  box-shadow: 0 0 12px rgba(37, 99, 235, 0.15);
}

.arc-flow-node__label {
  display: block;
  text-align: center;
}

/* Hide default handles — they still work for edge connections */
.arc-flow-node .vue-flow__handle {
  width: 6px;
  height: 6px;
  background: #444;
  border: none;
  transition: background 0.2s;
}

.arc-flow-node:hover .vue-flow__handle {
  background: #2563EB;
}
</style>
