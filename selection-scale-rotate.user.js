// ==UserScript==
// @name         Line Rider Selection Rotate and Scale Mod
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Adds ability to rotate and scale selections
// @author       David Lu
// @match        https://www.linerider.com/*
// @match        https://*.linerider.io/*
// @grant        none
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

/* constants */
const SELECT_TOOL = 'SELECT_TOOL'
const EMPTY_SET = new Set()
const LINE_WIDTH = 2

/* actions */
const setTool = (tool) => ({
  type: 'SET_TOOL',
  payload: tool
})

const updateLines = (linesToRemove, linesToAdd) => ({
  type: 'UPDATE_LINES',
  payload: { linesToRemove, linesToAdd }
})

const setLines = (line) => updateLines(null, line)

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

class ScaleRotateMod {
  constructor (store, initState) {
    this.store = store

    this.changed = false
    this.state = initState

    this.track = getSimulatorCommittedTrack(this.store.getState())
    this.selectedPoints = EMPTY_SET

    store.subscribeImmediate(() => {
      this.onUpdate()
    })
  }

  commit () {
    if (this.changed) {
      this.store.dispatch(commitTrackChanges())
      this.store.dispatch(revertTrackChanges())
      this.changed = false
      return true
    }
  }

  onUpdate (nextState = this.state) {
    let shouldUpdate = false

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
    }

    if (shouldUpdate) {
      if (this.changed) {
        this.store.dispatch(revertTrackChanges())
        this.changed = false
      }

      if (this.state.active && this.selectedPoints.size > 0 && (this.state.scale !== 1 || this.state.rotate !== 0)) {
        const selectedLines = [...getLinesFromPoints(this.selectedPoints)]
          .map(id => this.track.getLine(id))
          .filter(l => l)

        const c = getBoundingBoxCenter(selectedLines)
        const transform = this.getTransform()
        const transformedLines = []

        for (let line of selectedLines) {
          const p1 = new V2(line.p1).sub(c).transform(transform).add(c)
          const p2 = new V2(line.p2).sub(c).transform(transform).add(c)

          transformedLines.push({
            ...line.toJSON(),
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y
          })
        }

        this.store.dispatch(setLines(transformedLines))
        this.changed = true
      }
    }
  }

  getTransform() {
    const transform = rotateTransform(this.state.rotate * Math.PI / 180)
    transform[0] *= this.state.scale
    transform[3] *= this.state.scale
    return transform
  }
}

function main () {
  const {
    React,
    store
  } = window

  const e = React.createElement

  class ScaleRotateModComponent extends React.Component {
    constructor (props) {
      super(props)

      this.state = {
        active: false,
        scale: 1,
        rotate: 0,
      }

      this.scaleRotateMod = new ScaleRotateMod(store, this.state)

      store.subscribe(() => {
        const selectToolActive = getActiveTool(store.getState()) === SELECT_TOOL

        if (this.state.active && !selectToolActive) {
          this.setState({ active: false })
        }
      })

      this.onCommit = () => {
        this.scaleRotateMod.commit()
        this.setState({
          scale: 1,
          rotate: 0
        })
      }
      this.onMouseCommit = () => {
        this.onCommit()
        window.removeEventListener('mouseup', this.onMouseCommit)
      }
      this.onKeyCommit = e => {
        if (e.key === 'Enter') {
          this.onCommit()
        }
      }
    }

    componentWillUpdate (nextProps, nextState) {
      this.scaleRotateMod.onUpdate(nextState)
    }

    onActivate () {
      if (this.state.active) {
        this.setState({ active: false })
      } else {
        store.dispatch(setTool(SELECT_TOOL))
        this.setState({ active: true })
      }
    }

    renderSlider (key, props) {
      props = {
        ...props,
        value: this.state[key],
        onChange: e => this.setState({ [key]: parseFloatOrDefault(e.target.value) })
      }
      const rangeProps = {
        ...props,
        onMouseDown: () => window.addEventListener('mouseup', this.onMouseCommit)
      }
      const numberProps = {
        ...props,
        onKeyUp: this.onKeyCommit,
        onBlur: this.onCommit
      }
      return e('div', null,
        key,
        e('input', { style: { width: '3em' }, type: 'number', ...numberProps }),
        e('input', { type: 'range', ...rangeProps, onFocus: e => e.target.blur() })
      )
    }

    render () {
      return e('div',
        null,
        this.state.active && e('div', null,
          this.renderSlider('scale', { min: 0, max: 2, step: 0.01 }),
          this.renderSlider('rotate', { min: -180, max: 180, step: 1 })
        ),
        e('button',
          {
            style: {
              backgroundColor: this.state.active ? 'lightblue' : null
            },
            onClick: this.onActivate.bind(this)
          },
          'Scale Rotate Mod'
        )
      )
    }
  }

  // this is a setting and not a standalone tool because it extends the select tool
  window.registerCustomSetting(ScaleRotateModComponent)
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

function rotateTransform (rads) {
  const { V2 } = window

  let u = V2.from(1, 0).rot(rads)
  let v = V2.from(0, 1).rot(rads)

  return [u.x, v.x, u.y, v.y, 0, 0]
}

function parseFloatOrDefault (string, defaultValue = 0) {
  const x = parseFloat(string)
  return isNaN(x) ? defaultValue : x
}

function getBoundingBoxCenter (lines) {
  const { V2 } = window

  const {x, y, width, height} = getBoundingBox(lines)
  return new V2({
    x: x + width / 2,
    y: y + height / 2
  })
}

function getBoundingBox (lines) {
  if (lines.size === 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let line of lines) {
    minX = Math.min(line.p1.x, minX)
    minY = Math.min(line.p1.y, minY)
    maxX = Math.max(line.p1.x, maxX)
    maxY = Math.max(line.p1.y, maxY)

    minX = Math.min(line.p2.x, minX)
    minY = Math.min(line.p2.y, minY)
    maxX = Math.max(line.p2.x, maxX)
    maxY = Math.max(line.p2.y, maxY)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}
