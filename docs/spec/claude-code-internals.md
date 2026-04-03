# Claude Code Internals Extraction
## Source: `@anthropic-ai/claude-code` npm package v2.1.90 + instructkr/claw-code repo

---

## 1. SPINNER VERBS — Complete List

Source: `constants/spinnerVerbs.ts` (extracted from bundled `cli.js` as variable `zr1`)

```typescript
const SPINNER_VERBS = [
  "Accomplishing", "Actioning", "Actualizing", "Architecting",
  "Baking", "Beaming", "Beboppin'", "Befuddling", "Billowing", "Blanching",
  "Bloviating", "Boogieing", "Boondoggling", "Booping", "Bootstrapping", "Brewing",
  "Bunning", "Burrowing",
  "Calculating", "Canoodling", "Caramelizing", "Cascading", "Catapulting",
  "Cerebrating", "Channeling", "Channelling", "Choreographing", "Churning",
  "Clauding", "Coalescing", "Cogitating", "Combobulating", "Composing",
  "Computing", "Concocting", "Considering", "Contemplating", "Cooking",
  "Crafting", "Creating", "Crunching", "Crystallizing", "Cultivating",
  "Deciphering", "Deliberating", "Determining", "Dilly-dallying",
  "Discombobulating", "Doing", "Doodling", "Drizzling",
  "Ebbing", "Effecting", "Elucidating", "Embellishing", "Enchanting",
  "Envisioning", "Evaporating",
  "Fermenting", "Fiddle-faddling", "Finagling", "Flambéing",
  "Flibbertigibbeting", "Flowing", "Flummoxing", "Fluttering", "Forging",
  "Forming", "Frolicking", "Frosting",
  "Gallivanting", "Galloping", "Garnishing", "Generating", "Gesticulating",
  "Germinating", "Gitifying", "Grooving", "Gusting",
  "Harmonizing", "Hashing", "Hatching", "Herding", "Honking",
  "Hullaballooing", "Hyperspacing",
  "Ideating", "Imagining", "Improvising", "Incubating", "Inferring",
  "Infusing", "Ionizing",
  "Jitterbugging", "Julienning",
  "Kneading",
  "Leavening", "Levitating", "Lollygagging",
  "Manifesting", "Marinating", "Meandering", "Metamorphosing", "Misting",
  "Moonwalking", "Moseying", "Mulling", "Mustering", "Musing",
  "Nebulizing", "Nesting", "Newspapering", "Noodling", "Nucleating",
  "Orbiting", "Orchestrating", "Osmosing",
  "Perambulating", "Percolating", "Perusing", "Philosophising",
  "Photosynthesizing", "Pollinating", "Pondering", "Pontificating",
  "Pouncing", "Precipitating", "Prestidigitating", "Processing", "Proofing",
  "Propagating", "Puttering", "Puzzling",
  "Quantumizing",
  "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating",
  "Roosting", "Ruminating",
  "Sautéing", "Scampering", "Schlepping", "Scurrying", "Seasoning",
  "Shenaniganing", "Shimmying", "Simmering", "Skedaddling", "Sketching",
  "Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning",
  "Sprouting", "Stewing", "Sublimating", "Swirling", "Swooping",
  "Symbioting", "Synthesizing",
  "Tempering", "Thinking", "Thundering", "Tinkering", "Tomfoolering",
  "Topsy-turvying", "Transfiguring", "Transmuting", "Twisting",
  "Undulating", "Unfurling", "Unravelling",
  "Vibing",
  "Waddling", "Wandering", "Warping", "Whatchamacalliting", "Whirlpooling",
  "Whirring", "Whisking", "Wibbling", "Working", "Wrangling",
  "Zesting", "Zigzagging"
];
// Total: ~175 verbs
```

### Verb Selection Mechanism

```typescript
// Function: Pj6() — resolves the active verb list
function getSpinnerVerbs() {
  const config = getConfig().spinnerVerbs; // from user settings
  if (!config) return SPINNER_VERBS;        // default list
  if (config.mode === "replace") {
    return config.verbs.length > 0 ? config.verbs : SPINNER_VERBS;
  }
  // mode === "append"
  return [...SPINNER_VERBS, ...config.verbs];
}

// Selection: random pick from the resolved list each spinner tick
// Config schema:
// spinnerVerbs: { mode: "append" | "replace", verbs: string[] }
```

### Turn Completion Verbs

**Finding: There is NO separate `turnCompletionVerbs` array in the current build.** The file `constants/turnCompletionVerbs.ts` exists in the claw-code metadata but the actual npm package does not contain a distinct completion verb list. The spinner simply stops and the completion state shows a checkmark (✔) with the task label, not a past-tense verb.

---

## 2. `/buddy` SYSTEM — Complete Implementation

