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
  private audio = new Map<string, HTMLAudioElement>();
  private activeLoops = new Set<number>();
  private prevMask = 0;
  muted = false;

  constructor(base: string) {
    this.base = base;
  }

  private elementFor(file: string): HTMLAudioElement {
    let el = this.audio.get(file);
    if (!el) {
      el = new Audio(`${this.base}sounds/${file}`);
      el.preload = "auto";
      this.audio.set(file, el);
    }
    return el;
  }

  // Creates every sound's <audio> element and starts buffering it up front.
  // Without this, elementFor() only creates (and starts fetching) an
  // element the first time that particular sound is actually needed —
  // which for an infrequent one like the "bump into wall" sound meant the
  // very first bump had to wait on a network fetch before anything played,
  // showing up as a noticeable delay between the bump and its sound. Call
  // this once at startup so every sound is already buffered by the time
  // it's first triggered.
  preload(): void {
    for (const file of ALL_FILES) {
      this.elementFor(file);
    }
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
          const el = this.elementFor(file);
          el.currentTime = 0;
          void el.play().catch(() => {});
        }
      } else {
        if (isSet && !this.activeLoops.has(i)) {
          const el = this.elementFor(file);
          el.loop = true;
          el.currentTime = 0;
          void el.play().catch(() => {});
          this.activeLoops.add(i);
        } else if (!isSet && this.activeLoops.has(i)) {
          this.elementFor(file).pause();
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
    for (const i of this.activeLoops) {
      const file = soundFile(i, Ruleset.Lynx) ?? soundFile(i, Ruleset.MS);
      if (file) this.elementFor(file).pause();
    }
    this.activeLoops.clear();
  }

  // Stops every sound outright (including one-shots) and clears
  // edge-detection state; call this whenever the level restarts so a sound
  // left over from the previous attempt doesn't bleed into the new one.
  reset(): void {
    for (const el of this.audio.values()) {
      el.pause();
      el.currentTime = 0;
    }
    this.activeLoops.clear();
    this.prevMask = 0;
  }
}
