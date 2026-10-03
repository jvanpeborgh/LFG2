import { BlockTable, EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH, makeBody, steer, stepBody, type BlockQuery, type Body, type Standards } from "@lfg/shared";

export interface InputState {
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  down: boolean;
}

/** The local player's body, simulated on the client (the server validates). */
export class LocalPlayer {
  readonly body: Body;
  yaw = 0;
  pitch = 0;
  flying = false;
  creative = false;
  /** From powers: may fly in survival (at running pace, not creative speed), and moves faster. */
  canFly = false;
  speedMul = 1;
  sprinting = false;
  private lastJumpPress = 0;
  private jumpWasDown = false;
  bob = 0;

  constructor(x: number, y: number, z: number, private std: Standards) {
    this.body = makeBody(x, y, z, PLAYER_WIDTH, PLAYER_HEIGHT);
  }

  get eyeY(): number {
    return this.body.y + EYE_HEIGHT;
  }

  look(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * 0.0022 * sensitivity;
    this.pitch -= dy * 0.0022 * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
  }

  forwardVector(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  update(dt: number, input: InputState, world: BlockQuery, table: BlockTable): void {
    const b = this.body;
    const bal = this.std.balance.player;
    // Double-tap jump toggles flying in creative.
    if (input.jump && !this.jumpWasDown) {
      const now = performance.now();
      if ((this.creative || this.canFly) && now - this.lastJumpPress < 300) {
        this.flying = !this.flying;
        b.vy = 0;
      }
      this.lastJumpPress = now;
    }
    this.jumpWasDown = input.jump;
    if (!this.creative && !this.canFly) this.flying = false;

    const len = Math.hypot(input.forward, input.strafe) || 1;
    const f = input.forward / len, s = input.strafe / len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = -sin * f + cos * s;
    const wishZ = -cos * f - sin * s;
    this.sprinting = input.sprint && input.forward > 0;

    let speed = (this.sprinting ? bal.sprintSpeed : bal.walkSpeed) * this.speedMul;
    if (this.flying) speed = this.creative ? (this.sprinting ? 22 : 10.9) : speed * 1.2;
    else if (b.inWater) speed *= 0.5;
    const moving = input.forward !== 0 || input.strafe !== 0;
    const accel = this.flying ? 8 : b.onGround ? 16 : b.inWater ? 6 : 4;
    steer(b, moving ? wishX : 0, moving ? wishZ : 0, speed, dt, accel);

    if (this.flying) {
      const v = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
      b.vy += (v * speed * 0.75 - b.vy) * (1 - Math.exp(-10 * dt));
    } else if (b.inWater) {
      if (input.jump) b.vy = Math.min(b.vy + 30 * dt, 3.2);
    } else if (input.jump && b.onGround) {
      b.vy = Math.sqrt(2 * bal.gravity * (bal.jumpBlocks + 0.05));
    }

    stepBody(world, table, b, dt, { gravity: bal.gravity, flying: this.flying });
    // Landing ends creative flight, like Minecraft.
    if (this.flying && b.onGround) this.flying = false;
    // Hop out of water onto a ledge.
    if (b.inWater && b.hitWall && input.jump) b.vy = 6;

    const hs = Math.hypot(b.vx, b.vz);
    this.bob = b.onGround && hs > 0.5 ? this.bob + dt * hs * 1.8 : this.bob * 0.9;
  }
}
