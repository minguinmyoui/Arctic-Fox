/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* globals ViewHelpers */

"use strict";

// Set of reusable UI components for the animation-inspector UI.
// All components in this module share a common API:
// 1. construct the component:
//    let c = new ComponentName();
// 2. initialize the markup of the component in a given parent node:
//    c.init(containerElement);
// 3. render the component, passing in some sort of state:
//    This may be called over and over again when the state changes, to update
//    the component output.
//    c.render(state);
// 4. destroy the component:
//    c.destroy();

const {Cu} = require("chrome");
Cu.import("resource://devtools/client/shared/widgets/ViewHelpers.jsm");
const {Task} = Cu.import("resource://gre/modules/Task.jsm", {});
const {
  createNode,
  drawGraphElementBackground,
  findOptimalTimeInterval,
  TargetNodeHighlighter
} = require("devtools/client/animationinspector/utils");

const STRINGS_URI = "chrome://devtools/locale/animationinspector.properties";
const L10N = new ViewHelpers.L10N(STRINGS_URI);
const MILLIS_TIME_FORMAT_MAX_DURATION = 4000;
// The minimum spacing between 2 time graduation headers in the timeline (px).
const TIME_GRADUATION_MIN_SPACING = 40;
// List of playback rate presets displayed in the timeline toolbar.
const PLAYBACK_RATES = [.1, .25, .5, 1, 2, 5, 10];
// When the container window is resized, the timeline background gets refreshed,
// but only after a timer, and the timer is reset if the window is continuously
// resized.
const TIMELINE_BACKGROUND_RESIZE_DEBOUNCE_TIMER = 50;

/**
 * UI component responsible for displaying a preview of the target dom node of
 * a given animation.
 * @param {InspectorPanel} inspector Requires a reference to the inspector-panel
 * to highlight and select the node, as well as refresh it when there are
 * mutations.
 * @param {Object} options Supported properties are:
 * - compact {Boolean} Defaults to false. If true, nodes will be previewed like
 *   tag#id.class instead of <tag id="id" class="class">
 */
function AnimationTargetNode(inspector, options={}) {
  this.inspector = inspector;
  this.options = options;

  this.onPreviewMouseOver = this.onPreviewMouseOver.bind(this);
  this.onPreviewMouseOut = this.onPreviewMouseOut.bind(this);
  this.onSelectNodeClick = this.onSelectNodeClick.bind(this);
  this.onMarkupMutations = this.onMarkupMutations.bind(this);
  this.onHighlightNodeClick = this.onHighlightNodeClick.bind(this);
  this.onTargetHighlighterLocked = this.onTargetHighlighterLocked.bind(this);

  EventEmitter.decorate(this);
}

exports.AnimationTargetNode = AnimationTargetNode;

