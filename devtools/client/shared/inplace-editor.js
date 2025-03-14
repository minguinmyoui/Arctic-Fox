/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Basic use:
 * let spanToEdit = document.getElementById("somespan");
 *
 * editableField({
 *   element: spanToEdit,
 *   done: function(value, commit, direction) {
 *     if (commit) {
 *       spanToEdit.textContent = value;
 *     }
 *   },
 *   trigger: "dblclick"
 * });
 *
 * See editableField() for more options.
 */

"use strict";

const {Ci, Cu, Cc} = require("chrome");

const HTML_NS = "http://www.w3.org/1999/xhtml";
const CONTENT_TYPES = {
  PLAIN_TEXT: 0,
  CSS_VALUE: 1,
  CSS_MIXED: 2,
  CSS_PROPERTY: 3,
};
const MAX_POPUP_ENTRIES = 10;

const FOCUS_FORWARD = Ci.nsIFocusManager.MOVEFOCUS_FORWARD;
const FOCUS_BACKWARD = Ci.nsIFocusManager.MOVEFOCUS_BACKWARD;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://devtools/shared/event-emitter.js");

/**
 * Mark a span editable.  |editableField| will listen for the span to
 * be focused and create an InlineEditor to handle text input.
 * Changes will be committed when the InlineEditor's input is blurred
 * or dropped when the user presses escape.
 *
 * @param {Object} options
 *    Options for the editable field, including:
 *    {Element} element:
 *      (required) The span to be edited on focus.
 *    {Function} canEdit:
 *       Will be called before creating the inplace editor.  Editor
 *       won't be created if canEdit returns false.
 *    {Function} start:
 *       Will be called when the inplace editor is initialized.
 *    {Function} change:
 *       Will be called when the text input changes.  Will be called
 *       with the current value of the text input.
 *    {Function} done:
 *       Called when input is committed or blurred.  Called with
 *       current value, a boolean telling the caller whether to
 *       commit the change, and the direction of the next element to be
 *       selected. Direction may be one of nsIFocusManager.MOVEFOCUS_FORWARD,
 *       nsIFocusManager.MOVEFOCUS_BACKWARD, or null (no movement).
 *       This function is called before the editor has been torn down.
 *    {Function} destroy:
 *       Called when the editor is destroyed and has been torn down.
 *    {Object} advanceChars:
 *       This can be either a string or a function.
 *       If it is a string, then if any characters in it are typed,
 *       focus will advance to the next element.
 *       Otherwise, if it is a function, then the function will
 *       be called with three arguments: a key code, the current text,
 *       and the insertion point.  If the function returns true,
 *       then the focus advance takes place.  If it returns false,
 *       then the character is inserted instead.
 *    {Boolean} stopOnReturn:
 *       If true, the return key will not advance the editor to the next
 *       focusable element.
 *    {Boolean} stopOnTab:
 *       If true, the tab key will not advance the editor to the next
 *       focusable element.
 *    {Boolean} stopOnShiftTab:
 *       If true, shift tab will not advance the editor to the previous
 *       focusable element.
 *    {String} trigger: The DOM event that should trigger editing,
 *      defaults to "click"
 *    {Boolean} multiline: Should the editor be a multiline textarea?
 *      defaults to false
 *    {Boolean} trimOutput: Should the returned string be trimmed?
 *      defaults to true
 */
function editableField(options) {
  return editableItem(options, function(element, event) {
    if (!options.element.inplaceEditor) {
      new InplaceEditor(options, event);
    }
  });
}

exports.editableField = editableField;

/**
 * Handle events for an element that should respond to
 * clicks and sit in the editing tab order, and call
 * a callback when it is activated.
 *
 * @param {Object} options
 *    The options for this editor, including:
 *    {Element} element: The DOM element.
 *    {String} trigger: The DOM event that should trigger editing,
 *      defaults to "click"
 * @param {Function} callback
 *        Called when the editor is activated.
 * @return {Function} function which calls callback
 */
