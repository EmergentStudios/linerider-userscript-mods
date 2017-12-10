// ==UserScript==
// @name         Line Rider Quadratic Curve Tool
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
  const getSimulatorCommittedTrack = state => state.simulator.committedEngine
  const getModKeys = state => state.modKeys
  const getEditorZoom = state => state.camera.editorZoom
  const getMinLineLength = state => Math.max(4 / getEditorZoom(state), 0.1)

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

  function getQuadraticPoint (p1, control, p2, t) {
    const x = (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * control.x + t * t * p2.x
    const y = (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * control.y + t * t * p2.y

    return V2.from(x, y)
  }

  function getQuadraticPoints (p1, control, p2, numPoints) {
	let output = []
    output.push(p1.copy())

    for (let i = 1; i < numPoints; ++i) {
      let t = 1 / numPoints * i
      output.push(getQuadraticPoint(p1, control, p2, t))
    }

    output.push(p2.copy())
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

    class QuadtraticCurveTool extends DefaultTool {
      static get name() { return 'QuadtraticCurveTool' }
      static get id() { return 'QuadtraticCurveTool' }
      static get usesSwatches() { return true }

      constructor (state) {
        super(state)
        this.reset()
      }

      reset () {
        this.p1 = null
        this.p2 = null
        this.control = null
      }

      snap (pos) {
        if (!this.shouldPointSnap()) {
          return pos
        }

        let track = getSimulatorCommittedTrack(this.getState()) // only snap to committed lines so we don't self-snap
        let closestDistance = getMinLineLength(this.getState()) * 2
        let snapPos = pos
        let lines = track.selectLinesInRadius(pos, closestDistance)

        function getCloserPoint (point) {
          let distance = pos.dist(point)
          if (distance < closestDistance) {
            closestDistance = distance
            snapPos = point
          }
        }

        for (let line of lines) {
          getCloserPoint(line.p1)
          getCloserPoint(line.p2)
        }

        return snapPos
      }

      shouldPointSnap () {
        let { alt, mod } = getModKeys(this.getState())
        return !alt && !mod
      }

      onPointerDown (e) {
        let trackPos = this.toTrackPos(e.pos)

        if (!this.p1) {
          this.p1 = this.snap(trackPos)
        } else if (!this.p2) {
          this.p2 = this.snap(trackPos)
        } else {
          this.control = trackPos
        }

        this.update()
      }

      onPointerDrag (e) {
        let trackPos = this.toTrackPos(e.pos)
        if (!this.p2) {
          this.p1 = this.snap(trackPos)
        } else if (!this.control) {
          this.p2 = this.snap(trackPos)
        } else {
          this.control = trackPos
        }

        this.update()
      }

      onPointerUp (e) {
        if (!e) {
          this.onCancel()
          return
        }

        this.onPointerDrag(e)

        if (this.control) {
          this.dispatch(commitTrackChanges())
          this.reset()
        }
      }

      onCancel () {
        this.reset()
        this.dispatch(revertTrackChanges())
      }

      update () {
        const type = getColorSelected(this.getState())
        this.dispatch(revertTrackChanges())

        if (this.p1 && this.p2 && this.control) {
          let points = getQuadraticPoints(this.p1, this.control, this.p2, 128)
          points = reducePoints(points, 5, getMinLineLength(this.getState()) * 2)

          let lines = []
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

          this.dispatch(addLines(lines))
        } else if (this.p1 && this.p2) {
          this.dispatch(addLines([{
            type,
            x1: this.p1.x,
            y1: this.p1.y,
            x2: this.p2.x,
            y2: this.p2.y
          }]))
        } else if (this.p1) {
          this.dispatch(addLines([{
            type,
            x1: this.p1.x,
            y1: this.p1.y,
            x2: this.p1.x + 0.001,
            y2: this.p1.y
          }]))
        }
      }
    }

    function onActivate () {
      // do nothing
    }

    function onDeactivate () {
      // do nothing
    }

    window.addCustomTool(QuadtraticCurveTool, onActivate, onDeactivate)
  }
})();