AnimationTargetNode.prototype = {
  init: function(containerEl) {
    let document = containerEl.ownerDocument;

    // Init the markup for displaying the target node.
    this.el = createNode({
      parent: containerEl,
      attributes: {
        "class": "animation-target"
      }
    });

    // Icon to select the node in the inspector.
    this.highlightNodeEl = createNode({
      parent: this.el,
      nodeType: "span",
      attributes: {
        "class": "node-highlighter",
        "title": L10N.getStr("node.highlightNodeLabel")
      }
    });

    // Wrapper used for mouseover/out event handling.
    this.previewEl = createNode({
      parent: this.el,
      nodeType: "span",
      attributes: {
        "title": L10N.getStr("node.selectNodeLabel")
      }
    });

    if (!this.options.compact) {
      this.previewEl.appendChild(document.createTextNode("<"));
    }

    // Tag name.
    this.tagNameEl = createNode({
      parent: this.previewEl,
      nodeType: "span",
      attributes: {
        "class": "tag-name theme-fg-color3"
      }
    });

    // Id attribute container.
    this.idEl = createNode({
      parent: this.previewEl,
      nodeType: "span"
    });

    if (!this.options.compact) {
      createNode({
        parent: this.idEl,
        nodeType: "span",
        attributes: {
          "class": "attribute-name theme-fg-color2"
        },
        textContent: "id"
      });
      this.idEl.appendChild(document.createTextNode("=\""));
    } else {
      createNode({
        parent: this.idEl,
        nodeType: "span",
        attributes: {
          "class": "theme-fg-color2"
        },
        textContent: "#"
      });
    }

    createNode({
      parent: this.idEl,
      nodeType: "span",
      attributes: {
        "class": "attribute-value theme-fg-color6"
      }
    });

    if (!this.options.compact) {
      this.idEl.appendChild(document.createTextNode("\""));
    }

    // Class attribute container.
    this.classEl = createNode({
      parent: this.previewEl,
      nodeType: "span"
    });

    if (!this.options.compact) {
      createNode({
        parent: this.classEl,
        nodeType: "span",
        attributes: {
          "class": "attribute-name theme-fg-color2"
        },
        textContent: "class"
      });
      this.classEl.appendChild(document.createTextNode("=\""));
    } else {
      createNode({
        parent: this.classEl,
        nodeType: "span",
        attributes: {
          "class": "theme-fg-color6"
        },
        textContent: "."
      });
    }

    createNode({
      parent: this.classEl,
      nodeType: "span",
      attributes: {
        "class": "attribute-value theme-fg-color6"
      }
    });

    if (!this.options.compact) {
      this.classEl.appendChild(document.createTextNode("\""));
      this.previewEl.appendChild(document.createTextNode(">"));
    }

    this.startListeners();
  },

  startListeners: function() {
    // Init events for highlighting and selecting the node.
    this.previewEl.addEventListener("mouseover", this.onPreviewMouseOver);
    this.previewEl.addEventListener("mouseout", this.onPreviewMouseOut);
    this.previewEl.addEventListener("click", this.onSelectNodeClick);
    this.highlightNodeEl.addEventListener("click", this.onHighlightNodeClick);

    // Start to listen for markupmutation events.
    this.inspector.on("markupmutation", this.onMarkupMutations);

    // Listen to the target node highlighter.
    TargetNodeHighlighter.on("highlighted", this.onTargetHighlighterLocked);
  },

  stopListeners: function() {
    TargetNodeHighlighter.off("highlighted", this.onTargetHighlighterLocked);
    this.inspector.off("markupmutation", this.onMarkupMutations);
    this.previewEl.removeEventListener("mouseover", this.onPreviewMouseOver);
    this.previewEl.removeEventListener("mouseout", this.onPreviewMouseOut);
    this.previewEl.removeEventListener("click", this.onSelectNodeClick);
    this.highlightNodeEl.removeEventListener("click", this.onHighlightNodeClick);
  },

  destroy: function() {
    TargetNodeHighlighter.unhighlight().catch(e => console.error(e));

    this.stopListeners();

    this.el.remove();
    this.el = this.tagNameEl = this.idEl = this.classEl = null;
    this.highlightNodeEl = this.previewEl = null;
    this.nodeFront = this.inspector = this.playerFront = null;
  },

  get highlighterUtils() {
    if (this.inspector && this.inspector.toolbox) {
      return this.inspector.toolbox.highlighterUtils;
    }
    return null;
  },

  onPreviewMouseOver: function() {
    if (!this.nodeFront || !this.highlighterUtils) {
      return;
    }
    this.highlighterUtils.highlightNodeFront(this.nodeFront)
                         .catch(e => console.error(e));
  },

  onPreviewMouseOut: function() {
    if (!this.nodeFront || !this.highlighterUtils) {
      return;
    }
    this.highlighterUtils.unhighlight()
                         .catch(e => console.error(e));
  },

  onSelectNodeClick: function() {
    if (!this.nodeFront) {
      return;
    }
    this.inspector.selection.setNodeFront(this.nodeFront, "animationinspector");
  },

  onHighlightNodeClick: function() {
    let classList = this.highlightNodeEl.classList;

    let isHighlighted = classList.contains("selected");
    if (isHighlighted) {
      classList.remove("selected");
      TargetNodeHighlighter.unhighlight().then(() => {
        this.emit("target-highlighter-unlocked");
      }, e => console.error(e));
    } else {
      classList.add("selected");
      TargetNodeHighlighter.highlight(this).then(() => {
        this.emit("target-highlighter-locked");
      }, e => console.error(e));
    }
  },

  onTargetHighlighterLocked: function(e, animationTargetNode) {
    if (animationTargetNode !== this) {
      this.highlightNodeEl.classList.remove("selected");
    }
  },

  onMarkupMutations: function(e, mutations) {
    if (!this.nodeFront || !this.playerFront) {
      return;
    }

    for (let {target} of mutations) {
      if (target === this.nodeFront) {
        // Re-render with the same nodeFront to update the output.
        this.render(this.playerFront);
        break;
      }
    }
  },

  render: Task.async(function*(playerFront) {
    this.playerFront = playerFront;
    this.nodeFront = undefined;

    try {
      this.nodeFront = yield this.inspector.walker.getNodeFromActor(
                             playerFront.actorID, ["node"]);
    } catch (e) {
      if (!this.el) {
        // The panel was destroyed in the meantime. Just log a warning.
        console.warn("Cound't retrieve the animation target node, widget " +
                     "destroyed");
      } else {
        // This was an unexpected error, log it.
        console.error(e);
      }
      return;
    }

    if (!this.nodeFront || !this.el) {
      return;
    }

    let {tagName, attributes} = this.nodeFront;

    this.tagNameEl.textContent = tagName.toLowerCase();

    let idIndex = attributes.findIndex(({name}) => name === "id");
    if (idIndex > -1 && attributes[idIndex].value) {
      this.idEl.querySelector(".attribute-value").textContent =
        attributes[idIndex].value;
      this.idEl.style.display = "inline";
    } else {
      this.idEl.style.display = "none";
    }

    let classIndex = attributes.findIndex(({name}) => name === "class");
    if (classIndex > -1 && attributes[classIndex].value) {
      let value = attributes[classIndex].value;
      if (this.options.compact) {
        value = value.split(" ").join(".");
      }

      this.classEl.querySelector(".attribute-value").textContent = value;
      this.classEl.style.display = "inline";
    } else {
      this.classEl.style.display = "none";
    }

    this.emit("target-retrieved");
  })
};