function editableItem(options, callback) {
  let trigger = options.trigger || "click";
  let element = options.element;
  element.addEventListener(trigger, function(evt) {
    if (evt.target.nodeName !== "a") {
      let win = this.ownerDocument.defaultView;
      let selection = win.getSelection();
      if (trigger != "click" || selection.isCollapsed) {
        callback(element, evt);
      }
      evt.stopPropagation();
    }
  }, false);

  // If focused by means other than a click, start editing by
  // pressing enter or space.
  element.addEventListener("keypress", function(evt) {
    if (evt.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN ||
        evt.charCode === Ci.nsIDOMKeyEvent.DOM_VK_SPACE) {
      callback(element);
    }
  }, true);

  // Ugly workaround - the element is focused on mousedown but
  // the editor is activated on click/mouseup.  This leads
  // to an ugly flash of the focus ring before showing the editor.
  // So hide the focus ring while the mouse is down.
  element.addEventListener("mousedown", function(evt) {
    if (evt.target.nodeName !== "a") {
      let cleanup = function() {
        element.style.removeProperty("outline-style");
        element.removeEventListener("mouseup", cleanup, false);
        element.removeEventListener("mouseout", cleanup, false);
      };
      element.style.setProperty("outline-style", "none");
      element.addEventListener("mouseup", cleanup, false);
      element.addEventListener("mouseout", cleanup, false);
    }
  }, false);

  // Mark the element editable field for tab
  // navigation while editing.
  element._editable = true;

  // Save the trigger type so we can dispatch this later
  element._trigger = trigger;

  return function turnOnEditMode() {
    callback(element);
  };
}

exports.editableItem = this.editableItem;

/*
 * Various API consumers (especially tests) sometimes want to grab the
 * inplaceEditor expando off span elements. However, when each global has its
 * own compartment, those expandos live on Xray wrappers that are only visible
 * within this JSM. So we provide a little workaround here.
 */

function getInplaceEditorForSpan(span) {
  return span.inplaceEditor;
}

exports.getInplaceEditorForSpan = getInplaceEditorForSpan;

function InplaceEditor(options, event) {
  this.elt = options.element;
  let doc = this.elt.ownerDocument;
  this.doc = doc;
  this.elt.inplaceEditor = this;

  this.change = options.change;
  this.done = options.done;
  this.destroy = options.destroy;
  this.initial = options.initial ? options.initial : this.elt.textContent;
  this.multiline = options.multiline || false;
  this.trimOutput = options.trimOutput === undefined
                    ? true
                    : !!options.trimOutput;
  this.stopOnShiftTab = !!options.stopOnShiftTab;
  this.stopOnTab = !!options.stopOnTab;
  this.stopOnReturn = !!options.stopOnReturn;
  this.contentType = options.contentType || CONTENT_TYPES.PLAIN_TEXT;
  this.property = options.property;
  this.popup = options.popup;

  this._onBlur = this._onBlur.bind(this);
  this._onKeyPress = this._onKeyPress.bind(this);
  this._onInput = this._onInput.bind(this);
  this._onKeyup = this._onKeyup.bind(this);

  this._createInput();
  this._autosize();
  this.inputCharWidth = this._getInputCharWidth();

  // Pull out character codes for advanceChars, listing the
  // characters that should trigger a blur.
  if (typeof options.advanceChars === "function") {
    this._advanceChars = options.advanceChars;
  } else {
    let advanceCharcodes = {};
    let advanceChars = options.advanceChars || "";
    for (let i = 0; i < advanceChars.length; i++) {
      advanceCharcodes[advanceChars.charCodeAt(i)] = true;
    }
    this._advanceChars = aCharCode => aCharCode in advanceCharcodes;
  }

  // Hide the provided element and add our editor.
  this.originalDisplay = this.elt.style.display;
  this.elt.style.display = "none";
  this.elt.parentNode.insertBefore(this.input, this.elt);

  this.input.focus();

  if (typeof options.selectAll == "undefined" || options.selectAll) {
    this.input.select();
  }

  if (this.contentType == CONTENT_TYPES.CSS_VALUE && this.input.value == "") {
    this._maybeSuggestCompletion(true);
  }

  this.input.addEventListener("blur", this._onBlur, false);
  this.input.addEventListener("keypress", this._onKeyPress, false);
  this.input.addEventListener("input", this._onInput, false);

  this.input.addEventListener("dblclick",
    (e) => { e.stopPropagation(); }, false);
  this.input.addEventListener("mousedown",
    (e) => { e.stopPropagation(); }, false);

  this.validate = options.validate;

  if (this.validate) {
    this.input.addEventListener("keyup", this._onKeyup, false);
  }

  this._updateSize();

  if (options.start) {
    options.start(this, event);
  }

  EventEmitter.decorate(this);
}

exports.InplaceEditor = InplaceEditor;

InplaceEditor.CONTENT_TYPES = CONTENT_TYPES;

