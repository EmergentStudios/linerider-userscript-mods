// ==UserScript==
// @name         Line Rider Custom Tools API
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Allows linerider.com to be modded
// @author       David Lu
// @match        https://www.linerider.com/*
// @match        https://*.official-linerider.com/*
// @match        http://localhost:8000/*
// @grant        none
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

/* actions */
const setTool = (tool) => ({
  type: 'SET_TOOL',
  payload: tool
})

/* selectors */
const getActiveTool = state => state.selectedTool
const getPlayerRunning = state => state.player.running

function main () {
  const {
    React,
    ReactDOM,
    store
  } = window

  const e = React.createElement

  class CustomToolsContainer extends React.Component {
    constructor () {
      super()

      this.state = {
        playerRunning: getPlayerRunning(store.getState()),
        activeTool: getActiveTool(store.getState()),
        customTools: {},
        customSettings: []
      }

      store.subscribe(() => {
        const playerRunning = getPlayerRunning(store.getState())
        if (this.state.playerRunning !== playerRunning) {
          this.setState({ playerRunning })
        }

        const activeTool = getActiveTool(store.getState())
        if (this.state.activeTool !== activeTool) {
          let activeCustomTool = this.state.customTools[this.state.activeTool]
          if (activeCustomTool && activeCustomTool.onDetach) {
            activeCustomTool.onDetach()
          }
          this.setState({ activeTool })
        }
      })
    }

    componentDidMount () {
      /**
       * @param {string} toolName unique tool name
       * @param {Tool} tool extends `window.DefaultTool`
       * @param {React.Component} [component] tool UI component
       * @param {Function} [onDetach] for cleaning up the tool
       */
      window.registerCustomTool = (toolName, tool, component, onDetach) => {
        console.info('Registering custom tool', toolName)

        window.Tools[toolName] = tool

        this.setState((prevState) => ({
          customTools: {
            ...prevState.customTools,
            [toolName]: { component, onDetach }
          }
        }))

        if (onDetach) {
          this.customToolsDestructors[toolName] = onDetach
        }
      }

      /**
       * @param {React.Component} component custom setting UI component
       */
      window.registerCustomSetting = (component) => {
        console.info('Registering custom setting', component.name)
        this.setState((prevState) => ({
          customSettings: [...prevState.customSettings, component]
        }))
      }

      if (typeof window.onCustomToolsApiReady === 'function') {
        window.onCustomToolsApiReady()
      }
    }

    render () {
      const activeCustomTool = this.state.customTools[this.state.activeTool]

      const rootStyle = {
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'flex-end',
        textAlign: 'right',
        transition: 'opacity 225ms cubic-bezier(0.4, 0, 0.2, 1) 0ms',
        opacity: this.state.playerRunning ? 0 : 1,
        pointerEvents: this.state.playerRunning ? 'none' : null
      }

      const boxStyle = {
        display: 'flex',
        flexDirection: 'column-reverse',
        padding: 8,
        borderRadius: 2,
        border: '1px solid rgba(0, 0, 0, 0.12)',
        backgroundColor: 'rgba(255, 255, 255, 0.93)'
      }

      return e('div', { style: rootStyle },
        Object.keys(this.state.customTools).length > 0 && e('div', { style: boxStyle },
          ...Object.keys(this.state.customTools).map(toolName =>
            e('button',
              {
                key: toolName,
                style: {
                  backgroundColor: this.state.activeTool === toolName ? 'lightblue' : null
                },
                onClick: () => store.dispatch(setTool(toolName))
              },
              toolName
            )
          ),
          'Custom Tools'
        ),
        ...this.state.customSettings.map(customSettingComponent => (
          e('div', { style: boxStyle }, e(customSettingComponent))
        )),
        activeCustomTool && activeCustomTool.component && e('div', { style: boxStyle }, e(activeCustomTool.component))
      )
    }
  }

  const container = document.createElement('div')

  Object.assign(container.style, {
    position: 'absolute',
    bottom: '88px',
    right: '8px'
  })

  document.getElementById('content').appendChild(container)

  ReactDOM.render(
    e(CustomToolsContainer),
    container
  )
}

/* init */
if (window.store) {
  main()
} else {
  window.onAppReady = main
}
