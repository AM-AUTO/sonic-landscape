/**
 * Scalar signed-distance primitives, smooth booleans and domain transforms. Everything takes and returns plain numbers
 * (no allocation), so a scene's map(x,y,z) can call them millions of times. Units are metres, +Y is up, right-handed.
 *
 *   PRIMITIVES (point x,y,z relative to the shape's own origin)
 *     sdSphere(x,y,z, r)
 *     sdEllipsoid(x,y,z, rx,ry,rz)                 (bound, not exact: fine for marching)
 *     sdBox(x,y,z, hx,hy,hz)                       half extents
 *     sdRoundBox(x,y,z, hx,hy,hz, r)               half extents INCLUDE the rounding radius r
 *     sdCapsule(x,y,z, ax,ay,az, bx,by,bz, r)
 *     sdTorus(x,y,z, R, r)                         ring in the XZ plane, axis Y
 *     sdCylinder(x,y,z, r, halfHeight)             axis Y
 *     sdRoundCone(x,y,z, r1, r2, h)                tapered column: sphere r1 at the origin up to sphere r2 at (0,h,0)  (menhirs)
 *     sdPlane(y, h)                                 y - h
 *   SMOOTH BOOLEANS (k = blend width in metres)
 *     smin(a,b,k)  smax(a,b,k)  smoothSub(base, cut, k)   smoothInter(a,b,k)     (hard versions: Math.min / Math.max(a,-b))
 *   DOMAIN TRANSFORMS (write into `out` = Float64Array(3), no allocation)
 *     twistY(x,y,z,k,out)   rotate about Y by k radians per metre of height
 *     bendX(x,y,z,k,out)    bend along X with curvature k (1/m)
 *     rotY(x,z,a,out2)      helper: rotate (x,z) by a (out2 = Float64Array(2))
 *   Xf  class  { pos, rot:[rx,ry,rz], scale }  rigid transform: xf.to(x,y,z,out) world -> local;  xf.from(x,y,z,out) local -> world.
 *       rotation order: R = Ry(yaw) * Rx(pitch) * Rz(roll)   (rot = [pitch, yaw, roll] = [rx, ry, rz])
 *   MATERIAL REGISTER M  { id, i, d, a, b, c }   scene.map() calls mreset() first, then mat(d, id[, i]) for each element:
 *       mat() keeps the id of the NEAREST element in M.id (M.i = a free per-element index e.g. which stone, M.a/b/c free hints), and returns d.
 *       The renderer reads M right after the map(hit point) call, so after marching the hit carries { id, i, a, b, c }.
 */
export const M = { id: 0, i: 0, d: 1e30, a: 0, b: 0, c: 0 };
export function mreset() { M.d = 1e30; M.id = 0; M.i = 0; M.a = 0; M.b = 0; M.c = 0; }
export function mat(d, id, i = 0) { if (d < M.d) { M.d = d; M.id = id; M.i = i; } return d; }

export const sdSphere = (x, y, z, r) => Math.sqrt(x * x + y * y + z * z) - r;
export function sdEllipsoid(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = x / (rx * rx), by = y / (ry * ry), bz = z / (rz * rz);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 < 1e-12 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
export function sdBox(x, y, z, hx, hy, hz) {
  const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
  const inner = qx > qy ? (qx > qz ? qx : qz) : (qy > qz ? qy : qz);
  return Math.sqrt(mx * mx + my * my + mz * mz) + (inner < 0 ? inner : 0);
}
export const sdRoundBox = (x, y, z, hx, hy, hz, r) => sdBox(x, y, z, hx - r, hy - r, hz - r) - r;
export function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz);
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
export function sdTorus(x, y, z, R, r) {
  const q = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(q * q + y * y) - r;
}
export function sdCylinder(x, y, z, r, hh) {
  const dx = Math.sqrt(x * x + z * z) - r, dy = Math.abs(y) - hh;
  const mx = dx > 0 ? dx : 0, my = dy > 0 ? dy : 0;
  return (dx > dy ? dx : dy) < 0 ? (dx > dy ? dx : dy) : Math.sqrt(mx * mx + my * my);
}
export function sdRoundCone(x, y, z, r1, r2, h) {
  const b = (r1 - r2) / h, a = Math.sqrt(Math.max(0, 1 - b * b));
  const qx = Math.sqrt(x * x + z * z), qy = y;
  const k = qx * -b + qy * a;
  if (k < 0) return Math.sqrt(qx * qx + qy * qy) - r1;
  if (k > a * h) { const dy = qy - h; return Math.sqrt(qx * qx + dy * dy) - r2; }
  return qx * a + qy * b - r1;
}
export const sdPlane = (y, h = 0) => y - h;

export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}
export function smax(a, b, k) {
  if (k <= 0) return a > b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a > b ? a : b) + h * h * k * 0.25;
}
export const smoothSub = (base, cut, k) => smax(base, -cut, k);
export const smoothInter = (a, b, k) => smax(a, b, k);

export function twistY(x, y, z, k, out) { const a = k * y, c = Math.cos(a), s = Math.sin(a); out[0] = c * x - s * z; out[1] = y; out[2] = s * x + c * z; }
export function bendX(x, y, z, k, out) { const a = k * x, c = Math.cos(a), s = Math.sin(a); out[0] = c * x - s * y; out[1] = s * x + c * y; out[2] = z; }
export function rotY(x, z, a, out2) { const c = Math.cos(a), s = Math.sin(a); out2[0] = c * x - s * z; out2[1] = s * x + c * z; }

/** Rigid transform. rot = [rx, ry, rz] radians; R = Ry * Rx * Rz. scale: number or [sx,sy,sz] (non-uniform scale gives a conservative distance when you multiply by minScale). */
export class Xf {
  constructor({ pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
    this.pos = pos; this.rot = rot;
    this.s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    this.minScale = Math.min(this.s[0], this.s[1], this.s[2]);
    const [rx, ry, rz] = rot;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Ry * Rx * Rz  (row-major)
    this.r = [
      cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
      cx * sz, cx * cz, -sx,
      -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
    ];
  }
  /** world -> local (translate, un-rotate, un-scale) */
  to(x, y, z, out) {
    const r = this.r, px = x - this.pos[0], py = y - this.pos[1], pz = z - this.pos[2];
    out[0] = (r[0] * px + r[3] * py + r[6] * pz) / this.s[0];
    out[1] = (r[1] * px + r[4] * py + r[7] * pz) / this.s[1];
    out[2] = (r[2] * px + r[5] * py + r[8] * pz) / this.s[2];
  }
  /** local -> world */
  from(x, y, z, out) {
    const r = this.r, px = x * this.s[0], py = y * this.s[1], pz = z * this.s[2];
    out[0] = r[0] * px + r[1] * py + r[2] * pz + this.pos[0];
    out[1] = r[3] * px + r[4] * py + r[5] * pz + this.pos[1];
    out[2] = r[6] * px + r[7] * py + r[8] * pz + this.pos[2];
  }
}
