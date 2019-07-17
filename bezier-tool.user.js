// ==UserScript==
// @name         Line Rider Bezier Tool
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Adds tool to create bezier curves
// @author       David Lu
// @match        https://www.linerider.com/*
// @match        https://*.linerider.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/EmergentStudios/linerider-userscript-mods/master/lib/adaptive-bezier-curve.js
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

const bezier = window.adaptiveBezierCurve;
const TOOL_ID = "Bezier Tool";

const TOOL_LAYER = 0;

const setToolState = (toolId, state) => ({
  type: "SET_TOOL_STATE",
  payload: state,
  meta: { id: toolId }
});
const revertTrackChanges = () => ({
  type: "REVERT_TRACK_CHANGES",
  meta: { ignorable: true }
});
const updateLines = (name, linesToRemove, linesToAdd, initialLoad = false) => ({
  type: "UPDATE_LINES",
  payload: { linesToRemove, linesToAdd, initialLoad },
  meta: { name }
});
const addLines = lines => updateLines("ADD_LINES", null, lines);
const commitTrackChanges = () => ({
  type: "COMMIT_TRACK_CHANGES"
});

const getToolState = (state, toolId) => state.toolState[toolId];
const getEditorZoom = state => state.camera.editorZoom;
const getModifier = (state, modifier) =>
  state.command.activeModifiers.has(modifier);
const getPlayerRunning = state => state.player.running;
const getSimulatorTrack = state => state.simulator.engine;
const getSimulatorCommittedTrack = state => state.simulator.committedEngine;
const getTrackLinesLocked = state => state.trackLinesLocked;
const getSelectedLineType = state =>
  getTrackLinesLocked(state) ? 2 : state.selectedLineType;

class State {}
class InitState extends State {}
class ControlOneState extends State {
  /**
   *
   * @param {ControlOneState} c
   * @param {V2} pos
   */
  static withControlPoint(c, pos) {
    return new ControlOneState(c.p1, pos);
  }
  /**
   * @param {V2} p1
   * @param {V2} c1
   */
  constructor(p1, c1) {
    super();
    this.p1 = p1;
    this.c1 = c1;
  }
}
class ControlTwoState extends State {
  /**
   *
   * @param {ControlTwoState} c
   * @param {V2} pos
   */
  static withControlPoint(c, pos) {
    return new ControlTwoState(c.p1, c.c1, c.p2, pos);
  }
  /**
   * @param {ControlOneState} c
   * @param {V2} pos
   */
  static fromControlOne(c, pos) {
    return new ControlTwoState(c.p1, c.c1, pos, pos);
  }
  /**
   * @param {V2} p1
   * @param {V2} c1
   * @param {V2} p2
   * @param {V2} c2
   */
  constructor(p1, c1, p2, c2) {
    super();
    this.p1 = p1;
    this.c1 = c1;
    this.p2 = p2;
    this.c2 = c2;
  }
}
function inBounds(p1, p2, r) {
  return Math.abs(p1.x - p2.x) < r && Math.abs(p1.y - p2.y) < r;
}
class EditState extends State {
  /**
   * @param {ControlTwoState} c
   */
  static fromControlTwo(c) {
    return new EditState(c.p1, c.c1, c.p2, c.c2);
  }
  /**
   * @param {V2} p1
   * @param {V2} c1
   * @param {V2} p2
   * @param {V2} c2
   */
  constructor(p1, c1, p2, c2) {
    super();
    /** @type {'none' | 'p1' | 'p2' | 'c1' | 'c2' } */
    this.activePoint = "none";
    /** @type {V2} */
    this.startPoint = null;
    this.p1 = p1;
    this.c1 = c1;
    this.p2 = p2;
    this.c2 = c2;
  }
  clone() {
    const nextState = new EditState(this.p1, this.c1, this.p2, this.c2);
    nextState.activePoint = this.activePoint;
    nextState.startPoint = this.startPoint;

    return nextState;
  }
  /**
   * @param {V2} p
   * @param {number} r
   */
  handleDown(p, r) {
    const nextState = this.clone();

    if (inBounds(p, this.p1, r)) {
      nextState.startPoint = new V2(this.p1).sub(p);
      nextState.activePoint = "p1";
    } else if (inBounds(p, this.p2, r)) {
      nextState.startPoint = new V2(this.p2).sub(p);
      nextState.activePoint = "p2";
    } else if (inBounds(p, this.c1, r)) {
      nextState.startPoint = new V2(this.c1).sub(p);
      nextState.activePoint = "c1";
    } else if (inBounds(p, this.c2, r)) {
      nextState.startPoint = new V2(this.c2).sub(p);
      nextState.activePoint = "c2";
    } else {
      return;
    }
    return nextState;
  }
  /**
   * @param {V2} p
   */
  handleDrag(p, s, pendingLines, pointSnap, angleLock) {
    if (this.activePoint === "none") return;
    const nextState = this.clone();

    let nextPos = new V2(this.startPoint).add(p);

    switch (this.activePoint) {
      case "p1":
      case "p2":
        if (pointSnap) {
          nextPos = getPointSnapPos(nextPos, s, pendingLines, null, true);
        }
        break;
      case "c1":
        if (angleLock && this.p1.vec) {
          nextPos = getAngleLockPos(nextPos, this.p1, this.p1.vec);
        }
        break;
      case "c2":
        if (angleLock && this.p2.vec) {
          nextPos = getAngleLockPos(nextPos, this.p2, this.p2.vec);
        }
        break;
    }

    switch (this.activePoint) {
      case "p1": {
        const delta = new V2(nextPos).sub(nextState.p1);
        nextState.p1 = nextPos;
        nextState.c1 = delta.add(nextState.c1);
        break;
      }
      case "p2": {
        const delta = new V2(nextPos).sub(nextState.p2);
        nextState.p2 = nextPos;
        nextState.c2 = delta.add(nextState.c2);
        break;
      }
      case "c1":
        nextState.c1 = nextPos;
        break;
      case "c2":
        nextState.c2 = nextPos;
        break;
    }
    return nextState;
  }
}

