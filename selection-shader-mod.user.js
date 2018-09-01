// ==UserScript==
// @name         Line Rider Selection Shader Mod
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Adds ability to shade in selections
// @author       David Lu
// @match        https://www.linerider.com/*
// @match        https://*.linerider.io/*
// @grant        none
// @require      https://wzrd.in/standalone/lodash.sortedindex@latest
// @require      https://wzrd.in/standalone/lodash.sortedindexby@latest
// @downloadURL  https://github.com/EmergentStudios/linerider-userscript-mods/raw/master/selection-shader-mod.user.js
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

/* deps */
const sortedIndex = window.lodash.sortedindex
const sortedIndexBy = window.lodash.sortedindexby

/* constants */
const SELECT_TOOL = 'SELECT_TOOL'
const EMPTY_SET = new Set()
const LINE_WIDTH = 2

/* actions */
const setTool = (tool) => ({
  type: 'SET_TOOL',
  payload: tool
})

const setToolState = (toolId, state) => ({
  type: 'SET_TOOL_STATE',
  payload: state,
  meta: { id: toolId }
})

const setSelectToolState = toolState => setToolState(SELECT_TOOL, toolState)

const updateLines = (linesToRemove, linesToAdd, name) => ({
  type: 'UPDATE_LINES',
  payload: { linesToRemove, linesToAdd },
  meta: { name: name }
})

const addLines = (line) => updateLines(null, line, 'ADD_LINES')

const commitTrackChanges = () => ({
  type: 'COMMIT_TRACK_CHANGES'
})

const revertTrackChanges = () => ({
  type: 'REVERT_TRACK_CHANGES'
})

/* selectors */
const getActiveTool = state => state.selectedTool
const getToolState = (state, toolId) => state.toolState[toolId]
const getSelectToolState = state => getToolState(state, SELECT_TOOL)
const getSimulatorCommittedTrack = state => state.simulator.committedEngine
const getTrackLinesLocked = state => state.trackLinesLocked
const getSelectedLineType = state => getTrackLinesLocked(state) ? 2 : state.selectedLineType

class ShadeMod {
  constructor (store, initState) {
    this.store = store

    this.changed = false
    this.state = initState

    this.track = getSimulatorCommittedTrack(this.store.getState())
    this.selectedPoints = EMPTY_SET
    this.lineType = getSelectedLineType(this.store.getState())

    store.subscribeImmediate(() => {
      if (this.state.active) {
        const selectToolState = getSelectToolState(this.store.getState())
        if (selectToolState && selectToolState.multi && selectToolState.status.pressed) {
          // prevent multi-adjustment
          this.store.dispatch(setSelectToolState({ status: { inactive: true } }))
        }
      }

      this.onUpdate()
    })

    window.addModMiddleware(store => next => action => {
      switch (action.type) {
        case 'TRIGGER_COMMAND':
          switch (action.payload) {
            case 'triggers.removeLastLine':
              if (this.state.active) {
                return
              }
              break
            case 'triggers.undo':
            case 'triggers.redo':
              if (this.state.active && this.changed) {
                store.dispatch(revertTrackChanges())
                this.changed = false
              }
          }
      }
      return next(action)
    })
  }

  commitShade () {
    if (this.changed) {
      this.store.dispatch(commitTrackChanges())
      this.store.dispatch(revertTrackChanges())
      this.changed = false
      return true
    }
  }