/**
 * UI component responsible for displaying a playback rate selector UI.
 * The rendering logic is such that a predefined list of rates is generated.
 * If *all* animations passed to render share the same rate, then that rate is
 * selected in the <select> element, otherwise, the empty value is selected.
 * If the rate that all animations share isn't part of the list of predefined
 * rates, than that rate is added to the list.
 */
function RateSelector() {
  this.onRateChanged = this.onRateChanged.bind(this);
  EventEmitter.decorate(this);
}

exports.RateSelector = RateSelector;

RateSelector.prototype = {
  init: function(containerEl) {
    this.selectEl = createNode({
      parent: containerEl,
      nodeType: "select",
      attributes: {"class": "devtools-button"}
    });

    this.selectEl.addEventListener("change", this.onRateChanged);
  },

  destroy: function() {
    this.selectEl.removeEventListener("change", this.onRateChanged);
    this.selectEl.remove();
    this.selectEl = null;
  },

  getAnimationsRates: function(animations) {
    return sortedUnique(animations.map(a => a.state.playbackRate));
  },

  getAllRates: function(animations) {
    let animationsRates = this.getAnimationsRates(animations);
    if (animationsRates.length > 1) {
      return PLAYBACK_RATES;
    }

    return sortedUnique(PLAYBACK_RATES.concat(animationsRates));
  },

  render: function(animations) {
    let allRates = this.getAnimationsRates(animations);
    let hasOneRate = allRates.length === 1;

    this.selectEl.innerHTML = "";

    if (!hasOneRate) {
      // When the animations displayed have mixed playback rates, we can't
      // select any of the predefined ones, instead, insert an empty rate.
      createNode({
        parent: this.selectEl,
        nodeType: "option",
        attributes: {value: "", selector: "true"},
        textContent: "-"
      });
    }
    for (let rate of this.getAllRates(animations)) {
      let option = createNode({
        parent: this.selectEl,
        nodeType: "option",
        attributes: {value: rate},
        textContent: L10N.getFormatStr("player.playbackRateLabel", rate)
      });

      // If there's only one rate and this is the option for it, select it.
      if (hasOneRate && rate === allRates[0]) {
        option.setAttribute("selected", "true");
      }
    }
  },

  onRateChanged: function() {
    let rate = parseFloat(this.selectEl.value);
    if (!isNaN(rate)) {
      this.emit("rate-changed", rate);
    }
  }
};