### Architecture Overview

The buddy system consists of:
- **Deterministic bone generation** (species/eye/hat/stats from a seeded PRNG)
- **API-powered soul generation** (name + personality via Claude)
- **API-powered reactions** (commentary on coding events)
- **ASCII sprite rendering** with animation frames
- **Companion intro injection** into the system prompt

### Species (18 total)

Extracted from sprite data keys (RFK object) — each species has 3 animation frames (5 lines of ASCII art each):

1. axolotl, bear, bunny, cat, crab, dragon, fox, frog, hamster, hedgehog, jellyfish, octopus, owl, penguin, snail, turtle, bat, moth

(Plus: mouse, panda, raccoon, squirrel, firefly, star — found in broader search but may be aliases or unused)

### Eye Types
```
["·", "✦", "×", "◉", "@", "°"]
```

### Hat/Accessory Types
```typescript
const HATS = ["none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"];

// Hat ASCII decorations:
const HAT_ART = {
  none: "",
  crown:     "   \\^^^/    ",
  tophat:    "   [___]    ",
  propeller: "    -+-     ",
  halo:      "   (   )    ",
  wizard:    "    /^\\     ",
  beanie:    "   (___)    ",
  tinyduck:  "    ,>      "
};
```

### Rarity System
```typescript
// Rarity weights (ER1) — probability distribution
const RARITY_WEIGHTS = {
  common:    60,  // 60% chance
  uncommon:  25,  // 25% chance
  rare:      10,  // 10% chance
  epic:       4,  // 4% chance
  legendary:  1   // 1% chance
};

// Base stat values per rarity (kV_)
const RARITY_BASE_STATS = {
  common:     5,
  uncommon:  15,
  rare:      25,
  epic:      35,
  legendary: 50
};
```

### Stats System
```typescript
const STAT_NAMES = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];

// Stats generation (VV_):
function generateStats(rng, rarity) {
  const base = RARITY_BASE_STATS[rarity];
  const primary = pickRandom(rng, STAT_NAMES);
  let secondary = pickRandom(rng, STAT_NAMES);
  while (secondary === primary) secondary = pickRandom(rng, STAT_NAMES);
  
  const stats = {};
  for (const stat of STAT_NAMES) {
    if (stat === primary) {
      stats[stat] = Math.min(100, base + 50 + Math.floor(rng() * 30));
    } else if (stat === secondary) {
      stats[stat] = Math.max(1, base - 10 + Math.floor(rng() * 15));
    } else {
      stats[stat] = base + Math.floor(rng() * 40);
    }
  }
  return stats;
}
```

### Bone Generation (Deterministic from user ID)
```typescript
// Seed: FNV-1a hash of `${userAccountUuid}friend-2026-401`
// Then: SplitMix32 PRNG seeded with that hash
// Produces: { rarity, species, eye, hat, shiny (1% chance), stats, inspirationSeed }

function generateBones(seedString) {
  const hash = fnv1a(seedString);      // vV_ — FNV-1a hash
  const rng = splitmix32(hash);         // GV_ — SplitMix32 PRNG
  return {
    bones: {
      rarity: rollRarity(rng),           // TV_ — weighted random from RARITY_WEIGHTS
      species: pickRandom(rng, SPECIES), // yT6 — uniform random pick
      eye: pickRandom(rng, EYES),
      hat: rarity === "common" ? "none" : pickRandom(rng, HATS),
      shiny: rng() < 0.01,              // 1% chance
      stats: generateStats(rng, rarity)
    },
    inspirationSeed: Math.floor(rng() * 1e9)
  };
}
```

### Soul Generation (API-powered name + personality)

```typescript
// System prompt (ACY):
const COMPANION_SOUL_PROMPT = `You generate coding companions — small creatures that live in a developer's terminal and occasionally comment on their work.

