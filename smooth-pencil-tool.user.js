// ==UserScript==
// @name         Line Rider Smooth Pencil Tool
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://www.linerider.com/*
// @match        https://*.linerider.io/*
// @grant        none
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

(function() {
  'use strict'

  let V2 = null // set at init to the right type

  const getColorSelected = state => state.toolbars.colorSelected

  const ADD_LINES = 'ADD_LINES'
  const COMMIT_TRACK_CHANGES = 'COMMIT_TRACK_CHANGES'
  const REVERT_TRACK_CHANGES = 'REVERT_TRACK_CHANGES'

  const addLines = (lines) => ({
    type: ADD_LINES,
    payload: lines
  })

  const commitTrackChanges = () => ({
    type: COMMIT_TRACK_CHANGES
  })

  const revertTrackChanges = () => ({
    type: REVERT_TRACK_CHANGES,
    meta: { ignorable: true }
  })

  const getEditorZoom = state => state.camera.editorZoom
  const getMinLineLength = (state) => Math.max(4 / getEditorZoom(state), 0.1)

  function smoothPoints (input) {
    let output = []

    if (input.length > 0) {
      output.push(input[0].copy())
    }

    for (let i = 0; i < input.length - 1; ++i) {
      const p0 = input[i]
      const p1 = input[i+1]
      const p0x = p0.x
      const p0y = p0.y
      const p1x = p1.x
      const p1y = p1.y

      var Q = V2.from(0.75 * p0x + 0.25 * p1x, 0.75 * p0y + 0.25 * p1y)
      var R = V2.from(0.25 * p0x + 0.75 * p1x, 0.25 * p0y + 0.75 * p1y)

      output.push(Q)
      output.push(R)
    }

    if (input.length > 1) {
      output.push(input[input.length - 1].copy())
    }

    return output
  }

  function normalizeDegrees (angle) {
    angle = angle % 360
    if (angle < 0) {
      angle += 360
    }

    return angle
  }

  function reducePoints (points, angleThresholdDegrees, lengthThreshold) {
    let output = []

    if (points.length > 0) {
      output.push(points[0].copy())
    }

    for (let i = 1; i < points.length - 1; ++i) {
      let prev = output[output.length - 1]
      let curr = points[i]

      let dist = V2.dist(prev, curr)
      if (dist > lengthThreshold) {
        output.push(curr)
        continue
      }

      if (dist > lengthThreshold / 10 && i > 2) {
        let a = points[i - 2].copy()
        let b = points[i - 1].copy()
        let c = points[i].copy()

        let ba = V2.from(a.x - b.x, a.y - b.y)
        let bc = V2.from(c.x - b.x, c.y - b.y)
        let baLen = ba.len()
        let bcLen = bc.len()

        let angle = Math.acos(ba.dot(bc) / (baLen * bcLen))
        angle = normalizeDegrees(angle * (180 / Math.PI))

        if (angle > 180) {
          angle = 360 - angle
        }

        if (180 - angle > angleThresholdDegrees) {
          output.push(curr)
          continue
        }
      }
    }

    if (points.length > 1 && !V2.equals(output[output.length - 1], points[points.length - 1])) {
      output.push(points[points.length - 1].copy())
    }

    return output
  }

  // poll until we can add custom tools
  let t = setInterval(() => {
    if (window.addCustomTool) {
      clearInterval(t)
      initTool()
    }
  }, 500)

  function initTool () {
    V2 = window.store.getState().simulator.engine.engine.state.startPoint.constructor

    class SmoothPencilTool extends DefaultTool {
      static get name() { return 'SmoothPencilTool' }
      static get id() { return 'SmoothPencilTool' }
      static get usesSwatches() { return true }

      onPointerDown (e) {
        this.points = []
        this.lastPoint = null
        this.onPointerDrag(e)
      }

      onPointerDrag (e) {
        this.addPoint(this.toTrackPos(e.pos))
      }

      onPointerUp (e) {
        if (e) {
          this.onPointerDrag(e)
        }

        if (this.points) {
          this.addLines()
          this.points = null
          this.dispatch(commitTrackChanges())
        }
      }

      addPoint (point) {
        if (this.lastPoint == null) {
          this.lastPoint = point
          this.points.push(point)
        }

        let length = V2.dist(this.lastPoint, point)
        let threshold = getMinLineLength(this.getState())

        if (length > threshold) {
          this.points.push(point)

          // add in a rough line - this will be erased later and replaced
          // with a smoother input
          const type = getColorSelected(this.getState())
          this.dispatch(addLines([{
            type,
            x1: this.lastPoint.x,
            y1: this.lastPoint.y,
            x2: point.x,
            y2: point.y
          }]))

          this.lastPoint = point
        }
      }

      addLines () {
        let points = this.points
        points = smoothPoints(smoothPoints(points))
        points = reducePoints(points, 5, getMinLineLength(this.getState()) * 4)

        let lines = []
        const type = getColorSelected(this.getState())

        for (let i = 1; i < points.length; ++i) {
          const begin = points[i - 1]
          const end = points[i]

          lines.push({
            type,
            x1: begin.x,
            y1: begin.y,
            x2: end.x,
            y2: end.y
          })
        }

        this.dispatch(revertTrackChanges())
        this.dispatch(addLines(lines))
      }
    }

    function onActivate () {
      // do nothing
    }

    function onDeactivate () {
      // do nothing
    }

    window.addCustomTool(SmoothPencilTool, onActivate, onDeactivate)
  }
})();
