// ==UserScript==
// @name         Line Rider Fill Tool
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://www.linerider.com/*
// @match        https://*.linerider.io/*
// @grant        none
// @require      https://wzrd.in/standalone/hyperscript@latest
// @require      https://wzrd.in/standalone/lodash.sortedindex@latest
// @require      https://wzrd.in/standalone/lodash.sortedindexby@latest
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

(function() {
  'use strict'

  let sortedIndex = window.lodash.sortedindex
  let sortedIndexBy = window.lodash.sortedindexby
  let V2 = null // we set this at init
  const h = window.hyperscript
  const toolInactive = () => ({ inactive: true })

  const SET_RENDERER_SCENE = 'SET_RENDERER_SCENE'
  const ADD_LINES = 'ADD_LINES'
  const COMMIT_TRACK_CHANGES = 'COMMIT_TRACK_CHANGES'
  const REVERT_TRACK_CHANGES = 'REVERT_TRACK_CHANGES'

  const setRendererScene = (key, scene) => ({
    type: SET_RENDERER_SCENE,
    payload: { key, scene }
  })

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

  const getPlayerRunning = state => state.player.running
  const getColorSelected = state => state.toolbars.colorSelected
  const getSimulatorCommittedTrack = state => state.simulator.committedEngine

  const LAYER = 2
  const LINE_WIDTH = 2
  const SELECTION_WIDTH = LINE_WIDTH / 3
  const SELECTION_COLOR = [0, 255, 255, 50]

  // poll until store is available
  let t = setInterval(() => {
    if (window.addCustomTool) {
      clearInterval(t)
      initTool()
    }
  }, 500)

  function initTool() {
    let { Scene, Line, Color } = window.Millions
    V2 = window.store.getState().simulator.engine.engine.state.startPoint.constructor

    let DefaultTool = window.DefaultTool

    let fillProps = {
      angle: 0,
      spacing: 0,
      offset: 0
    }
    let fillTool
    class FillTool extends DefaultTool {
      static get name() { return 'FillTool' }
      static get id() { return 'FillTool' }

      static get usesSwatches() { return true }

      constructor(store) {
        super(store)

        this.fill = toolInactive() // always inactive bc only considering pointer down
        this.fillSelection = new Map()
        this.fillProps = fillProps // mutate props bc linked to UI code
        this.fillChanged = false

        fillTool = this
      }

      onCommand() {
        // ignore all commands if there are selections
        return this.fillSelection.size > 0
      }

      onPlaybackStateChange(inPlayback) {
        super.onPlaybackStateChange(inPlayback)
        this.fill = this.handlePlaybackDisabling(inPlayback, this.fill)
      }

      onPointerDown(e) {
        if (!this.fill.disabled) {
          let pos = this.toTrackPos(e.pos)
          let track = getSimulatorCommittedTrack(this.getState())

          const selectNewLine = () => {
            let lines = track.selectLinesInRadius(pos, LINE_WIDTH / 2)
            // select line with highest id
            let topLineId = -1
            let topLine = null
            for (let line of lines) {
              if (line.id > topLineId) {
                topLineId = line.id
                topLine = line
              }
            }
            return topLine
          }

          let line = selectNewLine()

          if (!line) return

          if (this.fillSelection.has(line.id)) {
            this.fillSelection.delete(line.id)
          } else {
            this.fillSelection.set(line.id, line)
          }

          this.selectionChanged()
        }
      }

      clearSelection() {
        this.fillSelection.clear()
        this.selectionChanged()
      }

      commitFill() {
        if (this.fillChanged) {
          this.dispatch(commitTrackChanges())
          this.fillChanged = false
        }

        this.clearSelection()
      }

      setProps(key, value) {
        this.fillProps[key] = value
        this.fillLines()
      }

      detach() {
        this.dispatch(setRendererScene('edit', Scene.fromEntities([])))
        if (this.fillChanged) {
          this.dispatch(revertTrackChanges())
        }
      }

      selectionChanged() {
        /* rerender selected lines */
        let entities = []
        for (let line of this.fillSelection.values()) {
          entities.push(genSelectionLine(line))
        }
        this.dispatch(setRendererScene('edit', Scene.fromEntities(entities)))
        /* fill lines */
        this.fillLines()
      }

      fillLines() {
        if (this.fillChanged) {
          this.dispatch(revertTrackChanges())
          this.fillChanged = false
        }

        if (this.fillSelection.size === 0) return

        let lineType = getColorSelected(this.getState())

        let fillLines = []
        for (let { p1, p2 } of genFill(this.fillSelection.values(), this.fillProps)) {
          fillLines.push({
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            type: lineType
          })
        }

        if (fillLines.length > 0) {
          this.dispatch(addLines(fillLines))
          this.fillChanged = true
        }
      }
    }

    window.registerTool(FillTool)

    function genSelectionLine(line) {
      return new Line({
        x: line.p1.x,
        y: line.p1.y,
        colorA: new Color(...SELECTION_COLOR),
        colorB: new Color(...SELECTION_COLOR),
        thickness: SELECTION_WIDTH
      }, {
          x: line.p2.x,
          y: line.p2.y,
          colorA: new Color(...SELECTION_COLOR),
          colorB: new Color(...SELECTION_COLOR),
          thickness: SELECTION_WIDTH
        }, LAYER, line.id)
    }

    /* build UI and register tool with mod API */
    let styles = {
      root: {
        position: 'fixed',
        top: '5px',
        left: '9px',
        'background-color': 'rgba(255,255,255,0.93)',
        padding: '5px'
      },
      number: {
        width: '3em'
      }
    }
    let sliders = [['angle', 0, 360, 1], ['spacing', 0, 10], ['offset']].map(
      ([key, min = 0, max = 1, step = 0.01, value = fillProps[key]]) => {
        let range, num
        let handleRangeInput = e => {
          num.value = e.target.value
          fillTool.setProps(key, parseFloat(e.target.value))
        }
        let handleNumInput = e => {
          range.value = e.target.value
          fillTool.setProps(key, parseFloat(e.target.value))
        }
        range = h('input', { type: 'range', min, max, step, value, oninput: handleRangeInput })
        num = h('input', { style: styles.number, type: 'number', min, max, step, value, oninput: handleNumInput })
        return h('div', range, num, key)
      }
    )
    let fillContainer = h('div', { style: styles.root },
                          h('button', { onclick: () => fillTool.clearSelection() }, 'Clear Selection'),
                          ...sliders,
                          h('button', { onclick: () => fillTool.commitFill() }, 'Commit Fill')
                         )

    let running = getPlayerRunning(window.store.getState())
    window.store.subscribe(() => {
      let newState = window.store.getState()
      let newRunning = getPlayerRunning(newState)
      if (running !== newRunning) {
        if (newRunning) {
          fillContainer.style.display = 'none'
        } else {
          fillContainer.style.display = 'initial'
        }
        running = newRunning
      }
    })

    let customToolsContainer = document.getElementById('custom-tools-container')

    function activate() {
      console.log('activating fill tool')
      customToolsContainer.appendChild(fillContainer)
    }

    function deactivate() {
      console.log('deactivating fill tool')
      fillTool.detach()
      fillTool = null
      customToolsContainer.removeChild(fillContainer)
    }

    window.addCustomTool(FillTool.name, activate, deactivate)
  }

  // takes an iterable of lines and properties and returns an iterable of lines of alternating fill
  function* genFill(lines, { angle, spacing, offset }) {
    /* prep */

    // actual spacing
    spacing = LINE_WIDTH * (1 + spacing)

    // actual offset
    offset = spacing * offset

    // degrees to radians
    let rads = angle / 180 * Math.PI

    // create angle basis
    let toAngle = rotateTransform(rads)
    let fromAngle = rotateTransform(-rads)

    /* build sorted line endpoints */

    // accumulate sorted transformed endpoints
    let points = []

    // sort by x
    const insertSorted = point => points.splice(sortedIndexBy(points, point, p => p.x), 0, point)

    for (let line of lines) {
      // TODO: probably don't need id or point.y
      // transform lines to angle basis
      let id = line.id
      let p1 = new V2(line.p1).transform(toAngle)
      let p2 = new V2(line.p2).transform(toAngle)

      // sort endpoints
      if (p1.x < p2.x) {
        line = { id, p1, p2 }
      } else {
        line = { id, p1: p2, p2: p1 }
      }

      // acc endpoints
      insertSorted({ id, x: line.p1.x, y: line.p1.y, line })
      insertSorted({ id, x: line.p2.x, y: line.p2.y, line })
    }

    /* sweep through endpoints and get line fill */

    // keep track of x-axis cursor
    let currentX = points[0].x + offset

    // keep track of what lines the cursor intersects
    let currentLines = new Set()

    // keep track of sorted y positions (for inner loop)
    let ys = []

    for (let point of points) {
      // sweep through x-axis up to point.x, and accumlulate sorted y position intersections
      for (; currentX < point.x; currentX += spacing) {
        // iterate through lines the cursor is intersecting to acc for sweeping
        for (let { p1, p2 } of currentLines.values()) {
          // get relative x position of cursor on currentLine
          let t = (currentX - p1.x) / (p2.x - p1.x)

          // get y position of intersection btwn cursor and currentLine
          let y = t * (p2.y - p1.y) + p1.y

          // insert sorted
          ys.splice(sortedIndex(ys, y), 0, y)
        }

        // keep track of inside/outside fill
        let currentY = null
        // vertically sweep through lines
        for (let y of ys) {
          if (currentY == null) {
            // enter fill
            currentY = y
          } else {
            // yield the reverse transformed segment between currentY and y
            yield {
              p1: V2.from(currentX, currentY).transform(fromAngle),
              p2: V2.from(currentX, y).transform(fromAngle)
            }
            // exit fill
            currentY = null
          }
        }

        // clear ys for next iteration
        ys.length = 0
      }

      // enter/exit line segments
      if (currentLines.has(point.line)) {
        currentLines.delete(point.line)
      } else {
        currentLines.add(point.line)
      }
    }
  }

  function rotateTransform(rads) {
    let u = V2.from(1, 0).rot(rads)
    let v = V2.from(0, 1).rot(rads)

    return [u.x, v.x, u.y, v.y, 0, 0]
  }
})();