Given a rarity, species, stats, and a handful of inspiration words, invent:
- A name: ONE word, max 12 characters. Memorable, slightly absurd. No titles, no "the X", no epithets. Think pet name, not NPC name. The inspiration words are loose anchors — riff on one, mash two syllables, or just use the vibe. Examples: Pith, Dusker, Crumb, Brogue, Sprocket.
- A one-sentence personality (specific, funny, a quirk that affects how they'd comment on code — should feel consistent with the stats)

Higher rarity = weirder, more specific, more memorable. A legendary should be genuinely strange.
Don't repeat yourself — every companion should feel distinct.`;

// Output schema: { name: string (1-14 chars), personality: string }

// Fallback names if API fails:
const FALLBACK_NAMES = ["Crumpet", "Soup", "Pickle", "Biscuit", "Moth", "Gravy"];
// Fallback personality: `A ${rarity} ${species} of few words.`
```

### Inspiration Word Pool (130+ words)
```
"thunder", "biscuit", "void", "accordion", "moss", "velvet", "rust", "pickle",
"crumb", "whisper", "gravy", "frost", "ember", "soup", "marble", "thorn",
"honey", "static", "copper", "dusk", "sprocket", "bramble", "cinder", "wobble",
"drizzle", "flint", "tinsel", "murmur", "clatter", "gloom", "nectar", "quartz",
"shingle", "tremor", "umber", "waffle", "zephyr", "bristle", "dapple", "fennel",
"gristle", "huddle", "kettle", "lumen", "mottle", "nuzzle", "pebble", "quiver",
"ripple", "sable", "thistle", "vellum", "wicker", "yonder", "bauble", "cobble",
"doily", "fickle", "gambit", "hubris", "jostle", "knoll", "larder", "mantle",
"nimbus", "oracle", "plinth", "quorum", "relic", "spindle", "trellis", "urchin",
"vortex", "warble", "xenon", "yoke", "zenith", "alcove", "brogue", "chisel",
"dirge", "epoch", "fathom", "glint", "hearth", "inkwell", "jetsam", "kiln",
"lattice", "mirth", "nook", "obelisk", "parsnip", "quill", "rune", "sconce",
"tallow", "umbra", "verve", "wisp", "yawn", "apex", "brine", "crag", "dregs",
"etch", "flume", "gable", "husk", "ingot", "jamb", "knurl", "loam", "mote",
"nacre", "ogle", "prong", "quip", "rind", "slat", "tuft", "vane", "welt",
"yarn", "bane", "clove", "dross", "eave", "fern", "grit", "hive", "jade",
"keel", "lilt", "muse", "nape", "omen", "pith", "rook", "silt", "tome",
"urge", "vex", "wane", "yew", "zest"
```

### Reaction System (API-powered)

**Trigger events:**
- `"hatch"` — First companion creation (sends project description)
- `"turn"` — After each assistant turn
- `"pet"` — When user runs `/buddy pet`
- `"error"` — Detected via regex: `/\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]/i`
- `"test-fail"` — Detected via regex: `/\b[1-9]\d* (failed|failing)\b|\btests? failed\b|^FAIL(ED)?\b| ✗ | ✘ /im`
- `"large-diff"` — When diff has many changed lines
- `"addressed"` — When user mentions the companion by name

**API call:**
```typescript
POST /api/organizations/{orgUuid}/claude_code/buddy_react
{
  name: companion.name.slice(0, 32),
  personality: companion.personality.slice(0, 200),
  species: companion.species,
  rarity: companion.rarity,
  stats: companion.stats,
  transcript: transcriptContext.slice(0, 5000),
  reason: triggerReason,  // "turn" | "hatch" | "pet" | "error" | "test-fail" | "large-diff"
  recent: recentReactions.map(r => r.slice(0, 200)),
  addressed: boolean
}
// Returns: { reaction: string }
```

### Companion Intro (System Prompt Injection)

When a companion is active, this is injected into the conversation:

```markdown
# Companion

A small ${species} named ${name} sits beside the user's input box and occasionally
comments in a speech bubble. You're not ${name} — it's a separate watcher.

When the user addresses ${name} directly (by name), its bubble will answer. Your job
in that moment is to stay out of the way: respond in ONE line or less, or just answer
any part of the message meant for you. Don't explain that you're not ${name} — they
know. Don't narrate what ${name} might say — the bubble handles that.
```

### Availability Gate
```typescript
// Only available for first-party (Anthropic) users, after April 2026
function isBuddyAvailable() {
  if (getAuthProvider() !== "firstParty") return false;
  if (isHeadless()) return false;
  const now = new Date();
  return now.getFullYear() > 2026 || 
         (now.getFullYear() === 2026 && now.getMonth() >= 3); // April 2026+
}
```

### Example Sprite (Cat species)
```
            
   /\_/\    
  ( {E}   {E})  
  (  ω  )   
  (")_(")   

// {E} is replaced with the selected eye character
// Frame 2 adds a tail wiggle: (")_(")~
// Frame 3 changes face: /\-/\  (ears flatten)
```

---

## 3. `/dream` COMMAND — Memory Consolidation

### What It Is

`/dream` is NOT a slash command — it's a **background task type** called `DreamTask`. It performs automated memory consolidation: reviewing recent session transcripts and synthesizing durable memories.

### Implementation

```typescript
const DreamTask = {
  name: "DreamTask",
  type: "dream",
  
  async kill(state, setState) {
    // Aborts the running dream, restores prior mtime
    setState(s => {
      if (s.status !== "running") return s;
      s.abortController?.abort();
      return { ...s, status: "killed", endTime: Date.now(), notified: true, abortController: undefined };
    });
  }
};

