/* -*- js-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {Cu, Ci} = require("chrome");
const {Class} = require("sdk/core/heritage");
const Services = require("Services");

const {DebuggerServer} = require("devtools/server/main");
const DevToolsUtils = require("devtools/shared/DevToolsUtils");

loader.lazyGetter(this, "NetworkHelper", () => require("devtools/shared/webconsole/network-helper"));

// Helper tracer. Should be generic sharable by other modules (bug 1171927)
const trace = {
  log: function(...args) {
  }
}

// Constants
const makeInfallible = DevToolsUtils.makeInfallible;
const acceptableHeaders = ["x-chromelogger-data"];

/**
 * The listener is responsible for detecting server side logs
 * within HTTP headers and sending them to the client.
 *
 * The logic is based on "http-on-examine-response" event that is
 * sent when a response from the server is received. Consequently HTTP
 * headers are parsed to find server side logs.
 *
 * A listeners for "http-on-examine-response" is registered when
 * the listener starts and removed when destroy is executed.
 */
var ServerLoggingListener = Class({
  /**
   * Initialization of the listener. The main step during the initialization
   * process is registering a listener for "http-on-examine-response" event.
   *
   * @param {Object} win (nsIDOMWindow):
   *        filter network requests by the associated window object.
   *        If null (i.e. in the browser context) log everything
   * @param {Object} owner
   *        The {@WebConsoleActor} instance
   */
  initialize: function(win, owner) {
    trace.log("ServerLoggingListener.initialize; ", owner.actorID,
      ", child process: ", DebuggerServer.isInChildProcess);

    this.owner = owner;
    this.window = win;

    this.onExamineResponse = this.onExamineResponse.bind(this);
    this.onExamineHeaders = this.onExamineHeaders.bind(this);
    this.onParentMessage = this.onParentMessage.bind(this);

    this.attach();
  },

  /**
   * The destroy is called by the parent WebConsoleActor actor.
   */
  destroy: function() {
    trace.log("ServerLoggingListener.destroy; ", this.owner.actorID,
      ", child process: ", DebuggerServer.isInChildProcess);

    this.detach();
  },

  /**
   * The main responsibility of this method is registering a listener for
   * "http-on-examine-response" events.
   */
  attach: makeInfallible(function() {
    trace.log("ServerLoggingListener.attach; child process: ",
      DebuggerServer.isInChildProcess);

    // Setup the child <-> parent communication if this actor module
    // is running in a child process. If e10s is disabled (this actor
    // running in the same process as everything else) register observer
    // listener just like in good old pre e10s days.
    if (DebuggerServer.isInChildProcess) {
      this.attachParentProcess();
    } else {
      Services.obs.addObserver(this.onExamineResponse,
        "http-on-examine-response", false);
    }
  }),

  /**
   * Remove the "http-on-examine-response" listener.
   */
  detach: makeInfallible(function() {
    trace.log("ServerLoggingListener.detach; ", this.owner.actorID);

    if (DebuggerServer.isInChildProcess) {
      this.detachParentProcess();
    } else {
      Services.obs.removeObserver(this.onExamineResponse,
        "http-on-examine-response", false);
    }
  }),

  // Parent Child Relationship

  attachParentProcess: function() {
    trace.log("ServerLoggingListener.attachParentProcess;");

    this.owner.conn.setupInParent({
      module: "devtools/shared/webconsole/server-logger-monitor",
      setupParent: "setupParentProcess"
    });

    let mm = this.owner.conn.parentMessageManager;
    let { addMessageListener, sendSyncMessage } = mm;

    // It isn't possible to register HTTP-* event observer inside
    // a child process (in case of e10s), so listen for messages
    // coming from the {@ServerLoggerMonitor} that lives inside
    // the parent process.
    addMessageListener("debug:server-logger", this.onParentMessage);

    // Attach to the {@ServerLoggerMonitor} object to subscribe events.
    sendSyncMessage("debug:server-logger", {
      method: "attachChild"
    });
  },

  detachParentProcess: makeInfallible(function() {
    trace.log("ServerLoggingListener.detachParentProcess;");

    let mm = this.owner.conn.parentMessageManager;
    let { removeMessageListener, sendSyncMessage } = mm;

    sendSyncMessage("debug:server-logger", {
      method: "detachChild",
    });

    removeMessageListener("debug:server-logger", this.onParentMessage);
  }),

  onParentMessage: makeInfallible(function(msg) {
    if (!msg.data) {
      return;
    }

    let method = msg.data.method;
    trace.log("ServerLogger.onParentMessage; ", method, msg.data);

    switch (method) {
      case "examineHeaders":
        return this.onExamineHeaders(msg);
      default:
        trace.log("Unknown method name: ", method);
    }
  }),

  // HTTP Observer

  onExamineHeaders: function(event) {
    let headers = event.data.headers;

    trace.log("ServerLoggingListener.onExamineHeaders;", headers);

    let parsedMessages = [];

    for (let item of headers) {
      let header = item.header;
      let value = item.value;

      let messages = this.parse(header, value);
      if (messages) {
        parsedMessages.push(...messages);
      }
    }

    if (!parsedMessages.length) {
      return;
    }

    for (let message of parsedMessages) {
      this.sendMessage(message);
    }
  },

  onExamineResponse: makeInfallible(function(subject) {
    let httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);

    trace.log("ServerLoggingListener.onExamineResponse; ", httpChannel.name,
      ", ", this.owner.actorID, httpChannel);

    if (!this._matchRequest(httpChannel)) {
      trace.log("ServerLoggerMonitor.onExamineResponse; No matching request!");
      return;
    }

    let headers = [];

    httpChannel.visitResponseHeaders((header, value) => {
      header = header.toLowerCase();
      if (acceptableHeaders.indexOf(header) !== -1) {
        headers.push({header: header, value: value});
      }
    });

    this.onExamineHeaders({
      data: {
        headers: headers,
      }
    });
  }),

  /**
   * Check if a given network request should be logged by this network monitor
   * instance based on the current filters.
   *
   * @private
   * @param nsIHttpChannel aChannel
   *        Request to check.
   * @return boolean
   *         True if the network request should be logged, false otherwise.
   */
  _matchRequest: function(aChannel) {
    trace.log("_matchRequest ", this.window, ", ", this.topFrame);

    // Log everything if the window is null (it's null in the browser context)
    if (!this.window) {
      return true;
    }

    // Ignore requests from chrome or add-on code when we are monitoring
    // content.
    if (!aChannel.loadInfo &&
        aChannel.loadInfo.loadingDocument === null &&
        aChannel.loadInfo.loadingPrincipal === Services.scriptSecurityManager.getSystemPrincipal()) {
      return false;
    }

    // Since frames support, this.window may not be the top level content
    // frame, so that we can't only compare with win.top.
    let win = NetworkHelper.getWindowForRequest(aChannel);
    while (win) {
      if (win == this.window) {
        return true;
      }
      if (win.parent == win) {
        break;
      }
      win = win.parent;
    }

    return false;
  },

  // Server Logs

  /**
   * Search through HTTP headers to catch all server side logs.
   * Learn more about the data structure:
   * https://craig.is/writing/chrome-logger/techspecs
   */
  parse: function(header, value) {
    let data;

    try {
      let result = decodeURIComponent(escape(atob(value)));
      data = JSON.parse(result);
    } catch (err) {
      Cu.reportError("Failed to parse HTTP log data! " + err);
      return null;
    }

    let parsedMessage = [];
    let columnMap = this.getColumnMap(data);

    trace.log("ServerLoggingListener.parse; ColumnMap", columnMap);
    trace.log("ServerLoggingListener.parse; data", data);

    let lastLocation;

    for (let row of data.rows) {
      let backtrace = row[columnMap.get("backtrace")];
      let rawLogs = row[columnMap.get("log")];
      let type = row[columnMap.get("type")] || "log";

      // Old version of the protocol includes a label.
      // If this is the old version do some converting.
      if (data.columns.indexOf("label") != -1) {
        let label = row[columnMap.get("label")];
        let showLabel = label && typeof label === "string";

        rawLogs = [rawLogs];

        if (showLabel) {
          rawLogs.unshift(label);
        }
      }

      // If multiple logs come from the same line only the first log
      // has info about the backtrace. So, remember the last valid
      // location and use it for those that not set.
      let location = this.parseBacktrace(backtrace);
      if (location) {
        lastLocation = location;
      } else {
        location = lastLocation;
      }

      parsedMessage.push({
        logs: rawLogs,
        location: location,
        type: type
      });
    }

    return parsedMessage;
  },

  parseBacktrace: function(backtrace) {
    if (!backtrace) {
      return null;
    }

    let result = backtrace.match(/\s*(\d+)$/);
    if (!result || result.length < 2) {
      return backtrace;
    }

    return {
      url: backtrace.slice(0, -result[0].length),
      line: result[1]
    };
  },

  getColumnMap: function(data) {
    let columnMap = new Map();
    let columnName;

    for (let key in data.columns) {
      columnName = data.columns[key];
      columnMap.set(columnName, key);
    }

    return columnMap;
  },

  sendMessage: function(msg) {
    trace.log("ServerLoggingListener.sendMessage; message", msg);

    let formatted = format(msg);
    trace.log("ServerLoggingListener.sendMessage; formatted", formatted);

    let win = this.window;
    let innerID = win ? getInnerId(win) : null;
    let location = msg.location;

    let message = {
      category: "server",
      innerID: innerID,
      level: msg.type,
      filename: location ? location.url : null,
      lineNumber: location ? location.line : null,
      columnNumber: 0,
      private: false,
      timeStamp: Date.now(),
      arguments: formatted ? formatted.logs : null,
      styles: formatted ? formatted.styles : null,
    };

    // Make sure to set the group name.
    if (msg.type == "group" && formatted && formatted.logs) {
      message.groupName = formatted ? formatted.logs[0] : null;
    }

    // A message for console.table() method (passed in as the first
    // argument) isn't supported. But, it's passed in by some server
    // side libraries that implement console.* API - let's just remove it.
    let args = message.arguments;
    if (msg.type == "table" && args) {
      if (typeof args[0] == "string") {
        args.shift();
      }
    }

    trace.log("ServerLoggingListener.sendMessage; raw: ",
      msg.logs.join(", "), message);

    this.owner.onServerLogCall(message);
  },
});

