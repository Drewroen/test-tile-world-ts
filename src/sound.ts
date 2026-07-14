import {
  Ruleset,
  SND_COUNT,
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
} from "tworld-engine";

// Filenames and the SND_* -> file mapping are transcribed from tworld's own
// default resource config (res/rc): sounds shared by both rulesets live in
// the unqualified section, the rest are overridden per-ruleset under
// [MS]/[Lynx]. Indices with no entry in a ruleset's table are events the
// original game plays silently under that ruleset.
const SHARED: Partial<Record<number, string>> = {
  [SND_CHIP_WINS]: "tada.wav",
  [SND_ITEM_COLLECTED]: "ting.wav",
  [SND_BOOTS_STOLEN]: "thief.wav",
  [SND_TELEPORTING]: "teleport.wav",
  [SND_DOOR_OPENED]: "door.wav",
  [SND_BUTTON_PUSHED]: "click.wav",
  [SND_BOMB_EXPLODES]: "bomb.wav",
  [SND_WATER_SPLASH]: "splash.wav",
};

const MS: Partial<Record<number, string>> = {
  [SND_CHIP_LOSES]: "death.wav",
  [SND_TIME_OUT]: "ding.wav",
  [SND_TIME_LOW]: "tick.wav",
  [SND_IC_COLLECTED]: "chack.wav",
  [SND_CANT_MOVE]: "oof.wav",
  [SND_SOCKET_OPENED]: "socket.wav",
};

const LYNX: Partial<Record<number, string>> = {
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

function soundFile(index: number, ruleset: Ruleset): string | undefined {
  const table = ruleset === Ruleset.MS ? MS : LYNX;
  return table[index] ?? SHARED[index];
}

const ALL_FILES = Array.from(
  new Set([...Object.values(SHARED), ...Object.values(MS), ...Object.values(LYNX)].filter((f): f is string => !!f)),
);

// SND indices below this threshold are one-shot effects (played from the
// start each time the bit turns on); the rest are continuous/looping sounds
// tied to an ongoing action (skating, sliding, block pushing, ...) that
// should keep looping for as long as their bit stays set and stop the
// instant it clears. Mirrors tworld-engine's internal (unexported)
// SND_ONESHOT_COUNT = 18, i.e. everything from SND_BLOCK_MOVING on.
const ONESHOT_COUNT = 18;

function isOneShot(index: number): boolean {
  return index < ONESHOT_COUNT;
}

export class SoundManager {
  private base: string;
  // HTMLAudioElement.play() carries its own internal scheduling/decode
  // latency in the browser's media pipeline — noticeable (tens of ms) even
  // once the file is fully buffered. Decoding every sound into a raw
  // AudioBuffer up front and firing it through an AudioBufferSourceNode
  // instead plays back sample-accurately with none of that overhead, which
  // is what actually gets a pickup/bump sound to feel instant.
  private ctx: AudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private activeLoops = new Map<number, AudioBufferSourceNode>();
  private prevMask = 0;
  muted = false;

  constructor(base: string) {
    this.base = base;
    this.ctx = new AudioContext();
  }

  private async loadBuffer(file: string): Promise<void> {
    if (this.buffers.has(file)) return;
    const res = await fetch(`${this.base}sounds/${file}`);
    const data = await res.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(data);
    this.buffers.set(file, buffer);
  }

  // Decodes every sound up front so the very first time an event fires,
  // its buffer is already sitting in memory ready to play — without this,
  // an infrequent sound (e.g. bumping a wall) would have to fetch and
  // decode its file before anything could play, showing up as a
  // noticeable delay between the action and the sound.
  preload(): void {
    for (const file of ALL_FILES) {
      void this.loadBuffer(file);
    }
  }

  // AudioContexts start (or get force-suspended by the browser's autoplay
  // policy) in a "suspended" state until a user gesture resumes them;
  // call this from the same input handlers that already gate game start
  // on a first keypress/tap so sounds aren't silently dropped.
  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private play(file: string): AudioBufferSourceNode | undefined {
    const buffer = this.buffers.get(file);
    if (!buffer) return undefined;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start();
    return source;
  }

  update(mask: number, ruleset: Ruleset): void {
    if (this.muted) {
      this.prevMask = mask;
      return;
    }
    for (let i = 0; i < SND_COUNT; i++) {
      const bit = 1 << i;
      const isSet = (mask & bit) !== 0;
      const file = soundFile(i, ruleset);
      if (!file) continue;

      if (isOneShot(i)) {
        // Rising edge only: a one-shot event fires the single tick its
        // condition becomes true, so replaying on every tick it happens to
        // still read as set would double-trigger it.
        if (isSet && (this.prevMask & bit) === 0) {
          this.play(file);
        }
      } else {
        if (isSet && !this.activeLoops.has(i)) {
          const source = this.play(file);
          if (source) {
            source.loop = true;
            this.activeLoops.set(i, source);
          }
        } else if (!isSet && this.activeLoops.has(i)) {
          this.activeLoops.get(i)!.stop();
          this.activeLoops.delete(i);
        }
      }
    }
    this.prevMask = mask;
  }

  // Stops any currently-looping continuous sound (skating, sliding, block
  // pushing, ...) without touching one-shot sounds — used when the game
  // ends so a loop that was still active doesn't keep playing forever,
  // while letting the win/lose sound just triggered on the same tick play
  // out normally.
  stopLoops(): void {
    for (const source of this.activeLoops.values()) {
      source.stop();
    }
    this.activeLoops.clear();
  }

  // Stops every looping sound and clears edge-detection state; call this
  // whenever the level restarts so a loop left over from the previous
  // attempt doesn't bleed into the new one. One-shots are fire-and-forget
  // nodes that finish on their own, so there's nothing to stop for them.
  reset(): void {
    this.stopLoops();
    this.prevMask = 0;
  }
}
