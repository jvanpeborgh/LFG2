import { BlockTable, EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH, makeBody, steer, stepBody, type BlockQuery, type Body, type MountProfile, type Standards } from "@lfg/shared";

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
  /** Riding a summon: how it moves (we steer the pair; our feet are its feet, we sit `seat` higher). */
  mount: MountProfile | null = null;
  /** Driving: which way the vehicle points (the camera follows it), and its speed along that way. */
  heading = 0;
  private driveSpeed = 0;
  /** Looking around from the driver's seat (eases back to straight ahead). */
  private lookOffset = 0;
  /** Sliding sideways: for tyre squeal and smoke. */
  drifting = false;
  private lastJumpPress = 0;
  private jumpWasDown = false;
  bob = 0;

  constructor(x: number, y: number, z: number, private std: Standards) {
    this.body = makeBody(x, y, z, PLAYER_WIDTH, PLAYER_HEIGHT);
  }

  get eyeY(): number {
    return this.body.y + EYE_HEIGHT + (this.mount?.seat ?? 0);
  }

  look(dx: number, dy: number, sensitivity: number): void {
    if (this.mount?.drive) this.lookOffset = Math.max(-2.6, Math.min(2.6, this.lookOffset - dx * 0.0022 * sensitivity));
    this.yaw -= dx * 0.0022 * sensitivity;
    this.pitch -= dy * 0.0022 * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
  }

  forwardVector(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  update(dt: number, input: InputState, world: BlockQuery, table: BlockTable): void {
    if (this.mount?.drive) { this.driveVehicle(dt, input, world, table, this.mount); return; }
    if (this.mount) { this.ride(dt, input, world, table, this.mount); return; }
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

  /** Start driving, facing the way the vehicle points. */
  startDriving(heading: number): void {
    this.heading = heading;
    this.driveSpeed = 0;
    this.lookOffset = 0;
  }

  /** How fast we're going (blocks/s along the heading; negative in reverse). */
  get speed(): number {
    return this.driveSpeed;
  }

  /**
   * Driving: W accelerates, S brakes then reverses, A/D steer (more sharply the faster you go, up
   * to a point), Shift drifts: the back steps out, you keep more speed through the corner but slide.
   * The camera follows the car; the mouse looks around and eases back.
   */
  private driveVehicle(dt: number, input: InputState, world: BlockQuery, table: BlockTable, m: MountProfile): void {
    const b = this.body, h = m.drive!;
    const bal = this.std.balance.player;
    const top = m.speed;
    this.drifting = input.sprint && Math.abs(this.driveSpeed) > top * 0.4 && input.strafe !== 0;
    if (input.forward > 0) this.driveSpeed += (this.driveSpeed < 0 ? h.accel * 2.2 : h.accel * (1 - Math.max(0, this.driveSpeed) / top)) * dt;
    else if (input.forward < 0) this.driveSpeed -= (this.driveSpeed > 0 ? h.accel * 2.2 : h.accel * 0.6 * (1 + this.driveSpeed / (top * 0.35))) * dt;
    else this.driveSpeed *= Math.exp(-(b.onGround ? 0.9 : 0.1) * dt);
    if (b.inWater) this.driveSpeed *= Math.exp(-2.5 * dt);
    this.driveSpeed = Math.max(-top * 0.35, Math.min(top, this.driveSpeed));
    // Steering: none standing still, full by a quarter of top speed; drifting turns harder.
    const steerK = Math.min(1, Math.abs(this.driveSpeed) / (top * 0.25)) * Math.sign(this.driveSpeed || 1);
    if (b.onGround || b.inWater) this.heading -= input.strafe * h.turn * steerK * (this.drifting ? 1.35 : 1) * dt;
    // Grip: the velocity swings round to the heading; drifting lets it slide.
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    const grip = (this.drifting ? h.grip * 0.25 : h.grip) * (b.onGround ? 1 : 0.05);
    const k = 1 - Math.exp(-grip * 14 * dt);
    b.vx += (fx * this.driveSpeed - b.vx) * k;
    b.vz += (fz * this.driveSpeed - b.vz) * k;
    // Up a one-block step without stopping (curbs, terraces).
    if (b.onGround && Math.abs(this.driveSpeed) > 1) {
      const ahead = b.width / 2 + 0.25 + Math.abs(this.driveSpeed) * 0.06;
      const ax = Math.floor(b.x + Math.sign(b.vx) * ahead), az = Math.floor(b.z + Math.sign(b.vz) * ahead);
      const y = Math.floor(b.y + 0.05);
      const solid = (x: number, yy: number, z: number) => table.solid[world.getBlock(x, yy, z)] === 1;
      if ((solid(ax, y, Math.floor(b.z)) || solid(Math.floor(b.x), y, az)) && !solid(ax, y + 1, az) && !solid(ax, y + 2, az) && !solid(Math.floor(b.x), y + 2, Math.floor(b.z))) b.vy = Math.max(b.vy, Math.sqrt(2 * bal.gravity * 1.2));
    }
    stepBody(world, table, b, dt, { gravity: bal.gravity, flying: false });
    // Into a wall: most of the speed goes.
    if (b.hitWall && b.vy <= 0) this.driveSpeed *= 0.35;
    // The camera follows the car; a look to the side eases back.
    this.lookOffset *= Math.exp(-1.2 * dt);
    this.yaw = this.heading + this.lookOffset;
    this.sprinting = false;
    this.flying = false;
    this.bob *= 0.9;
  }

  /**
   * Riding: the mount's speed and its way of moving. Flyers and swimmers (in water) go where you
   * look, Space climbs; ground mounts gallop and jump; boats keep to the water.
   */
  private ride(dt: number, input: InputState, world: BlockQuery, table: BlockTable, m: MountProfile): void {
    const b = this.body;
    const bal = this.std.balance.player;
    this.sprinting = input.sprint && input.forward > 0;
    const pace = this.sprinting ? m.sprint : m.speed;
    const len = Math.hypot(input.forward, input.strafe) || 1;
    const f = input.forward / len, s = input.strafe / len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const moving = input.forward !== 0 || input.strafe !== 0;
    const free = m.mode === "fly" || (m.mode === "swim" && b.inWater);
    this.flying = m.mode === "fly";
    if (free) {
      // Along the look direction, climbing or diving with it.
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      steer(b, moving ? -sin * f * cp + cos * s : 0, moving ? -cos * f * cp - sin * s : 0, pace, dt, 6);
      const vyWant = (moving ? sp * f * pace : 0) + (input.jump ? pace * 0.6 : 0);
      b.vy += (vyWant - b.vy) * (1 - Math.exp(-6 * dt));
    } else {
      // On the ground (or a boat on water, or a swimmer stranded on land).
      const speed = m.mode === "sail" ? (b.inWater ? pace : 1) : m.mode === "swim" ? 1.5 : b.inWater ? pace * 0.45 : pace;
      steer(b, moving ? -sin * f + cos * s : 0, moving ? -cos * f - sin * s : 0, speed, dt, b.onGround || (m.mode === "sail" && b.inWater) ? 10 : 3);
      if (m.mode === "sail" && b.inWater) b.vy = Math.min(b.vy + 30 * dt, 1.6); // floats up to the surface
      else if (m.mode === "ground" && b.inWater && input.jump) b.vy = Math.min(b.vy + 30 * dt, 3.2);
      else if (m.mode === "ground" && input.jump && b.onGround) b.vy = Math.sqrt(2 * bal.gravity * (m.jump + 0.05));
    }
    stepBody(world, table, b, dt, { gravity: bal.gravity, flying: free });
    // Ground mounts hop out of water onto a bank.
    if (m.mode === "ground" && b.inWater && b.hitWall) b.vy = 6;
    const hs = Math.hypot(b.vx, b.vz);
    this.bob = b.onGround && hs > 0.5 ? this.bob + dt * hs * 0.9 : this.bob * 0.9;
  }
}