// Dream state:
interface DreamState {
  type: "dream";
  status: "running" | "killed" | "completed";
  phase: "starting" | ...;
  sessionsReviewing: string[];
  filesTouched: string[];
  turns: Turn[];
  abortController: AbortController;
  priorMtime: number;
}
```

### Auto-Dream Configuration

```typescript
// Settings:
autoDreamEnabled: boolean  // "Enable background memory consolidation (auto-dream)"
// When enabled, dreams run automatically in the background
```

### Dream System Prompt

The full dream prompt instructs the agent to:

```markdown
# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize
what you've learned recently into durable, well-organized memories so that future
sessions can orient quickly.

Memory directory: `${memoryDir}`
Session transcripts: `${transcriptDir}` (large JSONL files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient
- `ls` the memory directory to see what already exists
- Read `${INDEX_FILE}` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If `logs/` or `sessions/` subdirectories exist, review recent entries

## Phase 2 — Gather recent signal
Look for new information worth persisting. Sources in priority order:
1. **Daily logs** (`logs/YYYY/MM/YYYY-MM-DD.md`) if present
2. **Existing memories that drifted** — facts contradicting current codebase
3. **Transcript search** — grep JSONL transcripts for narrow terms

Don't exhaustively read transcripts. Look only for things you suspect matter.

## Phase 3 — Consolidate
For each thing worth remembering, write or update a memory file. Focus on:
- Merging new signal into existing topic files (not creating duplicates)
- Converting relative dates to absolute dates
- Deleting contradicted facts

## Phase 4 — Prune and index
Update the index file so it stays under N lines AND under ~25KB.
It's an **index**, not a dump — each entry: `- [Title](file.md) — one-line hook`

- Remove pointers to stale/wrong/superseded memories
- Demote verbose entries (move detail to topic files)
- Add pointers to newly important memories
- Resolve contradictions between files

Return a brief summary of what you consolidated, updated, or pruned.
```

---

## 4. COMPLETE SLASH COMMAND REGISTRY

From the commands_snapshot.json (TS source paths) — **all 170+ commands**:

### Core Commands
`help`, `status`, `compact`, `model`, `permissions`, `clear`, `cost`, `resume`, `config`, `memory`, `init`, `diff`, `version`, `exit`

### Git Commands  
`branch`, `commit`, `commit-push-pr`, `pr`, `issue`, `worktree`

### Workspace Commands
`add-dir`, `context`, `files`, `env`, `teleport`

### Agent/Automation Commands
`agents`, `skills`, `tasks`, `ultraplan`, `plan`, `bughunter`, `debug-tool-call`, `review`

### Social/Sharing Commands
`share`, `export`, `copy`, `session`, `feedback`

### Plugin/Extension Commands
`plugin`, `marketplace`, `reload-plugins`, `install`, `mcp`

### UI/UX Commands
`color`, `theme`, `output-style`, `vim`, `keybindings`, `brief`, `voice`, `stickers`, `buddy`

### System Commands
`doctor`, `login`, `logout`, `upgrade`, `permissions`, `privacy-settings`, `sandbox-toggle`

### Advanced/Internal Commands
`ant-trace`, `bridge`, `bridge-kick`, `btw`, `chrome`, `desktop`, `ide`, `mobile`, `remote-env`, `remote-setup`, `effort`, `fast`, `good-claw`, `heapdump`, `mock-limits`, `perf-issue`, `rate-limit-options`, `release-notes`, `rename`, `reset-limits`, `rewind`, `security-review`, `stats`, `statusline`, `summary`, `tag`, `thinkback`, `thinkback-play`, `passes`, `onboarding`

---

## 5. RUST PORT — Key Implementation Details

The Rust port at `rust/crates/` has:
- **Spinner** (in `render.rs`): Uses braille characters `["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]` with color states (active=Blue, done=Green, failed=Red)
- **25 slash commands** implemented (vs 170+ in TS)
- **No buddy system** in Rust port
- **No dream task** in Rust port
- **No spinner verbs** in Rust port — it uses a simple label passed to the spinner

---

## Key Architectural Patterns for ARC

1. **Deterministic Procedural Generation**: Buddy bones use FNV-1a → SplitMix32 PRNG chain from user ID, ensuring same user always gets same companion base traits
2. **API-augmented generation**: Base traits are deterministic, but personality/name are generated via API call with structured output schema
3. **Event-driven reactions**: Regex pattern matching on tool output triggers companion reactions via dedicated API endpoint
4. **Background task system**: DreamTask is a background task type with its own state machine (running/killed/completed), abort controller, and phase tracking
5. **Config extensibility**: Spinner verbs support `append` or `replace` modes, allowing user customization while preserving defaults
6. **System prompt injection**: Companion awareness is injected as a section in the system prompt, teaching the main agent to coexist with the buddy's speech bubble
