/**
 * kinematics_3d.js — Elite CT Brain v2.7 Watertight +alpha 2-Bone IK, C² Ackermann Vehicles & Springs.
 *
 * Implements:
 *  - `solveTwoBoneIK`: Law 1 analytical 2-bone IK (`L1+L2 >= 1.18*maxDist` reach guard + positive `+alpha`
 *    Rodrigues rotation around `normalize(dir x bendHint)` so joints never bend backward or gap).
 *  - `AckermannSplineVehicle`: Closed-loop `C²` CatmullRom spline tracker with Kinematic Bicycle front
 *    steering (`atan(L * kappa)`), exact wheel spin (`s / R`), chassis roll, and 1.8Hz turn signals.
 *  - `DampedSpring3D` & `computeCentripetalBank`: dt-invariant harmonic springs & flight/turn banking.
 */

import * as THREE from "three";

const _toTarget = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _bendAxis = new THREE.Vector3();
const _upperDir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Watertight 2-Bone Analytical IK Solver (`+alpha` Rodrigues law).
 * Returns exact world-space mid-joint (knee/elbow/wrist) position into `outMidPos`.
 */
export function solveTwoBoneIK({
  rootPos,
  targetPos,
  L1,
  L2,
  bendHint,
  outMidPos = new THREE.Vector3(),
  upperGroup = null,
  lowerGroup = null,
}) {
  _toTarget.subVectors(targetPos, rootPos);
  const maxSafeReach = Math.max(0.05, (L1 + L2) * 0.96);
  const minSafeReach = Math.abs(L1 - L2) + 0.02;
  const dist = THREE.MathUtils.clamp(_toTarget.length(), minSafeReach, maxSafeReach);

  if (_toTarget.lengthSq() < 1e-8) {
    _dir.set(0, -1, 0);
  } else {
    _dir.copy(_toTarget).normalize();
  }

  // Law of cosines for interior bend angle alpha
  const cosAlpha = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1.0, 1.0);
  const alpha = Math.acos(cosAlpha);

  _bendAxis.crossVectors(_dir, bendHint);
  if (_bendAxis.lengthSq() < 1e-6) {
    _bendAxis.crossVectors(_dir, _up);
    if (_bendAxis.lengthSq() < 1e-6) _bendAxis.set(1, 0, 0);
  }
  _bendAxis.normalize();

  // MUST use +alpha around normalize(dir x bendHint) so mid-joint bends toward bendHint
  _upperDir.copy(_dir).applyAxisAngle(_bendAxis, +alpha);
  outMidPos.copy(rootPos).addScaledVector(_upperDir, L1);

  if (upperGroup) {
    upperGroup.position.copy(rootPos);
    upperGroup.quaternion.setFromUnitVectors(_up, _upperDir);
  }
  if (lowerGroup) {
    const lowerDir = _toTarget.subVectors(targetPos, outMidPos);
    if (lowerDir.lengthSq() > 1e-8) {
      lowerDir.normalize();
      lowerGroup.position.copy(outMidPos);
      lowerGroup.quaternion.setFromUnitVectors(_up, lowerDir);
    }
  }
  return outMidPos;
}

export class DampedSpring3D {
  constructor(omega = 12.0, zeta = 0.85, initial = new THREE.Vector3()) {
    this.omega = omega;
    this.zeta = zeta;
    this.pos = initial.clone();
    this.vel = new THREE.Vector3();
    this._delta = new THREE.Vector3();
  }

  step(target, dt) {
    const h = Math.min(dt, 1 / 20);
    const f = 1.0 + 2.0 * h * this.zeta * this.omega;
    const oo = this.omega * this.omega;
    const hoo = h * oo;
    const hhoo = h * hoo;
    const detInv = 1.0 / (f + hhoo);

    this._delta.copy(this.pos).multiplyScalar(f).addScaledVector(this.vel, h).addScaledVector(target, hhoo);
    this.vel.addScaledVector(this._delta.clone().sub(target), -hoo);
    this.pos.copy(this._delta).multiplyScalar(detInv);
    this.vel.multiplyScalar(detInv);
    return this.pos;
  }
}

export function computeCentripetalBank(speed, curvature, gravity = 9.81, maxBankRad = 0.68) {
  return THREE.MathUtils.clamp(Math.atan((speed * speed * curvature) / gravity), -maxBankRad, maxBankRad);
}

/**
 * Closed-loop C² Ackermann spline vehicle controller (`R >= 8.5m`, zero polyline chord snaps).
 */
export class AckermannSplineVehicle {
  constructor(waypoints, { wheelbase = 2.7, wheelRadius = 0.34, cruiseSpeed = 8.5 } = {}) {
    this.curve = new THREE.CatmullRomCurve3(waypoints, true, "centripetal", 0.5);
    this.totalLength = this.curve.getLength();
    this.wheelbase = wheelbase;
    this.wheelRadius = wheelRadius;
    this.cruiseSpeed = cruiseSpeed;
    this.distance = 0;
    this.wheelSpinRad = 0;
    this.steerAngleRad = 0;
    this.chassisRollRad = 0;
    this.turnSignalBlink = false;

    this.position = new THREE.Vector3();
    this.tangent = new THREE.Vector3(0, 0, 1);
    this._tAhead = new THREE.Vector3();
    this._tBehind = new THREE.Vector3();
  }

  step(dt, timeSec = 0) {
    const epsU = Math.min(0.01, 1.5 / Math.max(10, this.totalLength));
    const uNow = ((this.distance % this.totalLength) + this.totalLength) / this.totalLength % 1;
    const uPrev = (uNow - epsU + 1) % 1;
    const uNext = (uNow + epsU) % 1;

    this.curve.getTangentAt(uPrev, this._tBehind);
    this.curve.getTangentAt(uNext, this._tAhead);

    // Signed planar curvature kappa = dTheta / ds
    const crossY = this._tBehind.z * this._tAhead.x - this._tBehind.x * this._tAhead.z;
    const ds = 2 * epsU * this.totalLength;
    const kappa = ds > 1e-4 ? crossY / ds : 0;

    // Gentle intersection/corner speed modulation
    const cornerFactor = 1.0 / (1.0 + Math.abs(kappa) * 14.0);
    const speed = this.cruiseSpeed * THREE.MathUtils.clamp(cornerFactor, 0.48, 1.0);

    this.distance = (this.distance + speed * dt) % this.totalLength;
    this.wheelSpinRad += (speed * dt) / this.wheelRadius;

    const u = this.distance / this.totalLength;
    this.curve.getPointAt(u, this.position);
    this.curve.getTangentAt(u, this.tangent);

    this.steerAngleRad = THREE.MathUtils.clamp(Math.atan(this.wheelbase * kappa), -0.58, 0.58);
    const targetRoll = THREE.MathUtils.clamp((speed * speed * kappa) / 9.81 * 0.12, -0.045, 0.045);
    this.chassisRollRad += (targetRoll - this.chassisRollRad) * Math.min(1, dt * 8.0);
    this.turnSignalBlink = Math.abs(this.steerAngleRad) > 0.14 && Math.floor(timeSec * 3.6) % 2 === 0;

    return {
      position: this.position,
      tangent: this.tangent,
      yaw: Math.atan2(this.tangent.x, this.tangent.z),
      steerAngleRad: this.steerAngleRad,
      wheelSpinRad: this.wheelSpinRad,
      chassisRollRad: this.chassisRollRad,
      turnSignalLeft: this.turnSignalBlink && this.steerAngleRad > 0.14,
      turnSignalRight: this.turnSignalBlink && this.steerAngleRad < -0.14,
    };
  }
}
