/**
 * Orchestration layer — drives the hook pipeline proactively.
 *
 * Public exports:
 *   - Adaptive delivery policy + EMA latency tracking (`delivery-policy.ts`)
 *   - Staged PLAN/EXEC/VERIFY workflow (`staged-workflow.ts`)
 *   - Stall watchdog (`watchdog.ts`)
 *   - Roundtable orchestrator (`roundtable.ts`)
 */

// Delivery policy
export {
  computeAdaptiveGraceMs,
  createDeliveryState,
  resolveDeliveryPolicyForTool,
  updateReplyLatencyAverage,
  MessagePriorityQueue,
  type AgentDeliveryPolicy,
  type DeliveryState,
  type MessagePriority,
  type PriorityQueueItem,
} from "./delivery-policy.js";

// Staged workflow
export {
  DEFAULT_COMPLETION_PATTERNS,
  InMemoryMessageBus,
  StagedWorkflowManager,
  type MessageBusReadResult,
  type StagedMessage,
  type StagedMessageBus,
  type StagedPhase,
  type StagedWorkflowConfig,
  type StagedWorkflowManagerDeps,
  type StagedWorkflowResult,
  type StagedWorkflowTerminal,
} from "./staged-workflow.js";

// Watchdog
export {
  AgentWatchdog,
  isLowSignalWatchdogReply,
  WATCHDOG_NUDGE_AFTER_MS,
  WATCHDOG_NUDGE_TEXT,
  WATCHDOG_STALL_AFTER_MS,
  WATCHDOG_STALL_OPTIONS,
  type AgentWatchdogDeps,
  type WatchdogEvent,
  type WatchdogEventType,
} from "./watchdog.js";

// Roundtable
export {
  RoundtableOrchestrator,
  type RoundtableAgent,
  type RoundtableEvent,
  type RoundtableMessage,
  type RoundtableOrchestratorOptions,
  type RoundtableResult,
  type RoundtableRole,
  type RoundtableRunOptions,
} from "./roundtable.js";
