// ==UserScript==
// @name         Line Rider Selection Slice Mod
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Adds ability to slice lines with a selection
// @author       David Lu
// @match        https://www.linerider.com/*
// @match        https://*.linerider.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/EmergentStudios/linerider-userscript-mods/master/lib/sortedindex.js
// @require      https://raw.githubusercontent.com/EmergentStudios/linerider-userscript-mods/master/lib/sortedindexby.js
// @downloadURL  https://github.com/EmergentStudios/linerider-userscript-mods/raw/master/selection-slice-mod.user.js
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

// add_line adds to active layer but we want to keep layers
const newLines = (line) => updateLines(null, line, 'NEW_LINES')

const setLines = (lines) => updateLines(null, lines, 'SET_LINES')

const removeLines = (lineIds) => updateLines(lineIds, null, 'REMOVE_LINES')

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
const getSimulatorTrack = state => state.simulator.engine
const getTrackLinesLocked = state => state.trackLinesLocked

class SliceMod {
  constructor (store, initState) {
    this.store = store

    this.changed = false
    this.state = initState

    this.track = getSimulatorCommittedTrack(this.store.getState())
    this.selectedPoints = EMPTY_SET
    // this.lineType = getSelectedLineType(this.store.getState())

    store.subscribeImmediate(() => {
      if (this.state.active) {
        const selectToolState = getSelectToolState(this.store.getState())
        if (selectToolState && selectToolState.status.pressed) {
          // prevent any adjustment
          this.store.dispatch(setSelectToolState({ status: { inactive: true } }))
        }
      }

      this.onUpdate()
    })

    // addModMiddleware does not work for more than one mod!
    // window.addModMiddleware(store => next => action => {
    //   debugger
    //   switch (action.type) {
    //     case 'TRIGGER_COMMAND':
    //       switch (action.payload) {
    //         case 'triggers.removeLastLine':
    //           if (this.state.active) {
    //             return
    //           }
    //           break
    //         case 'triggers.undo':
    //         case 'triggers.redo':
    //           if (this.state.active && this.changed) {
    //             store.dispatch(revertTrackChanges())
    //             this.changed = false
    //           }
    //       }
    //   }
    //   return next(action)
    // })
  }

  commitSlice () {
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

      if (!setsEqual(this.selectedPoints, selectedPoints)) {
        this.selectedPoints = selectedPoints
        shouldUpdate = true
      }
    }