// Helpers

/**
 * Parse printf-like specifiers ("%f", "%d", ...) and
 * format the logs according to them.
 */
function format(msg) {
  if (!msg.logs || !msg.logs[0]) {
    return;
  }

  // Initialize the styles array (used for the "%c" specifier).
  msg.styles = [];

  // Remove and get the first log (in which the specifiers are).
  let firstString = msg.logs.shift();
  // Contains all the strings split by the specifiers
  // (i.e. "a %f b" => ["a ", " b"]).
  let splitLog = [];
  // All the specifiers present in the first string.
  let specifiers = [];
  let specifierIndex = -1;
  let splitLogRegExp = /(.*?)(%[oOcsdif]|$)/g;
  let splitLogRegExpRes;

  // Get the strings before the specifiers (or the last chunk before the end
  // of the string).
  while ((splitLogRegExpRes = splitLogRegExp.exec(firstString)) !== null) {
    let [_, log, specifier] = splitLogRegExpRes;

    // We can add an empty string if there is a specifier after (which
    // means we haven't reached the end of the string). This empty string is
    // necessary when rebuilding the logs after the formatting (we should ensure
    // to alternate a log + a specifier to replace to make this loop work).
    //
    // Example: "%ctest" => first iteration: log = "", specifier = "%c".
    //                   => second iteration: log = "test", specifier = "".
    if (log || specifier) {
      splitLog.push(log);
    }

    // Break now if there is no specifier anymore
    // (means that we have reached the end of the string).
    if (!specifier) {
      break;
    }

    specifiers.push(specifier);
  }

  // This array represents the string of the log, in which the specifiers
  // are replaced. It alternates strings and objects (%o;%O).
  let rebuiltLogArray = [];
  let concatString = "";
  let pushConcatString = () => {
    if (concatString) {
      rebuiltLogArray.push(concatString);
    }
    concatString = "";
  };

  // Merge the split first string and the values associated to the specifiers.
  splitLog.forEach((string, index) => {
    // Concatenate the string in any case.
    concatString += string;
    if (specifiers.length === 0) {
      return;
    }

    let argument = msg.logs.shift();
    switch (specifiers[index]) {
      case "%i":
      case "%d":
        // Parse into integer.
        argument |= 0;
        concatString += argument;
        break;
      case "%f":
        // Parse into float.
        argument =+ argument;
        concatString += argument;
        break;
      case "%o":
      case "%O":
        // Push the concatenated string and reinitialize concatString.
        pushConcatString();
        // Push the object.
        rebuiltLogArray.push(argument);
        break;
      case "%s":
        concatString += argument;
        break;
      case "%c":
        pushConcatString();
        for (let j = msg.styles.length; j < rebuiltLogArray.length; j++) {
          msg.styles.push(null);
        }
        msg.styles.push(argument);
        break;
      default:
        // Should never happen.
        return;
    }
  });

  if (concatString) {
    rebuiltLogArray.push(concatString);
  }

  // Append the rest of arguments that don't have corresponding
  // specifiers to the message logs.
  msg.logs = rebuiltLogArray.concat(msg.logs);

  // Remove special ___class_name property that isn't supported
  // by the current implementation. This property represents object class
  // allowing custom rendering in the console panel.
  for (let log of msg.logs) {
    if (typeof log == "object") {
      delete log.___class_name;
    }
  }

  return msg;
}

// These helper are cloned from SDK to avoid loading to
// much SDK modules just because of two functions.
function getInnerId(win) {
  return win.QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDOMWindowUtils).currentInnerWindowID;
}

// Exports from this module
exports.ServerLoggingListener = ServerLoggingListener;
