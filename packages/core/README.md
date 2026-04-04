# @axiom-labs/arc-core

> Core library for ARC -- config, profiles, hooks, memory, skills, tasks, telemetry, and more.

Part of the [ARC](https://arc-cli.dev) monorepo ([GitHub](https://github.com/Codename-11/ARC)) -- Agent Runtime Control.

## What This Package Does

Provides the foundational primitives that every other ARC package depends on. It includes the profile/config system, a composable hook pipeline with risk classification, adapter interfaces for agent runtimes, a memory system with search and extraction, skill registry, task management, session continuity, cloud sync, plugin registry, telemetry, and the Dark Factory autonomous execution controller.

## Main Exports

- **Config & Profiles** -- `ArcConfig`, `Profile`, `ArcSettings`, `SharedManifest`, and config read/write utilities
- **Hook Pipeline** -- `HookBus`, `createDefaultPipeline`, `riskDetectionHook`, `sourceClassifyHook`, `classifyRisk`, `createSupervisionGateHook`, `createPostVerifyHook`, `auditCompletion`
- **Adapter Types** -- `RuntimeAdapter`, `AdapterCapabilities` for building agent-specific adapters
- **Memory System** -- `SessionMemory`, `PersistentMemory`, `searchMemories`, `extractMemories`
- **Skill System** -- `SkillRegistry`, `loadSkillsFromDirectory`, `mcpToSkill`, `StuckDetector`, `detectRepeatedPatterns`
- **Task Management** -- `TaskStore`, `MessageBus`, `CronStore`, `parseCronExpression`
- **Session Continuity** -- `SessionStore`, `isResumeIntent`
- **Permissions** -- `createPermissionPolicy`, `evaluatePermission` (three-tier: coordinator, interactive, worker)
- **Context Management** -- `ContextManager`, `estimateTokens`
- **Stream Events** -- `StreamEventBus` with typed event taxonomy
- **Phase Indicators** -- `detectPhase`, `getPhaseVerb` for semantic agent phase detection
- **Cloud Sync** -- `SyncManager`, `FilesystemSyncProvider`
- **Plugin Registry** -- `PluginRegistry` with manifest and capability types
- **Remote Agents** -- `RemoteAgentRegistry`, `checkHealth`
- **Dark Factory** -- `FactoryController` for autonomous multi-wave task execution
- **Telemetry** -- `TelemetryProvider`, `ConsoleExporter`, `JsonFileExporter`, `OtlpExporter`, span helpers
- **Utilities** -- `CircuitBreaker`, secrets/keyring, logging, health checks, lifecycle, workspace, shared-layer sync

## Usage

```typescript
import {
  HookBus,
  createDefaultPipeline,
  classifyRisk,
  SessionMemory,
  TaskStore,
  SkillRegistry,
} from "@axiom-labs/arc-core";

const pipeline = createDefaultPipeline();
const bus = new HookBus(pipeline);

const risk = classifyRisk("rm -rf /");
// => { tier: "destructive", confidence: 1.0, ... }

const memory = new SessionMemory();
memory.add({ type: "fact", content: "User prefers TypeScript", scope: "session" });
```

## Development

```bash
cd packages/core
pnpm typecheck
pnpm build
```

## License

MIT