/**
 * The TimeScale helper object is used to know which size should something be
 * displayed with in the animation panel, depending on the animations that are
 * currently displayed.
 * If there are 5 animations displayed, and the first one starts at 10000ms and
 * the last one ends at 20000ms, then this helper can be used to convert any
 * time in this range to a distance in pixels.
 *
 * For the helper to know how to convert, it needs to know all the animations.
 * Whenever a new animation is added to the panel, addAnimation(state) should be
 * called. reset() can be called to start over.
 */
var TimeScale = {
  minStartTime: Infinity,
  maxEndTime: 0,

  /**
   * Add a new animation to time scale.
   * @param {Object} state A PlayerFront.state object.
   */
  addAnimation: function(state) {
    let {previousStartTime, delay, duration,
         iterationCount, playbackRate} = state;

    // Negative-delayed animations have their startTimes set such that we would
    // be displaying the delay outside the time window if we didn't take it into
    // account here.
    let relevantDelay = delay < 0 ? delay / playbackRate : 0;
    previousStartTime = previousStartTime || 0;

    this.minStartTime = Math.min(this.minStartTime,
                                 previousStartTime + relevantDelay);
    let length = (delay / playbackRate) +
                 ((duration / playbackRate) *
                  (!iterationCount ? 1 : iterationCount));
    this.maxEndTime = Math.max(this.maxEndTime, previousStartTime + length);
  },

  /**
   * Reset the current time scale.
   */
  reset: function() {
    this.minStartTime = Infinity;
    this.maxEndTime = 0;
  },

  /**
   * Convert a startTime to a distance in %, in the current time scale.
   * @param {Number} time
   * @return {Number}
   */
  startTimeToDistance: function(time) {
    time -= this.minStartTime;
    return this.durationToDistance(time);
  },

  /**
   * Convert a duration to a distance in %, in the current time scale.
   * @param {Number} time
   * @return {Number}
   */
  durationToDistance: function(duration) {
    return duration * 100 / (this.maxEndTime - this.minStartTime);
  },

  /**
   * Convert a distance in % to a time, in the current time scale.
   * @param {Number} distance
   * @return {Number}
   */
  distanceToTime: function(distance) {
    return this.minStartTime +
      ((this.maxEndTime - this.minStartTime) * distance / 100);
  },

  /**
   * Convert a distance in % to a time, in the current time scale.
   * The time will be relative to the current minimum start time.
   * @param {Number} distance
   * @return {Number}
   */
  distanceToRelativeTime: function(distance) {
    let time = this.distanceToTime(distance);
    return time - this.minStartTime;
  },

  /**
   * Depending on the time scale, format the given time as milliseconds or
   * seconds.
   * @param {Number} time
   * @return {String} The formatted time string.
   */
  formatTime: function(time) {
    let duration = this.maxEndTime - this.minStartTime;

    // Format in milliseconds if the total duration is short enough.
    if (duration <= MILLIS_TIME_FORMAT_MAX_DURATION) {
      return L10N.getFormatStr("timeline.timeGraduationLabel", time.toFixed(0));
    }

    // Otherwise format in seconds.
    return L10N.getFormatStr("player.timeLabel", (time / 1000).toFixed(1));
  }
};