InplaceEditor.prototype = {

  get currentInputValue() {
    let val = this.trimOutput ? this.input.value.trim() : this.input.value;
    return val;
  },

  _createInput: function() {
    this.input =
      this.doc.createElementNS(HTML_NS, this.multiline ? "textarea" : "input");
    this.input.inplaceEditor = this;
    this.input.classList.add("styleinspector-propertyeditor");
    this.input.value = this.initial;

    copyTextStyles(this.elt, this.input);
  },

  /**
   * Get rid of the editor.
   */
  _clear: function() {
    if (!this.input) {
      // Already cleared.
      return;
    }

    this.input.removeEventListener("blur", this._onBlur, false);
    this.input.removeEventListener("keypress", this._onKeyPress, false);
    this.input.removeEventListener("keyup", this._onKeyup, false);
    this.input.removeEventListener("oninput", this._onInput, false);
    this._stopAutosize();

    this.elt.style.display = this.originalDisplay;

    if (this.doc.activeElement == this.input) {
      this.elt.focus();
    }

    this.input.remove();
    this.input = null;

    delete this.elt.inplaceEditor;
    delete this.elt;

    if (this.destroy) {
      this.destroy();
    }
  },

  /**
   * Keeps the editor close to the size of its input string.  This is pretty
   * crappy, suggestions for improvement welcome.
   */
  _autosize: function() {
    // Create a hidden, absolutely-positioned span to measure the text
    // in the input.  Boo.

    // We can't just measure the original element because a) we don't
    // change the underlying element's text ourselves (we leave that
    // up to the client), and b) without tweaking the style of the
    // original element, it might wrap differently or something.
    this._measurement =
      this.doc.createElementNS(HTML_NS, this.multiline ? "pre" : "span");
    this._measurement.className = "autosizer";
    this.elt.parentNode.appendChild(this._measurement);
    let style = this._measurement.style;
    style.visibility = "hidden";
    style.position = "absolute";
    style.top = "0";
    style.left = "0";
    copyTextStyles(this.input, this._measurement);
    this._updateSize();
  },

  /**
   * Clean up the mess created by _autosize().
   */
  _stopAutosize: function() {
    if (!this._measurement) {
      return;
    }
    this._measurement.remove();
    delete this._measurement;
  },

  /**
   * Size the editor to fit its current contents.
   */
  _updateSize: function() {
    // Replace spaces with non-breaking spaces.  Otherwise setting
    // the span's textContent will collapse spaces and the measurement
    // will be wrong.
    this._measurement.textContent = this.input.value.replace(/ /g, "\u00a0");

    // We add a bit of padding to the end.  Should be enough to fit
    // any letter that could be typed, otherwise we'll scroll before
    // we get a chance to resize.  Yuck.
    let width = this._measurement.offsetWidth + 10;

    if (this.multiline) {
      // Make sure there's some content in the current line.  This is a hack to
      // account for the fact that after adding a newline the <pre> doesn't grow
      // unless there's text content on the line.
      width += 15;
      this.input.style.height = this._measurement.offsetHeight + "px";
    }

    this.input.style.width = width + "px";
  },

  /**
   * Get the width of a single character in the input to properly position the
   * autocompletion popup.
   */
  _getInputCharWidth: function() {
    // Just make the text content to be 'x' to get the width of any character in
    // a monospace font.
    this._measurement.textContent = "x";
    return this._measurement.offsetWidth;
  },

   /**
   * Increment property values in rule view.
   *
   * @param {Number} increment
   *        The amount to increase/decrease the property value.
   * @return {Boolean} true if value has been incremented.
   */
  _incrementValue: function(increment) {
    let value = this.input.value;
    let selectionStart = this.input.selectionStart;
    let selectionEnd = this.input.selectionEnd;

    let newValue = this._incrementCSSValue(value, increment, selectionStart,
                                           selectionEnd);

    if (!newValue) {
      return false;
    }

    this.input.value = newValue.value;
    this.input.setSelectionRange(newValue.start, newValue.end);
    this._doValidation();

    // Call the user's change handler if available.
    if (this.change) {
      this.change(this.currentInputValue);
    }

    return true;
  },

  /**
   * Increment the property value based on the property type.
   *
   * @param {String} value
   *        Property value.
   * @param {Number} increment
   *        Amount to increase/decrease the property value.
   * @param {Number} selStart
   *        Starting index of the value.
   * @param {Number} selEnd
   *        Ending index of the value.
   * @return {Object} object with properties 'value', 'start', and 'end'.
   */
  _incrementCSSValue: function(value, increment, selStart, selEnd) {
    let range = this._parseCSSValue(value, selStart);
    let type = (range && range.type) || "";
    let rawValue = (range ? value.substring(range.start, range.end) : "");
    let incrementedValue = null, selection;

    if (type === "num") {
      let newValue = this._incrementRawValue(rawValue, increment);
      if (newValue !== null) {
        incrementedValue = newValue;
        selection = [0, incrementedValue.length];
      }
    } else if (type === "hex") {
      let exprOffset = selStart - range.start;
      let exprOffsetEnd = selEnd - range.start;
      let newValue = this._incHexColor(rawValue, increment, exprOffset,
                                       exprOffsetEnd);
      if (newValue) {
        incrementedValue = newValue.value;
        selection = newValue.selection;
      }
    } else {
      let info;
      if (type === "rgb" || type === "hsl") {
        info = {};
        let part = value.substring(range.start, selStart).split(",").length - 1;
        if (part === 3) { // alpha
          info.minValue = 0;
          info.maxValue = 1;
        } else if (type === "rgb") {
          info.minValue = 0;
          info.maxValue = 255;
        } else if (part !== 0) { // hsl percentage
          info.minValue = 0;
          info.maxValue = 100;

          // select the previous number if the selection is at the end of a
          // percentage sign.
          if (value.charAt(selStart - 1) === "%") {
            --selStart;
          }
        }
      }
      return this._incrementGenericValue(value, increment, selStart, selEnd,
                                         info);
    }

    if (incrementedValue === null) {
      return null;
    }

    let preRawValue = value.substr(0, range.start);
    let postRawValue = value.substr(range.end);

    return {
      value: preRawValue + incrementedValue + postRawValue,
      start: range.start + selection[0],
      end: range.start + selection[1]
    };
  },

  /**
   * Parses the property value and type.
   *
   * @param {String} value
   *        Property value.
   * @param {Number} offset
   *        Starting index of value.
   * @return {Object} object with properties 'value', 'start', 'end', and
   *         'type'.
   */
   _parseCSSValue: function(value, offset) {
    const reSplitCSS = /(url\("?[^"\)]+"?\)?)|(rgba?\([^)]*\)?)|(hsla?\([^)]*\)?)|(#[\dA-Fa-f]+)|(-?\d*\.?\d+(%|[a-z]{1,4})?)|"([^"]*)"?|'([^']*)'?|([^,\s\/!\(\)]+)|(!(.*)?)/;
    let start = 0;
    let m;

    // retreive values from left to right until we find the one at our offset
    while ((m = reSplitCSS.exec(value)) &&
          (m.index + m[0].length < offset)) {
      value = value.substr(m.index + m[0].length);
      start += m.index + m[0].length;
      offset -= m.index + m[0].length;
    }

    if (!m) {
      return null;
    }

    let type;
    if (m[1]) {
      type = "url";
    } else if (m[2]) {
      type = "rgb";
    } else if (m[3]) {
      type = "hsl";
    } else if (m[4]) {
      type = "hex";
    } else if (m[5]) {
      type = "num";
    }

    return {
      value: m[0],
      start: start + m.index,
      end: start + m.index + m[0].length,
      type: type
    };
  },

  /**
   * Increment the property value for types other than
   * number or hex, such as rgb, hsl, and file names.
   *
   * @param {String} value
   *        Property value.
   * @param {Number} increment
   *        Amount to increment/decrement.
   * @param {Number} offset
   *        Starting index of the property value.
   * @param {Number} offsetEnd
   *        Ending index of the property value.
   * @param {Object} info
   *        Object with details about the property value.
   * @return {Object} object with properties 'value', 'start', and 'end'.
   */
  _incrementGenericValue: function(value, increment, offset, offsetEnd, info) {
    // Try to find a number around the cursor to increment.
    let start, end;
    // Check if we are incrementing in a non-number context (such as a URL)
    if (/^-?[0-9.]/.test(value.substring(offset, offsetEnd)) &&
      !(/\d/.test(value.charAt(offset - 1) + value.charAt(offsetEnd)))) {
      // We have a number selected, possibly with a suffix, and we are not in
      // the disallowed case of just part of a known number being selected.
      // Use that number.
      start = offset;
      end = offsetEnd;
    } else {
      // Parse periods as belonging to the number only if we are in a known
      // number context. (This makes incrementing the 1 in 'image1.gif' work.)
      let pattern = "[" + (info ? "0-9." : "0-9") + "]*";
      let before = new RegExp(pattern + "$").exec(value.substr(0, offset))[0].length;
      let after = new RegExp("^" + pattern).exec(value.substr(offset))[0].length;

      start = offset - before;
      end = offset + after;

      // Expand the number to contain an initial minus sign if it seems
      // free-standing.
      if (value.charAt(start - 1) === "-" &&
         (start - 1 === 0 || /[ (:,='"]/.test(value.charAt(start - 2)))) {
        --start;
      }
    }

    if (start !== end) {
      // Include percentages as part of the incremented number (they are
      // common enough).
      if (value.charAt(end) === "%") {
        ++end;
      }

      let first = value.substr(0, start);
      let mid = value.substring(start, end);
      let last = value.substr(end);

      mid = this._incrementRawValue(mid, increment, info);

      if (mid !== null) {
        return {
          value: first + mid + last,
          start: start,
          end: start + mid.length
        };
      }
    }
  },

  /**
   * Increment the property value for numbers.
   *
   * @param {String} rawValue
   *        Raw value to increment.
   * @param {Number} increment
   *        Amount to increase/decrease the raw value.
   * @param {Object} info
   *        Object with info about the property value.
   * @return {String} the incremented value.
   */
  _incrementRawValue: function(rawValue, increment, info) {
    let num = parseFloat(rawValue);

    if (isNaN(num)) {
      return null;
    }

    let number = /\d+(\.\d+)?/.exec(rawValue);
    let units = rawValue.substr(number.index + number[0].length);

    // avoid rounding errors
    let newValue = Math.round((num + increment) * 1000) / 1000;

    if (info && "minValue" in info) {
      newValue = Math.max(newValue, info.minValue);
    }
    if (info && "maxValue" in info) {
      newValue = Math.min(newValue, info.maxValue);
    }

    newValue = newValue.toString();

    return newValue + units;
  },

  /**
   * Increment the property value for hex.
   *
   * @param {String} value
   *        Property value.
   * @param {Number} increment
   *        Amount to increase/decrease the property value.
   * @param {Number} offset
   *        Starting index of the property value.
   * @param {Number} offsetEnd
   *        Ending index of the property value.
   * @return {Object} object with properties 'value' and 'selection'.
   */
  _incHexColor: function(rawValue, increment, offset, offsetEnd) {
    // Return early if no part of the rawValue is selected.
    if (offsetEnd > rawValue.length && offset >= rawValue.length) {
      return null;
    }
    if (offset < 1 && offsetEnd <= 1) {
      return null;
    }
    // Ignore the leading #.
    rawValue = rawValue.substr(1);
    --offset;
    --offsetEnd;

    // Clamp the selection to within the actual value.
    offset = Math.max(offset, 0);
    offsetEnd = Math.min(offsetEnd, rawValue.length);
    offsetEnd = Math.max(offsetEnd, offset);

    // Normalize #ABC -> #AABBCC.
    if (rawValue.length === 3) {
      rawValue = rawValue.charAt(0) + rawValue.charAt(0) +
                 rawValue.charAt(1) + rawValue.charAt(1) +
                 rawValue.charAt(2) + rawValue.charAt(2);
      offset *= 2;
      offsetEnd *= 2;
    }

    if (rawValue.length !== 6) {
      return null;
    }

    // If no selection, increment an adjacent color, preferably one to the left.
    if (offset === offsetEnd) {
      if (offset === 0) {
        offsetEnd = 1;
      } else {
        offset = offsetEnd - 1;
      }
    }

    // Make the selection cover entire parts.
    offset -= offset % 2;
    offsetEnd += offsetEnd % 2;

    // Remap the increments from [0.1, 1, 10] to [1, 1, 16].
    if (increment > -1 && increment < 1) {
      increment = (increment < 0 ? -1 : 1);
    }
    if (Math.abs(increment) === 10) {
      increment = (increment < 0 ? -16 : 16);
    }

    let isUpper = (rawValue.toUpperCase() === rawValue);

    for (let pos = offset; pos < offsetEnd; pos += 2) {
      // Increment the part in [pos, pos+2).
      let mid = rawValue.substr(pos, 2);
      let value = parseInt(mid, 16);

      if (isNaN(value)) {
        return null;
      }

      mid = Math.min(Math.max(value + increment, 0), 255).toString(16);

      while (mid.length < 2) {
        mid = "0" + mid;
      }
      if (isUpper) {
        mid = mid.toUpperCase();
      }

      rawValue = rawValue.substr(0, pos) + mid + rawValue.substr(pos + 2);
    }

    return {
      value: "#" + rawValue,
      selection: [offset + 1, offsetEnd + 1]
    };
  },

  /**
   * Cycle through the autocompletion suggestions in the popup.
   *
   * @param {Boolean} reverse
   *        true to select previous item from the popup.
   * @param {Boolean} noSelect
   *        true to not select the text after selecting the newly selectedItem
   *        from the popup.
   */
  _cycleCSSSuggestion: function(reverse, noSelect) {
    // selectedItem can be null when nothing is selected in an empty editor.
    let {label, preLabel} = this.popup.selectedItem ||
                            {label: "", preLabel: ""};
    if (reverse) {
      this.popup.selectPreviousItem();
    } else {
      this.popup.selectNextItem();
    }

    this._selectedIndex = this.popup.selectedIndex;
    let input = this.input;
    let pre = "";

    if (input.selectionStart < input.selectionEnd) {
      pre = input.value.slice(0, input.selectionStart);
    } else {
      pre = input.value.slice(0, input.selectionStart - label.length +
                              preLabel.length);
    }

    let post = input.value.slice(input.selectionEnd, input.value.length);
    let item = this.popup.selectedItem;
    let toComplete = item.label.slice(item.preLabel.length);
    input.value = pre + toComplete + post;

    if (!noSelect) {
      input.setSelectionRange(pre.length, pre.length + toComplete.length);
    } else {
      input.setSelectionRange(pre.length + toComplete.length,
                              pre.length + toComplete.length);
    }

    this._updateSize();
    // This emit is mainly for the purpose of making the test flow simpler.
    this.emit("after-suggest");
  },

  /**
   * Call the client's done handler and clear out.
   */
  _apply: function(event, direction) {
    if (this._applied) {
      return null;
    }

    this._applied = true;

    if (this.done) {
      let val = this.cancelled ? this.initial : this.currentInputValue;
      return this.done(val, !this.cancelled, direction);
    }

    return null;
  },

  /**
   * Handle loss of focus by calling done if it hasn't been called yet.
   */
  _onBlur: function(event, doNotClear) {
    if (event && this.popup && this.popup.isOpen &&
        this.popup.selectedIndex >= 0) {
      let label, preLabel;

      if (this._selectedIndex === undefined) {
        ({label, preLabel} =
          this.popup.getItemAtIndex(this.popup.selectedIndex));
      } else {
        ({label, preLabel} = this.popup.getItemAtIndex(this._selectedIndex));
      }

      let input = this.input;
      let pre = "";

      if (input.selectionStart < input.selectionEnd) {
        pre = input.value.slice(0, input.selectionStart);
      } else {
        pre = input.value.slice(0, input.selectionStart - label.length +
                                preLabel.length);
      }
      let post = input.value.slice(input.selectionEnd, input.value.length);
      let item = this.popup.selectedItem;
      this._selectedIndex = this.popup.selectedIndex;
      let toComplete = item.label.slice(item.preLabel.length);
      input.value = pre + toComplete + post;
      input.setSelectionRange(pre.length + toComplete.length,
                              pre.length + toComplete.length);
      this._updateSize();
      // Wait for the popup to hide and then focus input async otherwise it does
      // not work.
      let onPopupHidden = () => {
        this.popup._panel.removeEventListener("popuphidden", onPopupHidden);
        this.doc.defaultView.setTimeout(()=> {
          input.focus();
          this.emit("after-suggest");
        }, 0);
      };
      this.popup._panel.addEventListener("popuphidden", onPopupHidden);
      this.popup.hidePopup();
      // Content type other than CSS_MIXED is used in rule-view where the values
      // are live previewed. So we apply the value before returning.
      if (this.contentType != CONTENT_TYPES.CSS_MIXED) {
        this._apply();
      }
      return;
    }

    this._apply();

    if (!doNotClear) {
      this._clear();
    }
  },

  /**
   * Handle the input field's keypress event.
   */
  _onKeyPress: function(event) {
    let prevent = false;

    const largeIncrement = 100;
    const mediumIncrement = 10;
    const smallIncrement = 0.1;

    let increment = 0;

    if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_UP ||
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_UP) {
      increment = 1;
    } else if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_DOWN ||
               event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN) {
      increment = -1;
    }

    if (event.shiftKey && !event.altKey) {
      if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_UP ||
          event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN) {
        increment *= largeIncrement;
      } else {
        increment *= mediumIncrement;
      }
    } else if (event.altKey && !event.shiftKey) {
      increment *= smallIncrement;
    }

    // Use default cursor movement rather than providing auto-suggestions.
    if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_HOME ||
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_END ||
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_UP ||
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN) {
      this._preventSuggestions = true;
    }

    let cycling = false;
    if (increment && this._incrementValue(increment)) {
      this._updateSize();
      prevent = true;
      cycling = true;
    } else if (increment && this.popup && this.popup.isOpen) {
      cycling = true;
      prevent = true;
      this._cycleCSSSuggestion(increment > 0);
      this._doValidation();
    }

    if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_BACK_SPACE ||
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_DELETE ||
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_LEFT ||
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RIGHT) {
      if (this.popup && this.popup.isOpen) {
        this.popup.hidePopup();
      }
    } else if (!cycling && !event.metaKey && !event.altKey && !event.ctrlKey) {
      this._maybeSuggestCompletion();
    }

    if (this.multiline &&
        event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN &&
        event.shiftKey) {
      prevent = false;
    } else if (this._advanceChars(event.charCode, this.input.value,
                                  this.input.selectionStart) ||
               event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN ||
               event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_TAB) {
      prevent = true;

      let direction = FOCUS_FORWARD;
      if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_TAB &&
          event.shiftKey) {
        if (this.stopOnShiftTab) {
          direction = null;
        } else {
          direction = FOCUS_BACKWARD;
        }
      }
      if ((this.stopOnReturn &&
           event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN) ||
          (this.stopOnTab && event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_TAB &&
           !event.shiftKey)) {
        direction = null;
      }

      // Now we don't want to suggest anything as we are moving out.
      this._preventSuggestions = true;
      // But we still want to show suggestions for css values. i.e. moving out
      // of css property input box in forward direction
      if (this.contentType == CONTENT_TYPES.CSS_PROPERTY &&
          direction == FOCUS_FORWARD) {
        this._preventSuggestions = false;
      }

      let input = this.input;

      if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_TAB &&
          this.contentType == CONTENT_TYPES.CSS_MIXED) {
        if (this.popup && input.selectionStart < input.selectionEnd) {
          event.preventDefault();
          input.setSelectionRange(input.selectionEnd, input.selectionEnd);
          this.emit("after-suggest");
          return;
        } else if (this.popup && this.popup.isOpen) {
          event.preventDefault();
          this._cycleCSSSuggestion(event.shiftKey, true);
          return;
        }
      }

      this._apply(event, direction);

      // Close the popup if open
      if (this.popup && this.popup.isOpen) {
        this.popup.hidePopup();
      }

      if (direction !== null && focusManager.focusedElement === input) {
        // If the focused element wasn't changed by the done callback,
        // move the focus as requested.
        let next = moveFocus(this.doc.defaultView, direction);

        // If the next node to be focused has been tagged as an editable
        // node, trigger editing using the configured event
        if (next && next.ownerDocument === this.doc && next._editable) {
          let e = this.doc.createEvent("Event");
          e.initEvent(next._trigger, true, true);
          next.dispatchEvent(e);
        }
      }

      this._clear();
    } else if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_ESCAPE) {
      // Cancel and blur ourselves.
      // Now we don't want to suggest anything as we are moving out.
      this._preventSuggestions = true;
      // Close the popup if open
      if (this.popup && this.popup.isOpen) {
        this.popup.hidePopup();
      }
      prevent = true;
      this.cancelled = true;
      this._apply();
      this._clear();
      event.stopPropagation();
    } else if (event.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_SPACE) {
      // No need for leading spaces here.  This is particularly
      // noticable when adding a property: it's very natural to type
      // <name>: (which advances to the next property) then spacebar.
      prevent = !this.input.value;
    }

    if (prevent) {
      event.preventDefault();
    }
  },

  /**
   * Handle the input field's keyup event.
   */
  _onKeyup: function() {
    this._applied = false;
  },

  /**
   * Handle changes to the input text.
   */
  _onInput: function() {
    // Validate the entered value.
    this._doValidation();

    // Update size if we're autosizing.
    if (this._measurement) {
      this._updateSize();
    }

    // Call the user's change handler if available.
    if (this.change) {
      this.change(this.currentInputValue);
    }
  },

  /**
   * Fire validation callback with current input
   */
  _doValidation: function() {
    if (this.validate && this.input) {
      this.validate(this.input.value);
    }
  },

  /**
   * Handles displaying suggestions based on the current input.
   *
   * @param {Boolean} noAutoInsert
   *        true if you don't want to automatically insert the first suggestion
   */
  _maybeSuggestCompletion: function(noAutoInsert) {
    // Input can be null in cases when you intantaneously switch out of it.
    if (!this.input) {
      return;
    }
    let preTimeoutQuery = this.input.value;
    // Since we are calling this method from a keypress event handler, the
    // |input.value| does not include currently typed character. Thus we perform
    // this method async.
    this.doc.defaultView.setTimeout(() => {
      if (this._preventSuggestions) {
        this._preventSuggestions = false;
        return;
      }
      if (this.contentType == CONTENT_TYPES.PLAIN_TEXT) {
        return;
      }
      if (!this.input) {
        return;
      }
      let input = this.input;
      // The length of input.value should be increased by 1
      if (input.value.length - preTimeoutQuery.length > 1) {
        return;
      }
      let query = input.value.slice(0, input.selectionStart);
      let startCheckQuery = query;
      if (query == null) {
        return;
      }
      // If nothing is selected and there is a non-space character after the
      // cursor, do not autocomplete.
      if (input.selectionStart == input.selectionEnd &&
          input.selectionStart < input.value.length &&
          input.value.slice(input.selectionStart)[0] != " ") {
        // This emit is mainly to make the test flow simpler.
        this.emit("after-suggest", "nothing to autocomplete");
        return;
      }
      let list = [];
      if (this.contentType == CONTENT_TYPES.CSS_PROPERTY) {
        list = CSSPropertyList;
      } else if (this.contentType == CONTENT_TYPES.CSS_VALUE) {
        // Get the last query to be completed before the caret.
        let match = /([^\s,.\/]+$)/.exec(query);
        if (match) {
          startCheckQuery = match[0];
        } else {
          startCheckQuery = "";
        }

        list =
          ["!important",
           ...domUtils.getCSSValuesForProperty(this.property.name)];

        if (query == "") {
          // Do not suggest '!important' without any manually typed character.
          list.splice(0, 1);
        }
      } else if (this.contentType == CONTENT_TYPES.CSS_MIXED &&
                 /^\s*style\s*=/.test(query)) {
        // Detecting if cursor is at property or value;
        let match = query.match(/([:;"'=]?)\s*([^"';:=]+)?$/);
        if (match && match.length >= 2) {
          if (match[1] == ":") { // We are in CSS value completion
            let propertyName =
              query.match(/[;"'=]\s*([^"';:= ]+)\s*:\s*[^"';:=]*$/)[1];
            list =
              ["!important;",
               ...domUtils.getCSSValuesForProperty(propertyName)];
            let matchLastQuery = /([^\s,.\/]+$)/.exec(match[2] || "");
            if (matchLastQuery) {
              startCheckQuery = matchLastQuery[0];
            } else {
              startCheckQuery = "";
            }
            if (!match[2]) {
              // Don't suggest '!important' without any manually typed character
              list.splice(0, 1);
            }
          } else if (match[1]) { // We are in CSS property name completion
            list = CSSPropertyList;
            startCheckQuery = match[2];
          }
          if (startCheckQuery == null) {
            // This emit is mainly to make the test flow simpler.
            this.emit("after-suggest", "nothing to autocomplete");
            return;
          }
        }
      }
      if (!noAutoInsert) {
        list.some(item => {
          if (startCheckQuery != null && item.startsWith(startCheckQuery)) {
            input.value = query + item.slice(startCheckQuery.length) +
                          input.value.slice(query.length);
            input.setSelectionRange(query.length, query.length + item.length -
                                                  startCheckQuery.length);
            this._updateSize();
            return true;
          }
        });
      }

      if (!this.popup) {
        // This emit is mainly to make the test flow simpler.
        this.emit("after-suggest", "no popup");
        return;
      }
      let finalList = [];
      let length = list.length;
      for (let i = 0, count = 0; i < length && count < MAX_POPUP_ENTRIES; i++) {
        if (startCheckQuery != null && list[i].startsWith(startCheckQuery)) {
          count++;
          finalList.push({
            preLabel: startCheckQuery,
            label: list[i]
          });
        } else if (count > 0) {
          // Since count was incremented, we had already crossed the entries
          // which would have started with query, assuming that list is sorted.
          break;
        } else if (startCheckQuery != null && list[i][0] > startCheckQuery[0]) {
          // We have crossed all possible matches alphabetically.
          break;
        }
      }

      if (finalList.length > 1) {
        // Calculate the offset for the popup to be opened.
        let x = (this.input.selectionStart - startCheckQuery.length) *
                this.inputCharWidth;
        this.popup.setItems(finalList);
        this.popup.openPopup(this.input, x);
        if (noAutoInsert) {
          this.popup.selectedIndex = -1;
        }
      } else {
        this.popup.hidePopup();
      }
      // This emit is mainly for the purpose of making the test flow simpler.
      this.emit("after-suggest");
      this._doValidation();
    }, 0);
  }
};

/**
 * Copy text-related styles from one element to another.
 */
function copyTextStyles(from, to) {
  let win = from.ownerDocument.defaultView;
  let style = win.getComputedStyle(from);
  to.style.fontFamily = style.getPropertyCSSValue("font-family").cssText;
  to.style.fontSize = style.getPropertyCSSValue("font-size").cssText;
  to.style.fontWeight = style.getPropertyCSSValue("font-weight").cssText;
  to.style.fontStyle = style.getPropertyCSSValue("font-style").cssText;
}

/**
 * Trigger a focus change similar to pressing tab/shift-tab.
 */
function moveFocus(win, direction) {
  return focusManager.moveFocus(win, null, direction, 0);
}

XPCOMUtils.defineLazyGetter(this, "focusManager", function() {
  return Services.focus;
});

XPCOMUtils.defineLazyGetter(this, "CSSPropertyList", function() {
  return domUtils.getCSSPropertyNames(domUtils.INCLUDE_ALIASES).sort();
});

XPCOMUtils.defineLazyGetter(this, "domUtils", function() {
  return Cc["@mozilla.org/inspector/dom-utils;1"].getService(Ci.inIDOMUtils);
});
