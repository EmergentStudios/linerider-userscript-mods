// ==UserScript==
// @name         Line Rider Selection Rotate and Scale Mod
// @namespace    http://tampermonkey.net/
// @version      0.5.1
// @description  Adds ability to rotate and scale selections
// @author       David Lu & Ethan Li
// @match        https://www.linerider.com/*
// @match        https://*.official-linerider.com/*
// @match        http://localhost:8000/*
// @downloadURL  https://github.com/EmergentStudios/linerider-userscript-mods/raw/master/selection-scale-rotate.user.js
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

const setEditScene = (scene) => ({
  type: 'SET_RENDERER_SCENE',
  payload: { key: 'edit', scene }
})

/* selectors */
const getActiveTool = state => state.selectedTool
const getToolState = (state, toolId) => state.toolState[toolId]
const getSelectToolState = state => getToolState(state, SELECT_TOOL)
const getSimulatorCommittedTrack = state => state.simulator.committedEngine
const getEditorZoom = state => state.camera.editorZoom

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
      this.store.dispatch(setEditScene(new Millions.Scene()))
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
        this.store.dispatch(setEditScene(new Millions.Scene()))
        this.changed = false
      }

      if (this.state.active && this.selectedPoints.size > 0 && (this.state.scale !== 1 || this.state.scaleX !== 1 || this.state.scaleY !== 1 || this.state.flipX || this.state.flipY || this.state.rotate !== 0)) {
        const selectedLines = [...getLinesFromPoints(this.selectedPoints)]
          .map(id => this.track.getLine(id))
          .filter(l => l)

        const {x, y, width, height} = getBoundingBox(selectedLines)
        const c = new V2({
          x: x + width / 2,
          y: y + height / 2
        })

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

        const zoom = getEditorZoom(this.store.getState())
        const renderedBox = genBoxOutline(x, y, x + width, y + height, 1 / zoom, new Millions.Color(0, 0, 0, 255), 0)

        for (let line of renderedBox) {
          const p1 = new V2(line.p1).sub(c).transform(transform).add(c)
          const p2 = new V2(line.p2).sub(c).transform(transform).add(c)
          line.p1.x = p1.x
          line.p1.y = p1.y
          line.p2.x = p2.x
          line.p2.y = p2.y
        }
        this.store.dispatch(setEditScene(Millions.Scene.fromEntities(renderedBox)))
        this.changed = true
      }
    }
  }

  getTransform() {
    // The resulting transform is equivalent to the product of a scaling matrix
    // followed by a rotation matrix. Refer to
    // https://www.wolframalpha.com/input/?i=%7B%7Bx+*+s%2C+0%7D%2C+%7B0%2C+y+*+s%7D%7D+.+%7B%7Bcos+theta%2C+sin+theta%7D%2C+%7B-sin+theta%2C+cos+theta%7D%7D
    const transform = rotateTransform(this.state.rotate * Math.PI / 180)
    transform[0] *= this.state.scale
    transform[1] *= this.state.scale
    transform[2] *= this.state.scale
    transform[3] *= this.state.scale
    let scaleX = this.state.scaleX
    if (this.state.flipX) {
        scaleX *= -1
    }
    let scaleY = this.state.scaleY
    if (this.state.flipY) {
        scaleY *= -1
    }
    transform[0] *= scaleX
    transform[1] *= scaleX
    transform[2] *= scaleY
    transform[3] *= scaleY
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
        scaleX: 1,
        scaleY: 1,
        flipX: false,
        flipY: false,
        rotate: 0,
      }

      this.scaleRotateMod = new ScaleRotateMod(store, this.state)

      store.subscribe(() => {
        const selectToolActive = getActiveTool(store.getState()) === SELECT_TOOL

        if (this.state.active && !selectToolActive) {
          this.setState({ active: false })
        }
      })

      this.onReset = (key) => {
        const defaults = {
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          flipX: false,
          flipY: false,
          rotate: 0
        }
        let changedState = {}
        changedState[key] = defaults[key]
        this.setState(changedState)
      }

      this.onCommit = () => {
        this.scaleRotateMod.commit()
        this.setState({
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          flipX: false,
          flipY: false,
          rotate: 0
        })
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

    renderCheckbox (key, props) {
      props = {
        ...props,
        checked: this.state[key],
        onChange: e => this.setState({ [key]: e.target.checked })
      }
      return e('div', null,
        key,
        e('input', { type: 'checkbox', ...props })
      )
    }

    renderSlider (key, props) {
      props = {
        ...props,
        value: this.state[key],
        onChange: e => this.setState({ [key]: parseFloatOrDefault(e.target.value) })
      }
      const rangeProps = {
        ...props
      }
      const numberProps = {
        ...props
      }
      return e('div', null,
        key,
        e('input', { style: { width: '3em' }, type: 'number', ...numberProps }),
        e('input', { type: 'range', ...rangeProps, onFocus: e => e.target.blur() }),
        e('button', { onClick: () => this.onReset(key) }, 'Reset')
      )
    }

    render () {
      return e('div',
        null,
        this.state.active && e('div', null,
          this.renderCheckbox('flipX', { min: 0, max: 2, step: 0.01 }),
          this.renderCheckbox('flipY', { min: 0, max: 2, step: 0.01 }),
          this.renderSlider('scaleX', { min: 0, max: 2, step: 0.01 }),
          this.renderSlider('scaleY', { min: 0, max: 2, step: 0.01 }),
          this.renderSlider('scale', { min: 0, max: 2, step: 0.01 }),
          this.renderSlider('rotate', { min: -180, max: 180, step: 1 }),
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

function genLine (x1, y1, x2, y2, thickness, color, zIndex) {
  let p1 = {
    x: x1,
    y: y1,
    colorA: color,
    colorB: color,
    thickness
  }
  let p2 = {
    x: x2,
    y: y2,
    colorA: color,
    colorB: color,
    thickness
  }
  return new Millions.Line(p1, p2, 3, zIndex)
}


function genBoxOutline (x1, y1, x2, y2, thickness, color, zIndex) {
  return [
    genLine(x1, y1, x1, y2, thickness, color, zIndex),
    genLine(x1, y2, x2, y2, thickness, color, zIndex + 0.1),
    genLine(x2, y2, x2, y1, thickness, color, zIndex + 0.2),
    genLine(x2, y1, x1, y1, thickness, color, zIndex + 0.3)
  ]
}