exports.TimeScale = TimeScale;

/**
 * UI component responsible for displaying a timeline for animations.
 * The timeline is essentially a graph with time along the x axis and animations
 * along the y axis.
 * The time is represented with a graduation header at the top and a current
 * time play head.
 * Animations are organized by lines, with a left margin containing the preview
 * of the target DOM element the animation applies to.
 * The current time play head can be moved by clicking/dragging in the header.
 * when this happens, the component emits "current-data-changed" events with the
 * new time and state of the timeline.
 *
 * @param {InspectorPanel} inspector.
 */
function AnimationsTimeline(inspector) {
  this.animations = [];
  this.targetNodes = [];
  this.timeBlocks = [];
  this.inspector = inspector;

  this.onAnimationStateChanged = this.onAnimationStateChanged.bind(this);
  this.onScrubberMouseDown = this.onScrubberMouseDown.bind(this);
  this.onScrubberMouseUp = this.onScrubberMouseUp.bind(this);
  this.onScrubberMouseOut = this.onScrubberMouseOut.bind(this);
  this.onScrubberMouseMove = this.onScrubberMouseMove.bind(this);
  this.onAnimationSelected = this.onAnimationSelected.bind(this);
  this.onWindowResize = this.onWindowResize.bind(this);

  EventEmitter.decorate(this);
}

exports.AnimationsTimeline = AnimationsTimeline;

