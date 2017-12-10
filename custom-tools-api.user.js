// ==UserScript==
// @name         Line Rider Custom Tools API
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://www.linerider.com/*
// @match        https://*.linerider.io/*
// @grant        none
// ==/UserScript==

/* jshint asi: true */

(function() {
  'use strict'

  // actions + action creators
  const SET_TOOL = 'SET_TOOL'

  const setTool = (tool) => ({
    type: SET_TOOL,
    payload: tool
  })

  // selectors
  const getSelectedTool = state => state.selectedTool
  const getControlsActive = state => state.ui.controlsActive

  // poll until store is available
  let t = setInterval(() => {
    if (window.store) {
      clearInterval(t)
      initMod()
    }
  }, 500)

  function initMod() {
    console.log('registering custom tools api')

    let customToolsContainer = document.createElement('div')
    customToolsContainer.id = 'custom-tools-container'
    Object.assign(customToolsContainer.style, {
      position: 'absolute',
      bottom: '5px',
      left: '9px',
      backgroundColor: '#eee',
      padding: '5px',
      transition: 'opacity 400ms ease-in-out'
    })

    document.getElementById('content').appendChild(customToolsContainer)

    let state = window.store.getState()
    let activatedTool = getSelectedTool(state)
    let controlsActive = getControlsActive(state)
    let customTools = {}

    window.store.subscribe(() => {
      let newState = window.store.getState()
      let newTool = getSelectedTool(newState)
      let newControlsActive = getControlsActive(newState)

      if (activatedTool !== newTool) {
        if (customTools[activatedTool]) {
          customTools[activatedTool].deactivate()
        }

        if (customTools[newTool]) {
          customTools[newTool].activate()
        }
      }

      // hide/show the custom tools UI with the rest of the UI
      if (controlsActive && !newControlsActive) {
        customToolsContainer.style.opacity = 0
        customToolsContainer.style.pointerEvents = 'none'
      } else if (!controlsActive && newControlsActive) {
        customToolsContainer.style.opacity = 1
        customToolsContainer.style.pointerEvents = null
      }

      activatedTool = newTool
      controlsActive = newControlsActive
    })

    // tool can be a DefaultTool subclass constructor or a string
    window.addCustomTool = function (tool, onActivate, onDeactivate) {
      let name = null
      if (typeof tool === 'string' || tool instanceof String) {
        name = tool
        tool = null
      } else {
        // assume the tool is a subclass of DefaultTool
        name = tool.name
      }

      if (tool) {
        console.log('adding + registering custom tool', name)
        window.registerTool(tool)
      } else {
        console.log('adding custom tool', name)
      }

      let toolButton = document.createElement('button')
      toolButton.type = 'button'
      toolButton.textContent = name
      toolButton.onclick = (e) => {
        window.store.dispatch(setTool(name))
      }

      customTools[name] = {
        activate: function () {
          toolButton.style.backgroundColor = 'lightblue'
          onActivate()
        },
        deactivate: function () {
          toolButton.style.backgroundColor = null
          onDeactivate()
        }
      }

      customToolsContainer.appendChild(toolButton)
    }
  }
})();