const THICKNESS = 1;
const POINT_RADIUS = 10;

/** @param {State} toolState */
const setBezierToolState = toolState =>
  setToolState(TOOL_ID, { state: toolState });
/** @return {State} */
const getBezierToolState = state => getToolState(state, TOOL_ID).state;

function genLine(x1, y1, x2, y2, thickness, color, zIndex) {
  let p1 = {
    x: x1,
    y: y1,
    colorA: color,
    colorB: color,
    thickness
  };
  let p2 = {
    x: x2,
    y: y2,
    colorA: color,
    colorB: color,
    thickness
  };
  return new Millions.Line(p1, p2, TOOL_LAYER, zIndex);
}

function genBoxOutline(x1, y1, x2, y2, thickness, color, zIndex) {
  return [
    genLine(x1, y1, x1, y2, thickness, color, zIndex),
    genLine(x1, y2, x2, y2, thickness, color, zIndex + 0.1),
    genLine(x2, y2, x2, y1, thickness, color, zIndex + 0.2),
    genLine(x2, y1, x1, y1, thickness, color, zIndex + 0.3)
  ];
}

function genPoint(x, y, r, borderThickness, fillColor, borderColor, zIndex) {
  return genBoxOutline(
    x - r,
    y - r,
    x + r,
    y + r,
    borderThickness,
    borderColor,
    zIndex + 0.5
  );
}

const Zoom = {
  STRENGTH: Math.pow(2, 1 / 64),
  MIN: 1 / 16,
  MAX: 32
};
const MAX_SNAP_DISTANCE = 6;
function getPointSnapPos(pos, state, ignoreLineIds, ignorePoint, withLineVec) {
  let zoom = getEditorZoom(state);

  let track = getSimulatorCommittedTrack(state); // only snap to committed lines so we don't self-snap

  // adjust snap radius to current zoom level
  let closestDistance = MAX_SNAP_DISTANCE / Math.min(zoom, Zoom.MAX / 10);
  let snapPos = pos;
  let otherPointOfSnappedLine = null;
  let lines = track.selectLinesInRadius(pos, closestDistance);

  function getCloserPoint(point, otherPoint) {
    if (ignorePoint && point.x === ignorePoint.x && point.y === ignorePoint.y)
      return;

    let distance = pos.dist(point);
    if (distance < closestDistance) {
      closestDistance = distance;
      snapPos = point;
      otherPointOfSnappedLine = otherPoint;
    }
  }

  for (let line of lines) {
    if (ignoreLineIds && ignoreLineIds.has(line.id)) continue;
    getCloserPoint(line.p1, line.p2);
    getCloserPoint(line.p2, line.p1);
  }

  if (otherPointOfSnappedLine && withLineVec) {
    snapPos = {
      x: snapPos.x,
      y: snapPos.y,
      vec: new V2(snapPos).sub(otherPointOfSnappedLine).norm()
    };
  }

  return snapPos;
}
function getAngleLockPos(pos, startPos, vec) {
  let delta = new V2(pos).sub(startPos);

  return new V2(vec).mul(delta.dot(vec)).add(startPos);
}