AnimationsTimeline.prototype = {
  init: function(containerEl) {
    this.win = containerEl.ownerDocument.defaultView;

    this.rootWrapperEl = createNode({
      parent: containerEl,
      attributes: {
        "class": "animation-timeline"
      }
    });

    let scrubberContainer = createNode({
      parent: this.rootWrapperEl,
      attributes: {"class": "scrubber-wrapper"}
    });

    this.scrubberEl = createNode({
      parent: scrubberContainer,
      attributes: {
        "class": "scrubber"
      }
    });

    this.scrubberHandleEl = createNode({
      parent: this.scrubberEl,
      attributes: {
        "class": "scrubber-handle"
      }
    });
    this.scrubberHandleEl.addEventListener("mousedown", this.onScrubberMouseDown);

    this.timeHeaderEl = createNode({
      parent: this.rootWrapperEl,
      attributes: {
        "class": "time-header"
      }
    });
    this.timeHeaderEl.addEventListener("mousedown", this.onScrubberMouseDown);

    this.animationsEl = createNode({
      parent: this.rootWrapperEl,
      nodeType: "ul",
      attributes: {
        "class": "animations"
      }
    });

    this.win.addEventListener("resize", this.onWindowResize);
  },

  destroy: function() {
    this.stopAnimatingScrubber();
    this.unrender();

    this.win.removeEventListener("resize", this.onWindowResize);
    this.timeHeaderEl.removeEventListener("mousedown",
      this.onScrubberMouseDown);
    this.scrubberHandleEl.removeEventListener("mousedown",
      this.onScrubberMouseDown);

    this.rootWrapperEl.remove();
    this.animations = [];

    this.rootWrapperEl = null;
    this.timeHeaderEl = null;
    this.animationsEl = null;
    this.scrubberEl = null;
    this.scrubberHandleEl = null;
    this.win = null;
    this.inspector = null;
  },

  destroyTargetNodes: function() {
    for (let targetNode of this.targetNodes) {
      targetNode.destroy();
    }
    this.targetNodes = [];
  },

  destroyTimeBlocks: function() {
    for (let timeBlock of this.timeBlocks) {
      timeBlock.off("selected", this.onAnimationSelected);
      timeBlock.destroy();
    }
    this.timeBlocks = [];
  },

  unrender: function() {
    for (let animation of this.animations) {
      animation.off("changed", this.onAnimationStateChanged);
    }
    TimeScale.reset();
    this.destroyTargetNodes();
    this.destroyTimeBlocks();
    this.animationsEl.innerHTML = "";
  },

  onWindowResize: function() {
    if (this.windowResizeTimer) {
      this.win.clearTimeout(this.windowResizeTimer);
    }

    this.windowResizeTimer = this.win.setTimeout(() => {
      this.drawHeaderAndBackground();
    }, TIMELINE_BACKGROUND_RESIZE_DEBOUNCE_TIMER);
  },

  onAnimationSelected: function(e, animation) {
    // Unselect the previously selected animation if any.
    [...this.rootWrapperEl.querySelectorAll(".animation.selected")].forEach(el => {
      el.classList.remove("selected");
    });

    // Select the new animation.
    let index = this.animations.indexOf(animation);
    if (index === -1) {
      return;
    }
    this.rootWrapperEl.querySelectorAll(".animation")[index]
                      .classList.toggle("selected");

    // Relay the event to the parent component.
    this.emit("selected", animation);
  },

  onScrubberMouseDown: function(e) {
    this.moveScrubberTo(e.pageX);
    this.win.addEventListener("mouseup", this.onScrubberMouseUp);
    this.win.addEventListener("mouseout", this.onScrubberMouseOut);
    this.win.addEventListener("mousemove", this.onScrubberMouseMove);

    // Prevent text selection while dragging.
    e.preventDefault();
  },

  onScrubberMouseUp: function() {
    this.cancelTimeHeaderDragging();
  },

  onScrubberMouseOut: function(e) {
    // Check that mouseout happened on the window itself, and if yes, cancel
    // the dragging.
    if (!this.win.document.contains(e.relatedTarget)) {
      this.cancelTimeHeaderDragging();
    }
  },

  cancelTimeHeaderDragging: function() {
    this.win.removeEventListener("mouseup", this.onScrubberMouseUp);
    this.win.removeEventListener("mouseout", this.onScrubberMouseOut);
    this.win.removeEventListener("mousemove", this.onScrubberMouseMove);
  },

  onScrubberMouseMove: function(e) {
    this.moveScrubberTo(e.pageX);
  },

  moveScrubberTo: function(pageX) {
    this.stopAnimatingScrubber();

    // The offset needs to be in % and relative to the timeline's area (so we
    // subtract the scrubber's left offset, which is equal to the sidebar's
    // width).
    let offset = (pageX - this.timeHeaderEl.offsetLeft) * 100 /
                 this.timeHeaderEl.offsetWidth;
    if (offset < 0) {
      offset = 0;
    }

    this.scrubberEl.style.left = offset + "%";

    let time = TimeScale.distanceToRelativeTime(offset);

    this.emit("timeline-data-changed", {
      isPaused: true,
      isMoving: false,
      isUserDrag: true,
      time: time
    });
  },

  render: function(animations, documentCurrentTime) {
    this.unrender();

    this.animations = animations;
    if (!this.animations.length) {
      return;
    }

    // Loop first to set the time scale for all current animations.
    for (let {state} of animations) {
      TimeScale.addAnimation(state);
    }

    this.drawHeaderAndBackground();

    for (let animation of this.animations) {
      animation.on("changed", this.onAnimationStateChanged);

      // Each line contains the target animated node and the animation time
      // block.
      let animationEl = createNode({
        parent: this.animationsEl,
        nodeType: "li",
        attributes: {
          "class": "animation" + (animation.state.isRunningOnCompositor
                                  ? " fast-track"
                                  : "")
        }
      });

      // Left sidebar for the animated node.
      let animatedNodeEl = createNode({
        parent: animationEl,
        attributes: {
          "class": "target"
        }
      });
      // Draw the animated node target.
      let targetNode = new AnimationTargetNode(this.inspector, {compact: true});
      targetNode.init(animatedNodeEl);
      targetNode.render(animation);
      this.targetNodes.push(targetNode);

      // Right-hand part contains the timeline itself (called time-block here).
      let timeBlockEl = createNode({
        parent: animationEl,
        attributes: {
          "class": "time-block"
        }
      });
      // Draw the animation time block.
      let timeBlock = new AnimationTimeBlock();
      timeBlock.init(timeBlockEl);
      timeBlock.render(animation);
      this.timeBlocks.push(timeBlock);

      timeBlock.on("selected", this.onAnimationSelected);
    }
    // Use the document's current time to position the scrubber (if the server
    // doesn't provide it, hide the scrubber entirely).
    // Note that because the currentTime was sent via the protocol, some time
    // may have gone by since then, and so the scrubber might be a bit late.
    if (!documentCurrentTime) {
      this.scrubberEl.style.display = "none";
    } else {
      this.scrubberEl.style.display = "block";
      this.startAnimatingScrubber(this.wasRewound()
                                  ? TimeScale.minStartTime
                                  : documentCurrentTime);
    }
  },

  isAtLeastOneAnimationPlaying: function() {
    return this.animations.some(({state}) => state.playState === "running");
  },

  wasRewound: function() {
    return !this.isAtLeastOneAnimationPlaying() &&
           this.animations.every(({state}) => state.currentTime === 0);
  },

  hasInfiniteAnimations: function() {
    return this.animations.some(({state}) => !state.iterationCount);
  },

  startAnimatingScrubber: function(time) {
    let x = TimeScale.startTimeToDistance(time);
    this.scrubberEl.style.left = x + "%";

    // Only stop the scrubber if it's out of bounds or all animations have been
    // paused, but not if at least an animation is infinite.
    let isOutOfBounds = time < TimeScale.minStartTime ||
                        time > TimeScale.maxEndTime;
    let isAllPaused = !this.isAtLeastOneAnimationPlaying();
    let hasInfinite = this.hasInfiniteAnimations();

    if (isAllPaused || (isOutOfBounds && !hasInfinite)) {
      this.stopAnimatingScrubber();
      this.emit("timeline-data-changed", {
        isPaused: !this.isAtLeastOneAnimationPlaying(),
        isMoving: false,
        isUserDrag: false,
        time: TimeScale.distanceToRelativeTime(x)
      });
      return;
    }

    this.emit("timeline-data-changed", {
      isPaused: false,
      isMoving: true,
      isUserDrag: false,
      time: TimeScale.distanceToRelativeTime(x)
    });

    let now = this.win.performance.now();
    this.rafID = this.win.requestAnimationFrame(() => {
      if (!this.rafID) {
        // In case the scrubber was stopped in the meantime.
        return;
      }
      this.startAnimatingScrubber(time + this.win.performance.now() - now);
    });
  },

  stopAnimatingScrubber: function() {
    if (this.rafID) {
      this.win.cancelAnimationFrame(this.rafID);
      this.rafID = null;
    }
  },

  onAnimationStateChanged: function() {
    // For now, simply re-render the component. The animation front's state has
    // already been updated.
    this.render(this.animations);
  },

  drawHeaderAndBackground: function() {
    let width = this.timeHeaderEl.offsetWidth;
    let scale = width / (TimeScale.maxEndTime - TimeScale.minStartTime);
    drawGraphElementBackground(this.win.document, "time-graduations",
                               width, scale);

    // And the time graduation header.
    this.timeHeaderEl.innerHTML = "";
    let interval = findOptimalTimeInterval(scale, TIME_GRADUATION_MIN_SPACING);
    for (let i = 0; i < width; i += interval) {
      let pos = 100 * i / width;
      createNode({
        parent: this.timeHeaderEl,
        nodeType: "span",
        attributes: {
          "class": "time-tick",
          "style": `left:${pos}%`
        },
        textContent: TimeScale.formatTime(TimeScale.distanceToRelativeTime(pos))
      });
    }
  }
};

