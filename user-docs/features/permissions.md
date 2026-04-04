# Permission Model

ARC enforces a three-tier permission model that controls what tools and operations each agent profile is allowed to perform. Permissions are evaluated at launch and during the hook pipeline.

## Permission Tiers

### Coordinator

Full access to all tools with no restrictions. Intended for top-level orchestrating agents that manage other agents.

```json
{
  "allowPrefixes": ["*"],
  "denyPrefixes": [],
  "requireApproval": [],
  "auditLog": true
}
```

Use this tier for your primary orchestration profile in [Dark Factory](/features/factory) setups.

### Interactive

Standard access with approval gates for destructive operations. Intended for human-facing agents where the user can confirm dangerous actions.

```json
{
  "allowPrefixes": ["read", "glob", "grep", "write", "edit", "bash", "powershell", "notebook", "web", "mcp"],
  "denyPrefixes": [],
  "requireApproval": ["delete", "deploy", "spawn", "push", "force", "reset", "destroy"],
  "auditLog": true
}
```

This is the default tier for most profiles. Tools matching `requireApproval` prefixes trigger a confirmation prompt before execution.

### Worker

Degraded access with destructive operations denied outright. Intended for background and automated sub-agents that should not be able to delete, deploy, or push without human oversight.

```json
{
  "allowPrefixes": ["read", "glob", "grep", "write", "edit", "bash", "powershell", "notebook"],
  "denyPrefixes": ["delete", "spawn", "deploy", "push", "force", "reset", "destroy"],
  "requireApproval": [],
  "auditLog": true
}
```

Workers cannot perform destructive operations at all — there is no approval path.

## Evaluation Order

When a tool is invoked, ARC evaluates the permission policy in this order:

1. **Deny prefixes** — if the tool name matches any deny prefix, the action is blocked immediately
2. **Require approval** — if it matches an approval prefix, the user is prompted to confirm
3. **Allow prefixes** — if it matches an allow prefix (or the wildcard `*`), the action proceeds
4. **Default deny** — if no prefix matches, the action is denied

## Configuring Permissions

Set the permission tier in your profile configuration:

```bash
# During profile creation, choose the tier
arc create worker-agent --tool claude

# Or edit the profile's config to set the tier
```

In the profile's configuration, the tier maps to a `PermissionPolicy` that is evaluated at launch:

```typescript
const policy = createPermissionPolicy("worker");
const decision = evaluatePermission(policy, "delete");
// decision → "deny"
```

## Integration with Launch

When `arc launch` starts an agent, it evaluates the profile's permission policy:

- **allow** — the launch proceeds without comment
- **ask** — a log entry is created noting approval is required
- **deny** — a warning is logged that the permission policy denies the tool

## Integration with Dark Factory

In Dark Factory mode, the coordinator profile typically uses the `coordinator` tier, while spawned worker agents use the `worker` tier. This ensures workers cannot perform destructive operations even if instructed to by the coordinator.

## Audit Logging

All permission evaluations are logged when `auditLog` is enabled (the default for all tiers). Denied and approval-required decisions generate structured log events that can be reviewed with `arc logs`.