    if (shouldUpdate) {
      if (this.changed) {
        this.store.dispatch(revertTrackChanges())
        this.changed = false
      }

      if (this.state.active && this.selectedPoints.size > 0) {
        const selectedLines = new Set([...getLinesFromPoints(this.selectedPoints)]
          .map(id => this.track.getLine(id))
          .filter(l => l))

        let track = this.track
        const selectLinesInRect = rect => track.selectLinesInRect(rect)

        this.changed = performSlice(
          selectedLines,
          selectLinesInRect,
          line => {
            this.store.dispatch(setLines([line]))
            track = getSimulatorTrack(this.store.getState())
          },
          line => {
            this.store.dispatch(newLines([line]))
            track = getSimulatorTrack(this.store.getState())
          }
        )

        if (this.state.remove) {
          const linesToRemove = [...genRemove(selectedLines, selectLinesInRect, this.state)]

          if (linesToRemove.length > 0) {
            this.store.dispatch(removeLines(linesToRemove))
            this.changed = true
          }
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

  class SliceModComponent extends React.Component {
    constructor (props) {
      super(props)

      this.state = {
        active: false,
        angle: 0,
        remove: true
      }

      this.sliceMod = new SliceMod(store, this.state)

      store.subscribe(() => {
        const selectToolActive = getActiveTool(store.getState()) === SELECT_TOOL

        if (this.state.active && !selectToolActive) {
          this.setState({ active: false })
        }
      })
    }

    componentWillUpdate (nextProps, nextState) {
      this.sliceMod.onUpdate(nextState)
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
      const committed = this.sliceMod.commitSlice()
      if (committed) {
        this.setState({ active: false })
      }
    }

    onToggleRemove() {
      this.setState(({ remove }) => ({ remove: !remove }))
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
          e('label', null,
            'Remove',
            e('input', { type: 'checkbox', checked: this.state.remove, onClick: () => this.onToggleRemove() })
          ),
          this.renderSlider('angle', { min: 0, max: 360, step: 1, disabled: !this.state.remove }),
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
          'Slice Mod'
        )
      )
    }
  }

  // this is a setting and not a standalone tool because it extends the select tool
  window.registerCustomSetting(SliceModComponent)
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

function performSlice(selectedLines, selectLinesInRect, setLine, addLine) {
  let changed = false
  for (let selectedLine of selectedLines) {
    const {p1, p2} = selectedLine

    const lines = selectLinesInRect({
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      width: Math.abs(p1.x - p2.x),
      height: Math.abs(p1.y - p2.y)
    })

    for (let line of lines) {
      // skip lines in selection
      if (selectedLines.has(line)) continue

      const t = lineLineIntersection(p1.x, p1.y, p2.x, p2.y, line.p1.x, line.p1.y, line.p2.x, line.p2.y)

      if (t != null && t !== true) {
        const json = line.toJSON()
        const x = p1.x + (p2.x - p1.x) * t
        const y = p1.y + (p2.y - p1.y) * t

        setLine({
          ...json,
          x2: x,
          y2: y
        })
        addLine({
          ...json,
          x1: x,
          y1: y,
          id: null
        })
        changed = true
      }
    }
  }
  return changed
}

// takes an iterable of lines and returns an iterable of line IDs to remove
function* genRemove (selectedLines, selectLinesInRect, {angle = 0} = {}) {
  const { V2 } = window
  /* prep */

  // degrees to radians
  let rads = angle / 180 * Math.PI

  // create angle basis
  let toAngle = rotateTransform(rads)
  let fromAngle = rotateTransform(-rads)

  const linesToRemove = selectLinesInRect(getBBoxFromLines(selectedLines))

  /* build sorted line endpoints + line midpoints */

  // accumulate sorted transformed endpoints + line points
  let points = []

  // sort by x
  const insertSorted = point => points.splice(sortedIndexBy(points, point, p => p.x), 0, point)

  for (let line of selectedLines) {
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

  for (let line of linesToRemove) {
    if (selectedLines.has(line)) continue

    const mid = new V2(line.p1).add(line.p2).div(2).transform(toAngle)

    insertSorted({ id: line.id, x: mid.x, y: mid.y, remove: true })
  }

  /* sweep through endpoints and get line fill */

  // keep track of what lines the cursor intersects
  let currentLines = new Set()

  // keep track of sorted y positions (for inner loop)
  let ys = []

  for (let point of points) {
    // put cursor on point-to-remove, and accumlulate sorted y position intersections
    if (point.remove) {
      const currentX = point.x
      // iterate through lines the cursor is intersecting to acc
      for (let { p1, p2 } of currentLines.values()) {
        // get relative x position of cursor on currentLine
        let t = (currentX - p1.x) / (p2.x - p1.x)

        // get y position of intersection btwn cursor and currentLine
        let y = t * (p2.y - p1.y) + p1.y

        // insert sorted
        ys.splice(sortedIndex(ys, y), 0, y)
      }

      // check where point-to-remove lies
      const i = sortedIndex(ys, point.y)
      if (i < ys.length && (i % 2) === 1) {
        yield point.id
      }

      // clear ys for next iteration
      ys.length = 0
    }

    // enter/exit line segments
    if (point.line) {
      if (currentLines.has(point.line)) {
        currentLines.delete(point.line)
      } else {
        currentLines.add(point.line)
      }
    }
  }
}

function rotateTransform (rads) {
  const { V2 } = window

  let u = V2.from(1, 0).rot(rads)
  let v = V2.from(0, 1).rot(rads)

  return [u.x, v.x, u.y, v.y, 0, 0]
}

/**
 * line 1 endpoints: (x0, y0), (x1, y1)
 * line 2 endpoints: (x2, y2), (x3, y3)
 * inclusive: include edge cases e.g. endpoint touching an edge or on a point (default false)
 *
 * returns:
 * if: there is an intersection
 * then: a value between 0 and 1 describing the position of intersection on line 1
 *   or true if lines are collinear and inclusive is true (undefined point of intersectoin)
 * else: null
 */
function lineLineIntersection (x0, y0, x1, y1, x2, y2, x3, y3, inclusive) {
  const x01 = x1 - x0
  const y01 = y1 - y0
  const x23 = x3 - x2
  const y23 = y3 - y2

  const _01cross23 = x01 * y23 - x23 * y01
  if (_01cross23 === 0) { // collinear
    return inclusive ? true : null
  }
  const orientation = _01cross23 > 0

  const x02 = x2 - x0
  const y02 = y2 - y0
  const _02cross01 = x02 * y01 - y02 * x01
  if ((_02cross01 === 0) ? !inclusive : (_02cross01 < 0) === orientation) {
    return null
  }

  const _02cross23 = x02 * y23 - y02 * x23
  if ((_02cross23 === 0) ? !inclusive : (_02cross23 < 0) === orientation) {
    return null
  }

  if ((_02cross01 === _01cross23) ? !inclusive : (_02cross01 > _01cross23) === orientation) {
    return null
  }
  if ((_02cross23 === _01cross23) ? !inclusive : (_02cross23 > _01cross23) === orientation) {
    return null
  }

  return _02cross23 / _01cross23
}

function getBBoxFromLines(lines) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity

  for (let {p1, p2} of lines) {
    x1 = Math.min(Math.min(x1, p1.x), p2.x)
    y1 = Math.min(Math.min(y1, p1.y), p2.y)
    x2 = Math.max(Math.max(x2, p1.x), p2.x)
    y2 = Math.max(Math.max(y2, p1.y), p2.y)
  }

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1
  }
}
