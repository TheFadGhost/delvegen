import { DungeonGrid, type RoomRect, type Pos } from "../core/grid.js";
import { Tile } from "../core/tile.js";
import { ValidationError } from "../core/errors.js";
import { carveCorridorL, centerOf } from "../core/geometry.js";
import type { GenerationContext, GeneratorDefinition } from "../core/types.js";

/** A rectangular cell of the binary partition, clipped to the wall border. */
interface BspNode {
  x: number;
  y: number;
  w: number;
  h: number;
  left: BspNode | null;
  right: BspNode | null;
  /** True when this node was split into top/bottom halves rather than left/right. */
  horizontal: boolean;
}

/** Which edge of a subtree the boundary-sharing room hugs. */
type BoundarySide = "left" | "right" | "top" | "bottom";

/**
 * Binary space partitioning.
 *
 * The map interior (a one-tile wall ring stays solid) is recursively halved:
 * each split takes the longer axis, breaks square-cell ties by alternating,
 * and cuts at a random 35-65% point, stopping at the depth cap or when no
 * axis can yield two leaves of the minimum size. Every leaf receives exactly
 * one random-sized room. Sibling subtrees are then welded bottom-up: each
 * internal node joins the room nearest its shared boundary in the left/top
 * subtree to the nearest in the right/bottom subtree with an L-corridor.
 * Every weld merges two internally connected components, so the finished map
 * is fully reachable by construction and needs no repair pass.
 *
 * Produces: tidy rectangular rooms in a hierarchical layout, connected by
 * short elbow corridors.
 */