/**
 * UI component responsible for displaying a single animation timeline, which
 * basically looks like a rectangle that shows the delay and iterations.
 */
function AnimationTimeBlock() {
  EventEmitter.decorate(this);
  this.onClick = this.onClick.bind(this);
}

exports.AnimationTimeBlock = AnimationTimeBlock;

AnimationTimeBlock.prototype = {
  init: function(containerEl) {
    this.containerEl = containerEl;
    this.containerEl.addEventListener("click", this.onClick);
  },

  destroy: function() {
    this.containerEl.removeEventListener("click", this.onClick);
    while (this.containerEl.firstChild) {
      this.containerEl.firstChild.remove();
    }
    this.containerEl = null;
    this.animation = null;
  },

  render: function(animation) {
    this.animation = animation;
    let {state} = this.animation;

    // Create a container element to hold the delay and iterations.
    // It is positioned according to its delay (divided by the playbackrate),
    // and its width is according to its duration (divided by the playbackrate).
    let start = state.previousStartTime || 0;
    let duration = state.duration;
    let rate = state.playbackRate;
    let count = state.iterationCount;
    let delay = state.delay || 0;

    let x = TimeScale.startTimeToDistance(start + (delay / rate));
    let w = TimeScale.durationToDistance(duration / rate);
    let iterationW = w * (count || 1);
    let delayW = TimeScale.durationToDistance(Math.abs(delay) / rate);

    let iterations = createNode({
      parent: this.containerEl,
      attributes: {
        "class": state.type + " iterations" + (count ? "" : " infinite"),
        // Individual iterations are represented by setting the size of the
        // repeating linear-gradient.
        "style": `left:${x}%;
                  width:${iterationW}%;
                  background-size:${100 / (count || 1)}% 100%;`
      }
    });

    // The animation name is displayed over the iterations.
    // Note that in case of negative delay, we push the name towards the right
    // so the delay can be shown.
    let negativeDelayW = delay < 0 ? delayW : 0;
    createNode({
      parent: iterations,
      attributes: {
        "class": "name",
        "title": this.getTooltipText(state),
        // Make space for the negative delay with a margin-left.
        "style": `margin-left:${negativeDelayW}%`
      },
      textContent: state.name
    });

    // Delay.
    if (delay) {
      // Negative delays need to start at 0.
      let delayX = TimeScale.durationToDistance((delay < 0 ? 0 : delay) / rate);
      createNode({
        parent: iterations,
        attributes: {
          "class": "delay" + (delay < 0 ? " negative" : ""),
          "style": `left:-${delayX}%;
                    width:${delayW}%;`
        }
      });
    }
  },

  getTooltipText: function(state) {
    let getTime = time => L10N.getFormatStr("player.timeLabel",
                            L10N.numberWithDecimals(time / 1000, 2));

    let text = "";

    // Adding the name (the type isn't always available, older servers don't
    // send it).
    text +=
      state.type
      ? L10N.getFormatStr("timeline." + state.type + ".nameLabel", state.name)
      : state.name;
    text += "\n";

    // Adding the delay.
    text += L10N.getStr("player.animationDelayLabel") + " ";
    text += getTime(state.delay);
    text += "\n";

    // Adding the duration.
    text += L10N.getStr("player.animationDurationLabel") + " ";
    text += getTime(state.duration);
    text += "\n";

    // Adding the iteration count (the infinite symbol, or an integer).
    // XXX: see bug 1219608 to remove this if the count is 1.
    text += L10N.getStr("player.animationIterationCountLabel") + " ";
    text += state.iterationCount ||
            L10N.getStr("player.infiniteIterationCountText");
    text += "\n";

    // Adding the playback rate if it's different than 1.
    if (state.playbackRate !== 1) {
      text += L10N.getStr("player.animationRateLabel") + " ";
      text += state.playbackRate;
      text += "\n";
    }

    // Adding a note that the animation is running on the compositor thread if
    // needed.
    if (state.isRunningOnCompositor) {
      text += L10N.getStr("player.runningOnCompositorTooltip");
    }

    return text;
  },

  onClick: function() {
    this.emit("selected", this.animation);
  }
};

let sortedUnique = arr => [...new Set(arr)].sort((a, b) => a > b);