  onUpdate (nextState = this.state) {
    let shouldUpdate = false

    if (!this.state.active && nextState.active) {
      window.previewLinesInFastSelect = true
    }
    if (this.state.active && !nextState.active) {
      window.previewLinesInFastSelect = false
    }

    if (this.state !== nextState) {
      this.state = nextState
      shouldUpdate = true
    }

    if (this.state.active) {
      const track = getSimulatorCommittedTrack(this.store.getState())
      if (this.track !== track) {
        this.track = track
        shouldUpdate = true
      }

      const selectToolState = getSelectToolState(this.store.getState())

      let selectedPoints = selectToolState.selectedPoints

      if (!selectToolState.multi) {
        selectedPoints = EMPTY_SET
      }

      if (!setsEqual(this.selectedPoints, selectedPoints)) {
        this.selectedPoints = selectedPoints
        shouldUpdate = true
      }

      const lineType = getSelectedLineType(this.store.getState())
      if (this.lineType !== lineType) {
        this.lineType = lineType
        shouldUpdate = true
      }
    }

    if (shouldUpdate) {
      if (this.changed) {
        this.store.dispatch(revertTrackChanges())
        this.changed = false
      }

      if (this.state.active && this.selectedPoints.size > 0) {
        const selectedLines = [...getLinesFromPoints(this.selectedPoints)]
          .map(id => this.track.getLine(id))
          .filter(l => l)

        let shadeLines = []
        for (let { p1, p2 } of genFill(selectedLines, this.state)) {
          shadeLines.push({
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            type: this.lineType
          })
        }

        if (shadeLines.length > 0) {
          this.store.dispatch(addLines(shadeLines))
          this.changed = true
        }
      }
    }
  }
}

function main () {
  const {
    React,
    store
  } = window

  const e = React.createElement

  Object.defineProperty(window.Tools.SELECT_TOOL, 'usesSwatches', { value: true })

  class ShadeModComponent extends React.Component {
    constructor (props) {
      super(props)

      this.state = {
        active: false,
        angle: 0,
        spacing: -0.2,
        offset: 0
      }

      this.shadeMod = new ShadeMod(store, this.state)

      store.subscribe(() => {
        const selectToolActive = getActiveTool(store.getState()) === SELECT_TOOL

        if (this.state.active && !selectToolActive) {
          this.setState({ active: false })
        }
      })
    }

    componentWillUpdate (nextProps, nextState) {
      this.shadeMod.onUpdate(nextState)
    }

    onActivate () {
      if (this.state.active) {
        this.setState({ active: false })
      } else {
        store.dispatch(setTool(SELECT_TOOL))
        this.setState({ active: true })
      }
    }

    onCommit () {
      const committed = this.shadeMod.commitShade()
      if (committed) {
        this.setState({ active: false })
      }
    }

    renderSlider (key, props) {
      props = {
        ...props,
        value: this.state[key],
        onChange: e => this.setState({ [key]: parseFloat(e.target.value) })
      }
      return e('div', null,
        key,
        e('input', { style: { width: '3em' }, type: 'number', ...props }),
        e('input', { type: 'range', ...props, onFocus: e => e.target.blur() })
      )
    }

    render () {
      return e('div',
        null,
        this.state.active && e('div', null,
          this.renderSlider('angle', { min: 0, max: 360, step: 1 }),
          this.renderSlider('spacing', { min: -0.2, max: 10, step: 0.01 }),
          this.renderSlider('offset', { min: 0, max: 1, step: 0.01 }),
          e('button', { style: { float: 'left' }, onClick: () => this.onCommit() },
            'Commit'
          )
        ),
        e('button',
          {
            style: {
              backgroundColor: this.state.active ? 'lightblue' : null
            },
            onClick: this.onActivate.bind(this)
          },
          'Shade Mod'
        )
      )
    }
  }

  // this is a setting and not a standalone tool because it extends the select tool
  window.registerCustomSetting(ShadeModComponent)
}

/* init */
if (window.registerCustomSetting) {
  main()
} else {
  const prevCb = window.onCustomToolsApiReady
  window.onCustomToolsApiReady = () => {
    if (prevCb) prevCb()
    main()
  }
}

/* utils */
function setsEqual (a, b) {
  if (a === b) {
    return true
  }
  if (a.size !== b.size) {
    return false
  }
  for (let x of a) {
    if (!b.has(x)) {
      return false
    }
  }
  return true
}

function getLinesFromPoints (points) {
  return new Set([...points].map(point => point >> 1))
}

// takes an iterable of lines and properties and returns an iterable of lines of alternating fill
function* genFill (lines, { angle = 0, spacing = 0, offset = 0 } = {}) {
  const { V2 } = window
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
        } else if (currentY === y) {
          // do not include the edge case of exactly overlapping lines
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

function rotateTransform (rads) {
  const { V2 } = window

  let u = V2.from(1, 0).rot(rads)
  let v = V2.from(0, 1).rot(rads)

  return [u.x, v.x, u.y, v.y, 0, 0]
}