export const bspSplit: GeneratorDefinition = {
  id: "bsp",
  name: "BSP Split",
  summary: "Recursive partition of the map into leaves holding one room each.",
  technique:
    "The interior of a solid map is bisected again and again: each split takes the longer " +
    "axis (square cells alternate), cuts at a uniformly random point between 35% and 65% " +
    "of that axis, and only proceeds while both halves still fit the minimum leaf size or " +
    "the depth cap is reached. Every leaf then receives exactly one room, sized randomly " +
    "between the room bounds and positioned with symmetric padding inside its leaf. " +
    "Finally sibling subtrees are stitched together bottom-up: at each internal node an " +
    "L-shaped corridor joins the room closest to the shared boundary in the left/top half " +
    "to the closest one in the right/bottom half. Because each stitch merges two already-" +
    "connected components and the root's stitch covers the whole tree, every room ends up " +
    "reachable.",
  params: [
    {
      key: "minLeafSize",
      label: "Min leaf size",
      description: "Smallest allowable partition cell; cells split only while both halves fit.",
      type: "int",
      min: 8,
      max: 40,
      step: 1,
      default: 16,
    },
    {
      key: "roomPadding",
      label: "Room padding",
      description: "Wall margin kept free inside each leaf around its room.",
      type: "int",
      min: 0,
      max: 4,
      step: 1,
      default: 1,
    },
    {
      key: "corridorWidth",
      label: "Corridor width",
      description: "Thickness of connecting corridors in tiles.",
      type: "int",
      min: 1,
      max: 3,
      step: 1,
      default: 1,
    },
    {
      key: "maxDepth",
      label: "Max depth",
      description: "Maximum number of nested splits along one path.",
      type: "int",
      min: 2,
      max: 10,
      step: 1,
      default: 6,
    },
    {
      key: "roomMinSize",
      label: "Room min size",
      description: "Lower bound of each room's width and height.",
      type: "int",
      min: 3,
      max: 10,
      step: 1,
      default: 4,
    },
    {
      key: "roomMaxSize",
      label: "Room max size",
      description: "Upper bound of each room's width and height.",
      type: "int",
      min: 4,
      max: 20,
      step: 1,
      default: 10,
    },
  ],

  validate(width, height, p) {
    const minLeaf = p["minLeafSize"] as number;
    const padding = p["roomPadding"] as number;
    const roomMin = p["roomMinSize"] as number;
    const roomMax = p["roomMaxSize"] as number;
    const corridorWidth = p["corridorWidth"] as number;
    if (width < minLeaf * 2 + 2 || height < minLeaf * 2 + 2) {
      throw new ValidationError(
        `Grid ${width}x${height} is too small for Min leaf size ${minLeaf}: every dimension ` +
          `needs at least ${minLeaf * 2 + 2} tiles (two leaves plus a wall border); lower ` +
          `"Min leaf size" (min 8) or enlarge the grid.`,
      );
    }
    const roomCap = minLeaf - padding * 2 - 2;
    if (roomMax > roomCap) {
      throw new ValidationError(
        `Room max size ${roomMax} exceeds ${roomCap}, the largest room that fits a minimum ` +
          `leaf of ${minLeaf} with padding ${padding}; lower "Room max size" (min 4), ` +
          `"Room padding" (max 4) or raise "Min leaf size".`,
      );
    }
    if (corridorWidth >= roomMin) {
      throw new ValidationError(
        `Corridor width ${corridorWidth} must stay below Room min size ${roomMin} ` +
          `(valid 1-${roomMin - 1}) or corridors would swallow whole rooms.`,
      );
    }
  },

  generate(ctx: GenerationContext) {
    const width = ctx.width;
    const height = ctx.height;
    const grid = new DungeonGrid(width, height, Tile.Wall);
    const rooms: RoomRect[] = [];

    const minLeaf = ctx.num("minLeafSize");
    const padding = ctx.num("roomPadding");
    const corridorWidth = ctx.num("corridorWidth");
    const maxDepth = ctx.num("maxDepth");
    const roomMin = ctx.num("roomMinSize");
    const roomMax = ctx.num("roomMaxSize");

    /* ---------------------------------------------------------------- */
    /* Phase 1: partition the interior, one frame per split              */
    /* ---------------------------------------------------------------- */

    const root: BspNode = {
      x: 1,
      y: 1,
      w: width - 2,
      h: height - 2,
      left: null,
      right: null,
      horizontal: false,
    };
    let splits = 0;

    const splitRect = (node: BspNode, depth: number): void => {
      const canSplitH = node.h >= minLeaf * 2;
      const canSplitV = node.w >= minLeaf * 2;
      if (depth >= maxDepth || (!canSplitH && !canSplitV)) return; // leaf

      // Longer axis wins; square cells alternate with depth for variety.
      const horizontal = canSplitH
        ? !canSplitV || (node.h !== node.w ? node.h > node.w : depth % 2 === 0)
        : false;

      const len = horizontal ? node.h : node.w;
      const lo = Math.max(minLeaf, Math.ceil(len * 0.35));
      const hi = Math.min(len - minLeaf, Math.floor(len * 0.65));
      const cut = ctx.rng.int(lo, hi); // random 35-65% split point

      if (horizontal) {
        node.horizontal = true;
        node.left = { x: node.x, y: node.y, w: node.w, h: cut, left: null, right: null, horizontal: false };
        node.right = { x: node.x, y: node.y + cut, w: node.w, h: len - cut, left: null, right: null, horizontal: false };
      } else {
        node.horizontal = false;
        node.left = { x: node.x, y: node.y, w: cut, h: node.h, left: null, right: null, horizontal: false };
        node.right = { x: node.x + cut, y: node.y, w: len - cut, h: node.h, left: null, right: null, horizontal: false };
      }
      splits++;
      // Throttle deep-recursion runs so the frame budget stays bounded.
      if (splits <= 400 || splits % 16 === 0) ctx.record(`split ${splits}`, grid, rooms);

      splitRect(node.left!, depth + 1);
      splitRect(node.right!, depth + 1);
    };
    splitRect(root, 0);

    /* ---------------------------------------------------------------- */
    /* Phase 2: one room per leaf                                        */
    /* ---------------------------------------------------------------- */

    const leafRooms = new Map<BspNode, RoomRect>();
    const leaves: BspNode[] = [];
    const collectLeaves = (node: BspNode): void => {
      if (node.left && node.right) {
        collectLeaves(node.left);
        collectLeaves(node.right);
        return;
      }
      leaves.push(node);
    };
    collectLeaves(root);

    const roomEvery = Math.max(1, Math.ceil(leaves.length / 220));
    for (const leaf of leaves) {
      const availW = leaf.w - padding * 2;
      const availH = leaf.h - padding * 2;
      // Upper bound honours both the param cap and the leaf's padded interior.
      const wHi = Math.max(roomMin, Math.min(roomMax, availW));
      const hHi = Math.max(roomMin, Math.min(roomMax, availH));
      const rw = Math.max(1, Math.min(availW, ctx.rng.int(roomMin, wHi)));
      const rh = Math.max(1, Math.min(availH, ctx.rng.int(roomMin, hHi)));
      const rx = leaf.x + padding + ctx.rng.int(0, availW - rw);
      const ry = leaf.y + padding + ctx.rng.int(0, availH - rh);

      grid.fillRect(rx, ry, rw, rh, Tile.RoomFloor);
      const room: RoomRect = { id: rooms.length + 1, x: rx, y: ry, w: rw, h: rh };
      rooms.push(room);
      leafRooms.set(leaf, room);

      const placed = rooms.length;
      if (placed % roomEvery === 0 || placed === leaves.length) {
        ctx.record(`place room ${placed}`, grid, rooms);
      }
    }

    /* ---------------------------------------------------------------- */
    /* Phase 3: weld sibling subtrees bottom-up                          */
    /* ---------------------------------------------------------------- */

    const scanIndex = (p: Pos): number => p.y * width + p.x;

    const sideMetric = (room: RoomRect, side: BoundarySide): number => {
      const c = centerOf(room);
      switch (side) {
        case "left":
          return -c.x;
        case "right":
          return c.x;
        case "top":
          return -c.y;
        case "bottom":
          return c.y;
      }
    };

    /** Farther toward the boundary wins; ties fall to lowest scan order. */
    const closerToBoundary = (a: RoomRect, b: RoomRect, side: BoundarySide): RoomRect => {
      const da = sideMetric(a, side);
      const db = sideMetric(b, side);
      if (da !== db) return da > db ? a : b;
      return scanIndex(centerOf(a)) <= scanIndex(centerOf(b)) ? a : b;
    };

    const boundaryRoom = (node: BspNode, side: BoundarySide): RoomRect => {
      if (!node.left || !node.right) return leafRooms.get(node)!;
      const fromLeft = boundaryRoom(node.left, side);
      const fromRight = boundaryRoom(node.right, side);
      return closerToBoundary(fromLeft, fromRight, side);
    };

    let corridors = 0;
    const connectEvery = Math.max(1, Math.ceil(Math.max(1, leaves.length - 1) / 120));

    const connectSubtree = (node: BspNode): void => {
      if (!node.left || !node.right) return;
      connectSubtree(node.left);
      connectSubtree(node.right);
      const nearA = boundaryRoom(node.left, node.horizontal ? "bottom" : "right");
      const nearB = boundaryRoom(node.right, node.horizontal ? "top" : "left");
      carveCorridorL(grid, centerOf(nearA), centerOf(nearB), ctx.rng, { width: corridorWidth });
      corridors++;
      if (corridors <= 120 || corridors % connectEvery === 0) {
        ctx.record(`connect ${corridors}`, grid, rooms);
      }
    };
    connectSubtree(root);

    return {
      grid,
      rooms,
      meta: {
        splits,
        leaves: rooms.length,
        corridors,
      },
    };
  },
};