function main() {
  const { DefaultTool, Millions, React, store, V2 } = window;

  const Colors = {
    One: new Millions.Color(255, 0, 0, 255),
    Two: new Millions.Color(255, 0, 0, 255),
    PointBorder: new Millions.Color(0, 0, 0, 255)
  };

  // SceneLayer is not exported so here's a hack to retreive it
  const SceneLayer = window.Tools.SELECT_TOOL.getSceneLayer({
    ...store.getState(),
    toolState: { SELECT_TOOL: { status: {}, selectedPoints: [] } }
  }).constructor;

  class BezierTool extends DefaultTool {
    dispatch(a) {
      super.dispatch(a);
    }
    getState() {
      return super.getState();
    }
    /** @return {V2} */
    toTrackPos(p) {
      return super.toTrackPos(p);
    }

    shouldPointSnap() {
      const disableSnap = getModifier(
        this.getState(),
        "modifiers.disablePointSnap"
      );
      return !disableSnap;
    }

    shouldAngleLock() {
      return getModifier(this.getState(), "modifiers.angleLock");
    }

    static get usesSwatches() {
      return true;
    }

    static getCursor(state) {
      return getPlayerRunning(state) ? "inherit" : "crosshair";
    }

    static getSceneLayer(state) {
      let layer = new SceneLayer(TOOL_LAYER);

      const zoom = getEditorZoom(state);
      const s = getBezierToolState(state);

      const entities = [];

      if (
        s instanceof ControlOneState ||
        s instanceof ControlTwoState ||
        s instanceof EditState
      ) {
        entities.push(
          genLine(
            s.p1.x,
            s.p1.y,
            s.c1.x,
            s.c1.y,
            THICKNESS / zoom,
            Colors.One,
            1
          )
        );
      }
      if (s instanceof ControlTwoState || s instanceof EditState) {
        entities.push(
          genLine(
            s.p2.x,
            s.p2.y,
            s.c2.x,
            s.c2.y,
            THICKNESS / zoom,
            Colors.Two,
            2
          )
        );
      }

      if (s instanceof EditState) {
        entities.push(
          ...genPoint(
            s.p1.x,
            s.p1.y,
            POINT_RADIUS / zoom / 2,
            1 / zoom,
            Colors.One,
            Colors.PointBorder,
            3
          )
        );
        entities.push(
          ...genPoint(
            s.c1.x,
            s.c1.y,
            POINT_RADIUS / zoom / 2,
            1 / zoom,
            Colors.One,
            Colors.PointBorder,
            4
          )
        );
        entities.push(
          ...genPoint(
            s.p2.x,
            s.p2.y,
            POINT_RADIUS / zoom / 2,
            1 / zoom,
            Colors.Two,
            Colors.PointBorder,
            5
          )
        );
        entities.push(
          ...genPoint(
            s.c2.x,
            s.c2.y,
            POINT_RADIUS / zoom / 2,
            1 / zoom,
            Colors.Two,
            Colors.PointBorder,
            6
          )
        );
      }
      for (let e of entities) {
        layer = layer.withEntityAdded(e);
      }

      return layer;
    }

    constructor(store) {
      super(store);

      this.dispatch(setBezierToolState(new InitState()));
    }

    onPointerDown(e) {
      const state = getBezierToolState(this.getState());

      let pos = this.toTrackPos(e.pos);

      let nextState;
      if (state instanceof InitState) {
        if (this.shouldPointSnap()) {
          pos = getPointSnapPos(pos, this.getState(), null, null, true);
        }
        nextState = new ControlOneState(pos, pos);
      }
      if (state instanceof ControlOneState) {
        if (this.shouldPointSnap()) {
          pos = getPointSnapPos(pos, this.getState(), null, null, true);
        }
        nextState = ControlTwoState.fromControlOne(state, pos);
        this.addCurve(nextState);
      }
      if (state instanceof EditState) {
        const zoom = getEditorZoom(this.getState());
        nextState = state.handleDown(pos, POINT_RADIUS / zoom / 2);
      }
      if (nextState) {
        this.dispatch(setBezierToolState(nextState));
      }
    }
    onPointerDrag(e) {
      const state = getBezierToolState(this.getState());

      let pos = this.toTrackPos(e.pos);

      let nextState;
      if (state instanceof ControlOneState) {
        if (this.shouldAngleLock() && state.p1.vec) {
          pos = getAngleLockPos(pos, state.p1, state.p1.vec);
        }
        nextState = ControlOneState.withControlPoint(state, pos);
      }
      if (state instanceof ControlTwoState) {
        this.dispatch(revertTrackChanges());
        if (this.shouldAngleLock() && state.p2.vec) {
          pos = getAngleLockPos(pos, state.p2, state.p2.vec);
        }
        nextState = ControlTwoState.withControlPoint(state, pos);
        this.addCurve(nextState);
      }
      if (state instanceof EditState) {
        nextState = state.handleDrag(
          pos,
          this.getState(),
          new Set(),
          this.shouldPointSnap(),
          this.shouldAngleLock()
        );
        if (nextState) {
          this.dispatch(revertTrackChanges());
          this.addCurve(nextState);
        }
      }
      if (nextState) {
        this.dispatch(setBezierToolState(nextState));
      }
    }
    onPointerUp(e) {
      const state = getBezierToolState(this.getState());

      let nextState;
      if (state instanceof ControlTwoState) {
        nextState = EditState.fromControlTwo(state);
      }
      if (state instanceof EditState && state.activePoint !== "none") {
        nextState = state.clone();
        nextState.activePoint = "none";
      }
      if (nextState) {
        this.dispatch(setBezierToolState(nextState));
      }
    }
    /** @param {ControlTwoState | EditState} s */
    addCurve(s) {
      const points = bezier(
        [s.p1.x, s.p1.y],
        [s.c1.x, s.c1.y],
        [s.c2.x, s.c2.y],
        [s.p2.x, s.p2.y],
        2
      );

      const lines = [];
      let prevPoint = points.shift();
      const type = getSelectedLineType(this.getState());
      for (let p of points) {
        lines.push({
          x1: prevPoint[0],
          y1: prevPoint[1],
          x2: p[0],
          y2: p[1],
          type
        });
        prevPoint = p;
      }
      this.dispatch(addLines(lines));
    }
    detach() {
      this.dispatch(revertTrackChanges());
    }
  }

  const e = React.createElement;

  class BezierComponent extends React.Component {
    constructor(props) {
      super(props);

      if (!this.setState) {
        this.setState = this.setState;
      }

      this.state = {
        count: 0,
        changed: false,
        status: "Not Connected"
      };

      store.subscribe(() => {
        const changed =
          getSimulatorTrack(store.getState()) !==
          getSimulatorCommittedTrack(store.getState());
        if (changed !== this.state.changed) {
          this.setState({ changed });
        }
      });
    }

    onCommit() {
      store.dispatch(commitTrackChanges());
      store.dispatch(setBezierToolState(new InitState()));
    }
    onReset() {
      if (this.state.changed) {
        store.dispatch(revertTrackChanges());
      }
      store.dispatch(setBezierToolState(new InitState()));
    }

    render() {
      return e("div", null, [
        "Bezier Tool",
        e("div", null, [
          e(
            "button",
            {
              onClick: this.onCommit.bind(this),
              disabled: !this.state.changed
            },
            "Commit"
          ),
          e("button", { onClick: this.onReset.bind(this) }, "Reset")
        ])
      ]);
    }
  }

  window.registerCustomTool(TOOL_ID, BezierTool, BezierComponent);
}

/* init */
if (window.registerCustomTool) {
  main();
} else {
  const prevCb = window.onCustomToolsApiReady;
  window.onCustomToolsApiReady = () => {
    if (prevCb) prevCb();
    main();
  };
}
