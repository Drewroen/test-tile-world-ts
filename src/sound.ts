import {
  Ruleset,
  SND_CHIP_LOSES,
  SND_CHIP_WINS,
  SND_TIME_OUT,
  SND_TIME_LOW,
  SND_CANT_MOVE,
  SND_IC_COLLECTED,
  SND_ITEM_COLLECTED,
  SND_BOOTS_STOLEN,
  SND_TELEPORTING,
  SND_DOOR_OPENED,
  SND_SOCKET_OPENED,
  SND_BUTTON_PUSHED,
  SND_TILE_EMPTIED,
  SND_WALL_CREATED,
  SND_TRAP_ENTERED,
  SND_BOMB_EXPLODES,
  SND_WATER_SPLASH,
  SND_BLOCK_MOVING,
  SND_SKATING_FORWARD,
  SND_SKATING_TURN,
  SND_SLIDING,
  SND_SLIDEWALKING,
  SND_ICEWALKING,
  SND_WATERWALKING,
  SND_FIREWALKING,
  SND_COUNT,
} from "tworld-engine";

// One-shot sound ids occupy bits [0, SND_ONESHOT_COUNT); loop ids occupy
// [SND_ONESHOT_COUNT, SND_COUNT). Mirrors defs.h's SND_ONESHOT_COUNT=18
// (tworld-engine doesn't export this specific constant, so it's
// transcribed directly — see tworld-engine/src/constants.ts:173).
const SND_ONESHOT_COUNT = 18;

// Filename mapping transcribed directly from tworld/res/rc: the
// ruleset-agnostic top section, then the [MS] and [Lynx] override
// sections. Any id missing from a ruleset's table (e.g. SND_TILE_EMPTIED
// under MS) is simply never triggered by that ruleset's game logic.
const GLOBAL_FILES: Partial<Record<number, string>> = {
  [SND_CHIP_WINS]: "tada.wav",
  [SND_ITEM_COLLECTED]: "ting.wav",
  [SND_BOOTS_STOLEN]: "thief.wav",
  [SND_TELEPORTING]: "teleport.wav",
  [SND_DOOR_OPENED]: "door.wav",
  [SND_BUTTON_PUSHED]: "click.wav",
  [SND_BOMB_EXPLODES]: "bomb.wav",
  [SND_WATER_SPLASH]: "splash.wav",
};

const MS_FILES: Partial<Record<number, string>> = {
  [SND_CHIP_LOSES]: "death.wav",
  [SND_TIME_OUT]: "ding.wav",
  [SND_TIME_LOW]: "tick.wav",
  [SND_IC_COLLECTED]: "chack.wav",
  [SND_CANT_MOVE]: "oof.wav",
  [SND_SOCKET_OPENED]: "socket.wav",
};

const LYNX_FILES: Partial<Record<number, string>> = {
  [SND_CHIP_LOSES]: "derezz.wav",
  [SND_IC_COLLECTED]: "ting.wav",
  [SND_CANT_MOVE]: "bump.wav",
  [SND_SOCKET_OPENED]: "door.wav",
  [SND_TILE_EMPTIED]: "whisk.wav",
  [SND_WALL_CREATED]: "popup.wav",
  [SND_TRAP_ENTERED]: "bump.wav",
  [SND_BLOCK_MOVING]: "block.wav",
  [SND_SKATING_FORWARD]: "skate.wav",
  [SND_SKATING_TURN]: "skaturn.wav",
  [SND_SLIDING]: "force.wav",
  [SND_SLIDEWALKING]: "slurp.wav",
  [SND_ICEWALKING]: "snick.wav",
  [SND_WATERWALKING]: "plip.wav",
  [SND_FIREWALKING]: "crackle.wav",
};

function fileFor(id: number, ruleset: number): string | undefined {
  const rulesetFiles = ruleset === Ruleset.MS ? MS_FILES : LYNX_FILES;
  return rulesetFiles[id] ?? GLOBAL_FILES[id];
}

export class SoundPlayer {
  private readonly elementsByFile = new Map<string, HTMLAudioElement>();
  private prevLoopBits = 0;
  private unlocked = false;

  private constructor() {}

  static async load(baseUrl: string): Promise<SoundPlayer> {
    const player = new SoundPlayer();
    const filenames = new Set<string>([
      ...Object.values(GLOBAL_FILES),
      ...Object.values(MS_FILES),
      ...Object.values(LYNX_FILES),
    ] as string[]);
    for (const filename of filenames) {
      const el = new Audio(`${baseUrl}sounds/${filename}`);
      el.preload = "auto";
      player.elementsByFile.set(filename, el);
    }
    return player;
  }

  // iOS Safari requires the very first play() on each element to happen
  // synchronously inside a user-gesture handler, not merely "sometime
  // after" one (unlike Chrome's looser per-domain activation). Call this
  // once, directly from the same keydown/touchstart handler that starts
  // the game, to unlock every element for later programmatic playback.
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const el of this.elementsByFile.values()) {
      el.play()
        .then(() => el.pause())
        .catch(() => {});
    }
  }

  private play(id: number, ruleset: number): void {
    const filename = fileFor(id, ruleset);
    if (!filename) return;
    const el = this.elementsByFile.get(filename);
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  }

  private startLoop(id: number, ruleset: number): void {
    const filename = fileFor(id, ruleset);
    if (!filename) return;
    const el = this.elementsByFile.get(filename);
    if (!el) return;
    el.loop = true;
    el.currentTime = 0;
    el.play().catch(() => {});
  }

  private stopLoop(id: number, ruleset: number): void {
    const filename = fileFor(id, ruleset);
    if (!filename) return;
    const el = this.elementsByFile.get(filename);
    if (!el) return;
    el.pause();
    el.loop = false;
  }

  // Reads the engine's per-tick soundeffects bitmask (call once per
  // doTurn(), immediately after it). One-shot bits are always fresh
  // events (the engine clears them at the start of every doTurn — see
  // tworld-engine/src/game.ts:80 — so no diffing is needed). Loop bits
  // persist until explicitly cleared by game logic, so they're diffed
  // against the previous call's bits to detect start/stop transitions.
  sync(bits: number, ruleset: number): void {
    for (let id = 0; id < SND_ONESHOT_COUNT; id++) {
      if (bits & (1 << id)) this.play(id, ruleset);
    }
    for (let id = SND_ONESHOT_COUNT; id < SND_COUNT; id++) {
      const nowOn = (bits & (1 << id)) !== 0;
      const wasOn = (this.prevLoopBits & (1 << id)) !== 0;
      if (nowOn && !wasOn) this.startLoop(id, ruleset);
      else if (!nowOn && wasOn) this.stopLoop(id, ruleset);
    }
    this.prevLoopBits = bits & ~((1 << SND_ONESHOT_COUNT) - 1);
  }

  // Stops any lingering loop sounds and forgets loop state — call when a
  // level (re)starts, so a loop left playing from the previous level
  // (e.g. a block was sliding when the player hit Restart) doesn't keep
  // playing forever.
  reset(): void {
    for (const el of this.elementsByFile.values()) {
      el.pause();
      el.loop = false;
    }
    this.prevLoopBits = 0;
  }
}
