/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

XPCOMUtils.defineLazyGetter(this, "HarExporter", function() {
  return require("devtools/client/netmonitor/har/har-exporter").HarExporter;
});

XPCOMUtils.defineLazyGetter(this, "NetworkHelper", function() {
  return require("devtools/shared/webconsole/network-helper");
});

const HTML_NS = "http://www.w3.org/1999/xhtml";
const EPSILON = 0.001;
const SOURCE_SYNTAX_HIGHLIGHT_MAX_FILE_SIZE = 102400; // 100 KB in bytes
const RESIZE_REFRESH_RATE = 50; // ms
const REQUESTS_REFRESH_RATE = 50; // ms
const REQUESTS_HEADERS_SAFE_BOUNDS = 30; // px
const REQUESTS_TOOLTIP_POSITION = "topcenter bottomleft";
const REQUESTS_TOOLTIP_IMAGE_MAX_DIM = 400; // px
const REQUESTS_WATERFALL_SAFE_BOUNDS = 90; // px
const REQUESTS_WATERFALL_HEADER_TICKS_MULTIPLE = 5; // ms
const REQUESTS_WATERFALL_HEADER_TICKS_SPACING_MIN = 60; // px
const REQUESTS_WATERFALL_BACKGROUND_TICKS_MULTIPLE = 5; // ms
const REQUESTS_WATERFALL_BACKGROUND_TICKS_SCALES = 3;
const REQUESTS_WATERFALL_BACKGROUND_TICKS_SPACING_MIN = 10; // px
const REQUESTS_WATERFALL_BACKGROUND_TICKS_COLOR_RGB = [128, 136, 144];
const REQUESTS_WATERFALL_BACKGROUND_TICKS_OPACITY_MIN = 32; // byte
const REQUESTS_WATERFALL_BACKGROUND_TICKS_OPACITY_ADD = 32; // byte
const REQUESTS_WATERFALL_DOMCONTENTLOADED_TICKS_COLOR_RGBA = [255, 0, 0, 128];
const REQUESTS_WATERFALL_LOAD_TICKS_COLOR_RGBA = [0, 0, 255, 128];
const REQUEST_TIME_DECIMALS = 2;
const HEADERS_SIZE_DECIMALS = 3;
const CONTENT_SIZE_DECIMALS = 2;
const CONTENT_MIME_TYPE_ABBREVIATIONS = {
  "ecmascript": "js",
  "javascript": "js",
  "x-javascript": "js"
};
const CONTENT_MIME_TYPE_MAPPINGS = {
  "/ecmascript": Editor.modes.js,
  "/javascript": Editor.modes.js,
  "/x-javascript": Editor.modes.js,
  "/html": Editor.modes.html,
  "/xhtml": Editor.modes.html,
  "/xml": Editor.modes.html,
  "/atom": Editor.modes.html,
  "/soap": Editor.modes.html,
  "/rdf": Editor.modes.css,
  "/rss": Editor.modes.css,
  "/css": Editor.modes.css
};
const DEFAULT_EDITOR_CONFIG = {
  mode: Editor.modes.text,
  readOnly: true,
  lineNumbers: true
};
const GENERIC_VARIABLES_VIEW_SETTINGS = {
  lazyEmpty: true,
  lazyEmptyDelay: 10, // ms
  searchEnabled: true,
  editableValueTooltip: "",
  editableNameTooltip: "",
  preventDisableOnChange: true,
  preventDescriptorModifiers: true,
  eval: () => {}
};
const NETWORK_ANALYSIS_PIE_CHART_DIAMETER = 200; // px
const FREETEXT_FILTER_SEARCH_DELAY = 200; // ms

const {DeferredTask} = Cu.import("resource://gre/modules/DeferredTask.jsm", {});

/**
 * Object defining the network monitor view components.
 */
var NetMonitorView = {
  /**
   * Initializes the network monitor view.
   */
  initialize: function() {
    this._initializePanes();

    this.Toolbar.initialize();
    this.RequestsMenu.initialize();
    this.NetworkDetails.initialize();
    this.CustomRequest.initialize();
  },

  /**
   * Destroys the network monitor view.
   */
  destroy: function() {
    this._isDestroyed = true;
    this.Toolbar.destroy();
    this.RequestsMenu.destroy();
    this.NetworkDetails.destroy();
    this.CustomRequest.destroy();

    this._destroyPanes();
  },

  /**
   * Initializes the UI for all the displayed panes.
   */
  _initializePanes: function() {
    dumpn("Initializing the NetMonitorView panes");

    this._body = $("#body");
    this._detailsPane = $("#details-pane");
    this._detailsPaneToggleButton = $("#details-pane-toggle");

    this._collapsePaneString = L10N.getStr("collapseDetailsPane");
    this._expandPaneString = L10N.getStr("expandDetailsPane");

    this._detailsPane.setAttribute("width", Prefs.networkDetailsWidth);
    this._detailsPane.setAttribute("height", Prefs.networkDetailsHeight);
    this.toggleDetailsPane({ visible: false });

    // Disable the performance statistics mode.
    if (!Prefs.statistics) {
      $("#request-menu-context-perf").hidden = true;
      $("#notice-perf-message").hidden = true;
      $("#requests-menu-network-summary-button").hidden = true;
      $("#requests-menu-network-summary-label").hidden = true;
    }
  },

  /**
   * Destroys the UI for all the displayed panes.
   */
  _destroyPanes: Task.async(function*() {
    dumpn("Destroying the NetMonitorView panes");

    Prefs.networkDetailsWidth = this._detailsPane.getAttribute("width");
    Prefs.networkDetailsHeight = this._detailsPane.getAttribute("height");

    this._detailsPane = null;
    this._detailsPaneToggleButton = null;

    for (let p of this._editorPromises.values()) {
      let editor = yield p;
      editor.destroy();
    }
  }),

  /**
   * Gets the visibility state of the network details pane.
   * @return boolean
   */
  get detailsPaneHidden() {
    return this._detailsPane.hasAttribute("pane-collapsed");
  },

  /**
   * Sets the network details pane hidden or visible.
   *
   * @param object aFlags
   *        An object containing some of the following properties:
   *        - visible: true if the pane should be shown, false to hide
   *        - animated: true to display an animation on toggle
   *        - delayed: true to wait a few cycles before toggle
   *        - callback: a function to invoke when the toggle finishes
   * @param number aTabIndex [optional]
   *        The index of the intended selected tab in the details pane.
   */
  toggleDetailsPane: function(aFlags, aTabIndex) {
    let pane = this._detailsPane;
    let button = this._detailsPaneToggleButton;

    ViewHelpers.togglePane(aFlags, pane);

    if (aFlags.visible) {
      this._body.removeAttribute("pane-collapsed");
      button.removeAttribute("pane-collapsed");
      button.setAttribute("tooltiptext", this._collapsePaneString);
    } else {
      this._body.setAttribute("pane-collapsed", "");
      button.setAttribute("pane-collapsed", "");
      button.setAttribute("tooltiptext", this._expandPaneString);
    }

    if (aTabIndex !== undefined) {
      $("#event-details-pane").selectedIndex = aTabIndex;
    }
  },

  /**
   * Gets the current mode for this tool.
   * @return string (e.g, "network-inspector-view" or "network-statistics-view")
   */
  get currentFrontendMode() {
    // The getter may be called from a timeout after the panel is destroyed.
    if (!this._body.selectedPanel) {
      return null;
    }
    return this._body.selectedPanel.id;
  },

  /**
   * Toggles between the frontend view modes ("Inspector" vs. "Statistics").
   */
  toggleFrontendMode: function() {
    if (this.currentFrontendMode != "network-inspector-view") {
      this.showNetworkInspectorView();
    } else {
      this.showNetworkStatisticsView();
    }
  },

  /**
   * Switches to the "Inspector" frontend view mode.
   */
  showNetworkInspectorView: function() {
    this._body.selectedPanel = $("#network-inspector-view");
    this.RequestsMenu._flushWaterfallViews(true);
  },

  /**
   * Switches to the "Statistics" frontend view mode.
   */
  showNetworkStatisticsView: function() {
    this._body.selectedPanel = $("#network-statistics-view");

    let controller = NetMonitorController;
    let requestsView = this.RequestsMenu;
    let statisticsView = this.PerformanceStatistics;

    Task.spawn(function*() {
      statisticsView.displayPlaceholderCharts();
      yield controller.triggerActivity(ACTIVITY_TYPE.RELOAD.WITH_CACHE_ENABLED);

      try {
        // • The response headers and status code are required for determining
        // whether a response is "fresh" (cacheable).
        // • The response content size and request total time are necessary for
        // populating the statistics view.
        // • The response mime type is used for categorization.
        yield whenDataAvailable(requestsView.attachments, [
          "responseHeaders", "status", "contentSize", "transferredSize", "mimeType", "totalTime"
        ]);
      } catch (ex) {
        // Timed out while waiting for data. Continue with what we have.
        DevToolsUtils.reportException("showNetworkStatisticsView", ex);
      }

      statisticsView.createPrimedCacheChart(requestsView.items);
      statisticsView.createEmptyCacheChart(requestsView.items);
    });
  },

  reloadPage: function() {
    NetMonitorController.triggerActivity(ACTIVITY_TYPE.RELOAD.WITH_CACHE_DEFAULT);
  },

  /**
   * Lazily initializes and returns a promise for a Editor instance.
   *
   * @param string aId
   *        The id of the editor placeholder node.
   * @return object
   *         A promise that is resolved when the editor is available.
   */
  editor: function(aId) {
    dumpn("Getting a NetMonitorView editor: " + aId);

    if (this._editorPromises.has(aId)) {
      return this._editorPromises.get(aId);
    }

    let deferred = promise.defer();
    this._editorPromises.set(aId, deferred.promise);

    // Initialize the source editor and store the newly created instance
    // in the ether of a resolved promise's value.
    let editor = new Editor(DEFAULT_EDITOR_CONFIG);
    editor.appendTo($(aId)).then(() => deferred.resolve(editor));

    return deferred.promise;
  },

  _body: null,
  _detailsPane: null,
  _detailsPaneToggleButton: null,
  _collapsePaneString: "",
  _expandPaneString: "",
  _editorPromises: new Map()
};

/**
 * Functions handling the toolbar view: expand/collapse button etc.
 */
function ToolbarView() {
  dumpn("ToolbarView was instantiated");

  this._onTogglePanesPressed = this._onTogglePanesPressed.bind(this);
}

ToolbarView.prototype = {
  /**
   * Initialization function, called when the debugger is started.
   */
  initialize: function() {
    dumpn("Initializing the ToolbarView");

    this._detailsPaneToggleButton = $("#details-pane-toggle");
    this._detailsPaneToggleButton.addEventListener("mousedown", this._onTogglePanesPressed, false);
  },

  /**
   * Destruction function, called when the debugger is closed.
   */
  destroy: function() {
    dumpn("Destroying the ToolbarView");

    this._detailsPaneToggleButton.removeEventListener("mousedown", this._onTogglePanesPressed, false);
  },

  /**
   * Listener handling the toggle button click event.
   */
  _onTogglePanesPressed: function() {
    let requestsMenu = NetMonitorView.RequestsMenu;
    let selectedIndex = requestsMenu.selectedIndex;

    // Make sure there's a selection if the button is pressed, to avoid
    // showing an empty network details pane.
    if (selectedIndex == -1 && requestsMenu.itemCount) {
      requestsMenu.selectedIndex = 0;
    } else {
      requestsMenu.selectedIndex = -1;
    }
  },

  _detailsPaneToggleButton: null
};

/**
 * Functions handling the requests menu (containing details about each request,
 * like status, method, file, domain, as well as a waterfall representing
 * timing imformation).
 */
function RequestsMenuView() {
  dumpn("RequestsMenuView was instantiated");

  this._flushRequests = this._flushRequests.bind(this);
  this._onHover = this._onHover.bind(this);
  this._onSelect = this._onSelect.bind(this);
  this._onSwap = this._onSwap.bind(this);
  this._onResize = this._onResize.bind(this);
  this._byFile = this._byFile.bind(this);
  this._byDomain = this._byDomain.bind(this);
  this._byType = this._byType.bind(this);
  this._onSecurityIconClick = this._onSecurityIconClick.bind(this);
}

RequestsMenuView.prototype = Heritage.extend(WidgetMethods, {
  /**
   * Initialization function, called when the network monitor is started.
   */
  initialize: function() {
    dumpn("Initializing the RequestsMenuView");

    this.widget = new SideMenuWidget($("#requests-menu-contents"));
    this._splitter = $("#network-inspector-view-splitter");
    this._summary = $("#requests-menu-network-summary-label");
    this._summary.setAttribute("value", L10N.getStr("networkMenu.empty"));
    this.userInputTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);

    Prefs.filters.forEach(type => this.filterOn(type));
    this.sortContents(this._byTiming);

    this.allowFocusOnRightClick = true;
    this.maintainSelectionVisible = true;

    this.widget.addEventListener("select", this._onSelect, false);
    this.widget.addEventListener("swap", this._onSwap, false);
    this._splitter.addEventListener("mousemove", this._onResize, false);
    window.addEventListener("resize", this._onResize, false);

    this.requestsMenuSortEvent = getKeyWithEvent(this.sortBy.bind(this));
    this.requestsMenuFilterEvent = getKeyWithEvent(this.filterOn.bind(this));
    this.reqeustsMenuClearEvent = this.clear.bind(this);
    this._onContextShowing = this._onContextShowing.bind(this);
    this._onContextNewTabCommand = this.openRequestInTab.bind(this);
    this._onContextCopyUrlCommand = this.copyUrl.bind(this);
    this._onContextCopyImageAsDataUriCommand = this.copyImageAsDataUri.bind(this);
    this._onContextCopyResponseCommand = this.copyResponse.bind(this);
    this._onContextResendCommand = this.cloneSelectedRequest.bind(this);
    this._onContextToggleRawHeadersCommand = this.toggleRawHeaders.bind(this);
    this._onContextPerfCommand = () => NetMonitorView.toggleFrontendMode();
    this._onReloadCommand = () => NetMonitorView.reloadPage();
    this._flushRequestsTask = new DeferredTask(this._flushRequests, REQUESTS_REFRESH_RATE);

    this.sendCustomRequestEvent = this.sendCustomRequest.bind(this);
    this.closeCustomRequestEvent = this.closeCustomRequest.bind(this);
    this.cloneSelectedRequestEvent = this.cloneSelectedRequest.bind(this);
    this.toggleRawHeadersEvent = this.toggleRawHeaders.bind(this);

    this.requestsFreetextFilterEvent = this.requestsFreetextFilterEvent.bind(this);
    this.reFilterRequests = this.reFilterRequests.bind(this);

    this.freetextFilterBox = $("#requests-menu-filter-freetext-text");
    this.freetextFilterBox.addEventListener("input", this.requestsFreetextFilterEvent, false);
    this.freetextFilterBox.addEventListener("command", this.requestsFreetextFilterEvent, false);

    $("#toolbar-labels").addEventListener("click", this.requestsMenuSortEvent, false);
    $("#requests-menu-footer").addEventListener("click", this.requestsMenuFilterEvent, false);
    $("#requests-menu-clear-button").addEventListener("click", this.reqeustsMenuClearEvent, false);
    $("#network-request-popup").addEventListener("popupshowing", this._onContextShowing, false);
    $("#request-menu-context-newtab").addEventListener("command", this._onContextNewTabCommand, false);
    $("#request-menu-context-copy-url").addEventListener("command", this._onContextCopyUrlCommand, false);
    $("#request-menu-context-copy-response").addEventListener("command", this._onContextCopyResponseCommand, false);
    $("#request-menu-context-copy-image-as-data-uri").addEventListener("command", this._onContextCopyImageAsDataUriCommand, false);
    $("#toggle-raw-headers").addEventListener("click", this.toggleRawHeadersEvent, false);

    window.once("connected", this._onConnect.bind(this));
  },

  _onConnect: function() {
    $("#requests-menu-reload-notice-button").addEventListener("command", this._onReloadCommand, false);

    if (NetMonitorController.supportsCustomRequest) {
      $("#request-menu-context-resend").addEventListener("command", this._onContextResendCommand, false);
      $("#custom-request-send-button").addEventListener("click", this.sendCustomRequestEvent, false);
      $("#custom-request-close-button").addEventListener("click", this.closeCustomRequestEvent, false);
      $("#headers-summary-resend").addEventListener("click", this.cloneSelectedRequestEvent, false);
    } else {
      $("#request-menu-context-resend").hidden = true;
      $("#headers-summary-resend").hidden = true;
    }

    if (NetMonitorController.supportsPerfStats) {
      $("#request-menu-context-perf").addEventListener("command", this._onContextPerfCommand, false);
      $("#requests-menu-perf-notice-button").addEventListener("command", this._onContextPerfCommand, false);
      $("#requests-menu-network-summary-button").addEventListener("command", this._onContextPerfCommand, false);
      $("#requests-menu-network-summary-label").addEventListener("click", this._onContextPerfCommand, false);
      $("#network-statistics-back-button").addEventListener("command", this._onContextPerfCommand, false);
    } else {
      $("#notice-perf-message").hidden = true;
      $("#request-menu-context-perf").hidden = true;
      $("#requests-menu-network-summary-button").hidden = true;
      $("#requests-menu-network-summary-label").hidden = true;
    }

    if (!NetMonitorController.supportsTransferredResponseSize) {
      $("#requests-menu-transferred-header-box").hidden = true;
      $("#requests-menu-item-template .requests-menu-transferred").hidden = true;
    }
  },

  /**
   * Destruction function, called when the network monitor is closed.
   */
  destroy: function() {
    dumpn("Destroying the SourcesView");

    Prefs.filters = this._activeFilters;

    this.widget.removeEventListener("select", this._onSelect, false);
    this.widget.removeEventListener("swap", this._onSwap, false);
    this._splitter.removeEventListener("mousemove", this._onResize, false);
    window.removeEventListener("resize", this._onResize, false);

    $("#toolbar-labels").removeEventListener("click", this.requestsMenuSortEvent, false);
    $("#requests-menu-footer").removeEventListener("click", this.requestsMenuFilterEvent, false);
    $("#requests-menu-clear-button").removeEventListener("click", this.reqeustsMenuClearEvent, false);
    this.freetextFilterBox.removeEventListener("input", this.requestsFreetextFilterEvent, false);
    this.freetextFilterBox.removeEventListener("command", this.requestsFreetextFilterEvent, false);

    this.userInputTimer.cancel();
    this._flushRequestsTask.disarm();

    $("#network-request-popup").removeEventListener("popupshowing", this._onContextShowing, false);
    $("#request-menu-context-newtab").removeEventListener("command", this._onContextNewTabCommand, false);
    $("#request-menu-context-copy-url").removeEventListener("command", this._onContextCopyUrlCommand, false);
    $("#request-menu-context-copy-response").removeEventListener("command", this._onContextCopyResponseCommand, false);
    $("#request-menu-context-copy-image-as-data-uri").removeEventListener("command", this._onContextCopyImageAsDataUriCommand, false);
    $("#request-menu-context-resend").removeEventListener("command", this._onContextResendCommand, false);
    $("#request-menu-context-perf").removeEventListener("command", this._onContextPerfCommand, false);

    $("#requests-menu-reload-notice-button").removeEventListener("command", this._onReloadCommand, false);
    $("#requests-menu-perf-notice-button").removeEventListener("command", this._onContextPerfCommand, false);
    $("#requests-menu-network-summary-button").removeEventListener("command", this._onContextPerfCommand, false);
    $("#requests-menu-network-summary-label").removeEventListener("click", this._onContextPerfCommand, false);
    $("#network-statistics-back-button").removeEventListener("command", this._onContextPerfCommand, false);

    $("#custom-request-send-button").removeEventListener("click", this.sendCustomRequestEvent, false);
    $("#custom-request-close-button").removeEventListener("click", this.closeCustomRequestEvent, false);
    $("#headers-summary-resend").removeEventListener("click", this.cloneSelectedRequestEvent, false);
    $("#toggle-raw-headers").removeEventListener("click", this.toggleRawHeadersEvent, false);
  },

  /**
   * Resets this container (removes all the networking information).
   */
  reset: function() {
    this.empty();
    this._addQueue = [];
    this._updateQueue = [];
    this._firstRequestStartedMillis = -1;
    this._lastRequestEndedMillis = -1;
  },

  /**
   * Specifies if this view may be updated lazily.
   */
  _lazyUpdate: true,

  get lazyUpdate() {
    return this._lazyUpdate;
  },

  set lazyUpdate(value) {
    this._lazyUpdate = value;
    if (!value) {
      this._flushRequests();
    }
  },

  /**
   * Adds a network request to this container.
   *
   * @param string aId
   *        An identifier coming from the network monitor controller.
   * @param string aStartedDateTime
   *        A string representation of when the request was started, which
   *        can be parsed by Date (for example "2012-09-17T19:50:03.699Z").
   * @param string aMethod
   *        Specifies the request method (e.g. "GET", "POST", etc.)
   * @param string aUrl
   *        Specifies the request's url.
   * @param boolean aIsXHR
   *        True if this request was initiated via XHR.
   * @param boolean aFromCache
   *        Indicates if the result came from the browser cache
   */
  addRequest: function(aId, aStartedDateTime, aMethod, aUrl, aIsXHR, aFromCache) {
    this._addQueue.push([aId, aStartedDateTime, aMethod, aUrl, aIsXHR, aFromCache]);

    // Lazy updating is disabled in some tests.
    if (!this.lazyUpdate) {
      return void this._flushRequests();
    }

    this._flushRequestsTask.arm();
  },

  /**
   * Opens selected item in a new tab.
   */
  openRequestInTab: function() {
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    let selected = this.selectedItem.attachment;
    win.openUILinkIn(selected.url, "tab", { relatedToCurrent: true });
  },

  /**
   * Copy the request url from the currently selected item.
   */
  copyUrl: function() {
    let selected = this.selectedItem.attachment;
    clipboardHelper.copyString(selected.url);
  },

  /**
   * Copy the request url query string parameters from the currently selected item.
   */
  copyUrlParams: function() {
    let selected = this.selectedItem.attachment;
    let params = NetworkHelper.nsIURL(selected.url).query.split("&");
    let string = params.join(Services.appinfo.OS === "WINNT" ? "\r\n" : "\n");
    clipboardHelper.copyString(string);
  },

  /**
   * Extracts any urlencoded form data sections (e.g. "?foo=bar&baz=42") from a
   * POST request.
   *
   * @param object aHeaders
   *        The "requestHeaders".
   * @param object aUploadHeaders
   *        The "requestHeadersFromUploadStream".
   * @param object aPostData
   *        The "requestPostData".
   * @return array
   *        A promise that is resolved with the extracted form data.
   */
  _getFormDataSections: Task.async(function*(aHeaders, aUploadHeaders, aPostData) {
    let formDataSections = [];

    let { headers: requestHeaders } = aHeaders;
    let { headers: payloadHeaders } = aUploadHeaders;
    let allHeaders = [...payloadHeaders, ...requestHeaders];

    let contentTypeHeader = allHeaders.find(e => e.name.toLowerCase() == "content-type");
    let contentTypeLongString = contentTypeHeader ? contentTypeHeader.value : "";
    let contentType = yield gNetwork.getString(contentTypeLongString);

    if (contentType.includes("x-www-form-urlencoded")) {
      let postDataLongString = aPostData.postData.text;
      let postData = yield gNetwork.getString(postDataLongString);

      for (let section of postData.split(/\r\n|\r|\n/)) {
        // Before displaying it, make sure this section of the POST data
        // isn't a line containing upload stream headers.
        if (payloadHeaders.every(header => !section.startsWith(header.name))) {
          formDataSections.push(section);
        }
      }
    }

    return formDataSections;
  }),

  /**
   * Copy the request form data parameters (or raw payload) from the currently selected item.
   */
  copyPostData: Task.async(function*() {
    let selected = this.selectedItem.attachment;
    let view = this;

    // Try to extract any form data parameters.
    let formDataSections = yield view._getFormDataSections(
      selected.requestHeaders,
      selected.requestHeadersFromUploadStream,
      selected.requestPostData);

    let params = [];
    formDataSections.forEach(section => {
      let paramsArray = NetworkHelper.parseQueryString(section);
      if (paramsArray) {
        params = [...params, ...paramsArray];
      }
    });

    let string = params
      .map(param => param.name + (param.value ? "=" + param.value : ""))
      .join(Services.appinfo.OS === "WINNT" ? "\r\n" : "\n");

    // Fall back to raw payload.
    if (!string) {
      let postData = selected.requestPostData.postData.text;
      string = yield gNetwork.getString(postData);
      if (Services.appinfo.OS !== "WINNT") {
        string = string.replace(/\r/g, "");
      }
    }

    clipboardHelper.copyString(string);
  }),

  /**
   * Copy a cURL command from the currently selected item.
   */
  copyAsCurl: function() {
    let selected = this.selectedItem.attachment;

    Task.spawn(function*() {
      // Create a sanitized object for the Curl command generator.
      let data = {
        url: selected.url,
        method: selected.method,
        headers: [],
        httpVersion: selected.httpVersion,
        postDataText: null
      };

      // Fetch header values.
      for (let { name, value } of selected.requestHeaders.headers) {
        let text = yield gNetwork.getString(value);
        data.headers.push({ name: name, value: text });
      }

      // Fetch the request payload.
      if (selected.requestPostData) {
        let postData = selected.requestPostData.postData.text;
        data.postDataText = yield gNetwork.getString(postData);
      }

      clipboardHelper.copyString(Curl.generateCommand(data));
    });
  },

  /**
   * Copy HAR from the network panel content to the clipboard.
   */
  copyAllAsHar: function() {
    let options = this.getDefaultHarOptions();
    return HarExporter.copy(options);
  },

  /**
   * Save HAR from the network panel content to a file.
   */
  saveAllAsHar: function() {
    let options = this.getDefaultHarOptions();
    return HarExporter.save(options);
  },

  getDefaultHarOptions: function() {
    let form = NetMonitorController._target.form;
    let title = form.title || form.url;

    return {
      getString: gNetwork.getString.bind(gNetwork),
      view: this,
      items: NetMonitorView.RequestsMenu.items,
      title: title
    };
  },

  /**
   * Copy the raw request headers from the currently selected item.
   */
  copyRequestHeaders: function() {
    let selected = this.selectedItem.attachment;
    let rawHeaders = selected.requestHeaders.rawHeaders.trim();
    if (Services.appinfo.OS !== "WINNT") {
      rawHeaders = rawHeaders.replace(/\r/g, "");
    }
    clipboardHelper.copyString(rawHeaders);
  },

  /**
   * Copy the raw response headers from the currently selected item.
   */
  copyResponseHeaders: function() {
    let selected = this.selectedItem.attachment;
    let rawHeaders = selected.responseHeaders.rawHeaders.trim();
    if (Services.appinfo.OS !== "WINNT") {
      rawHeaders = rawHeaders.replace(/\r/g, "");
    }
    clipboardHelper.copyString(rawHeaders);
  },

  /**
   * Copy image as data uri.
   */
  copyImageAsDataUri: function() {
    let selected = this.selectedItem.attachment;
    let { mimeType, text, encoding } = selected.responseContent.content;

    gNetwork.getString(text).then(aString => {
      let data = "data:" + mimeType + ";" + encoding + "," + aString;
      clipboardHelper.copyString(data);
    });
  },

  /**
   * Copy response data as a string.
   */
  copyResponse: function() {
    let selected = this.selectedItem.attachment;
    let text = selected.responseContent.content.text;

    gNetwork.getString(text).then(aString => {
      clipboardHelper.copyString(aString);
    });
  },

  /**
   * Create a new custom request form populated with the data from
   * the currently selected request.
   */
  cloneSelectedRequest: function() {
    let selected = this.selectedItem.attachment;

    // Create the element node for the network request item.
    let menuView = this._createMenuView(selected.method, selected.url);

    // Append a network request item to this container.
    let newItem = this.push([menuView], {
      attachment: Object.create(selected, {
        isCustom: { value: true }
      })
    });

    // Immediately switch to new request pane.
    this.selectedItem = newItem;
  },

  /**
   * Send a new HTTP request using the data in the custom request form.
   */
  sendCustomRequest: function() {
    let selected = this.selectedItem.attachment;

    let data = {
      url: selected.url,
      method: selected.method,
      httpVersion: selected.httpVersion,
    };
    if (selected.requestHeaders) {
      data.headers = selected.requestHeaders.headers;
    }
    if (selected.requestPostData) {
      data.body = selected.requestPostData.postData.text;
    }

    NetMonitorController.webConsoleClient.sendHTTPRequest(data, aResponse => {
      let id = aResponse.eventActor.actor;
      this._preferredItemId = id;
    });

    this.closeCustomRequest();
  },

  /**
   * Remove the currently selected custom request.
   */
  closeCustomRequest: function() {
    this.remove(this.selectedItem);
    NetMonitorView.Sidebar.toggle(false);
  },

  /**
   * Shows raw request/response headers in textboxes.
   */
  toggleRawHeaders: function() {
    let requestTextarea = $("#raw-request-headers-textarea");
    let responseTextare = $("#raw-response-headers-textarea");
    let rawHeadersHidden = $("#raw-headers").getAttribute("hidden");

    if (rawHeadersHidden) {
      let selected = this.selectedItem.attachment;
      let selectedRequestHeaders = selected.requestHeaders.headers;
      // display Status-Line above other response headers
      let selectedStatusLine = selected.httpVersion
                               + " " + selected.status
                               + " " + selected.statusText
                               + "\n";
      let selectedResponseHeaders = selected.responseHeaders.headers;
      requestTextarea.value = writeHeaderText(selectedRequestHeaders);
      responseTextare.value = selectedStatusLine
                              + writeHeaderText(selectedResponseHeaders);
      $("#raw-headers").hidden = false;
    } else {
      requestTextarea.value = null;
      responseTextare.value = null;
      $("#raw-headers").hidden = true;
    }
  },

  /**
   * Handles the timeout on the freetext filter textbox
   */
  requestsFreetextFilterEvent: function() {
    this.userInputTimer.cancel();
    this._currentFreetextFilter = this.freetextFilterBox.value || "";

    if (this._currentFreetextFilter.length === 0) {
      this.freetextFilterBox.removeAttribute("filled");
    } else {
      this.freetextFilterBox.setAttribute("filled", true);
    }

    this.userInputTimer.initWithCallback(this.reFilterRequests, FREETEXT_FILTER_SEARCH_DELAY, Ci.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * Refreshes the view contents with the newly selected filters
   */
  reFilterRequests: function() {
    this.filterContents(this._filterPredicate);
    this.refreshSummary();
    this.refreshZebra();
  },

  /**
   * Filters all network requests in this container by a specified type.
   *
   * @param string aType
   *        Either "all", "html", "css", "js", "xhr", "fonts", "images", "media"
   *        "flash" or "other".
   */
  filterOn: function(aType = "all") {
    if (aType === "all") {
      // The filter "all" is special as it doesn't toggle.
      // - If some filters are selected and 'all' is clicked, the previously
      //   selected filters will be disabled and 'all' is the only active one.
      // - If 'all' is already selected, do nothing.
      if (this._activeFilters.indexOf("all") !== -1) {
        return;
      }

      // Uncheck all other filters and select 'all'. Must create a copy as
      // _disableFilter removes the filters from the list while it's being
      // iterated. 'all' will be enabled automatically by _disableFilter once
      // the last filter is disabled.
      this._activeFilters.slice().forEach(this._disableFilter, this);
    }
    else if (this._activeFilters.indexOf(aType) === -1) {
      this._enableFilter(aType);
    }
    else {
      this._disableFilter(aType);
    }

    this.reFilterRequests();
  },

  /**
   * Same as `filterOn`, except that it only allows a single type exclusively.
   *
   * @param string aType
   *        @see RequestsMenuView.prototype.fitlerOn
   */
  filterOnlyOn: function(aType = "all") {
    this._activeFilters.slice().forEach(this._disableFilter, this);
    this.filterOn(aType);
  },

  /**
   * Disables the given filter, its button and toggles 'all' on if the filter to
   * be disabled is the last one active.
   *
   * @param string aType
   *        Either "all", "html", "css", "js", "xhr", "fonts", "images", "media"
   *        "flash" or "other".
   */
  _disableFilter: function (aType) {
    // Remove the filter from list of active filters.
    this._activeFilters.splice(this._activeFilters.indexOf(aType), 1);

    // Remove the checked status from the filter.
    let target = $("#requests-menu-filter-" + aType + "-button");
    target.removeAttribute("checked");

    // Check if the filter disabled was the last one. If so, toggle all on.
    if (this._activeFilters.length === 0) {
      this._enableFilter("all");
    }
  },

  /**
   * Enables the given filter, its button and toggles 'all' off if the filter to
   * be enabled is the first one active.
   *
   * @param string aType
   *        Either "all", "html", "css", "js", "xhr", "fonts", "images", "media"
   *        "flash" or "other".
   */
  _enableFilter: function (aType) {
    // Make sure this is a valid filter type.
    if (Object.keys(this._allFilterPredicates).indexOf(aType) == -1) {
      return;
    }

    // Add the filter to the list of active filters.
    this._activeFilters.push(aType);

    // Add the checked status to the filter button.
    let target = $("#requests-menu-filter-" + aType + "-button");
    target.setAttribute("checked", true);

    // Check if 'all' was selected before. If so, disable it.
    if (aType !== "all" && this._activeFilters.indexOf("all") !== -1) {
      this._disableFilter("all");
    }
  },

  /**
   * Returns a predicate that can be used to test if a request matches any of
   * the active filters.
   */
  get _filterPredicate() {
    let filterPredicates = this._allFilterPredicates;
    let currentFreetextFilter = this._currentFreetextFilter;

    return requestItem => {
      return this._activeFilters.some(filterName => {
        return filterPredicates[filterName].call(this, requestItem) &&
                filterPredicates["freetext"].call(this, requestItem, currentFreetextFilter);
      });
    };
  },

  /**
   * Returns an object with all the filter predicates as [key: function] pairs.
   */
  get _allFilterPredicates() {
    return {
      all: () => true,
      html: this.isHtml,
      css: this.isCss,
      js: this.isJs,
      xhr: this.isXHR,
      fonts: this.isFont,
      images: this.isImage,
      media: this.isMedia,
      flash: this.isFlash,
      other: this.isOther,
      freetext: this.isFreetextMatch
    };
  },

  /**
   * Sorts all network requests in this container by a specified detail.
   *
   * @param string aType
   *        Either "status", "method", "file", "domain", "type", "transferred",
   *        "size" or "waterfall".
   */
  sortBy: function(aType = "waterfall") {
    let target = $("#requests-menu-" + aType + "-button");
    let headers = document.querySelectorAll(".requests-menu-header-button");

    for (let header of headers) {
      if (header != target) {
        header.removeAttribute("sorted");
        header.removeAttribute("tooltiptext");
      }
    }

    let direction = "";
    if (target) {
      if (target.getAttribute("sorted") == "ascending") {
        target.setAttribute("sorted", direction = "descending");
        target.setAttribute("tooltiptext", L10N.getStr("networkMenu.sortedDesc"));
      } else {
        target.setAttribute("sorted", direction = "ascending");
        target.setAttribute("tooltiptext", L10N.getStr("networkMenu.sortedAsc"));
      }
    }

    // Sort by whatever was requested.
    switch (aType) {
      case "status":
        if (direction == "ascending") {
          this.sortContents(this._byStatus);
        } else {
          this.sortContents((a, b) => !this._byStatus(a, b));
        }
        break;
      case "method":
        if (direction == "ascending") {
          this.sortContents(this._byMethod);
        } else {
          this.sortContents((a, b) => !this._byMethod(a, b));
        }
        break;
      case "file":
        if (direction == "ascending") {
          this.sortContents(this._byFile);
        } else {
          this.sortContents((a, b) => !this._byFile(a, b));
        }
        break;
      case "domain":
        if (direction == "ascending") {
          this.sortContents(this._byDomain);
        } else {
          this.sortContents((a, b) => !this._byDomain(a, b));
        }
        break;
      case "type":
        if (direction == "ascending") {
          this.sortContents(this._byType);
        } else {
          this.sortContents((a, b) => !this._byType(a, b));
        }
        break;
      case "transferred":
        if (direction == "ascending") {
          this.sortContents(this._byTransferred);
        } else {
          this.sortContents((a, b) => !this._byTransferred(a, b));
        }
        break;
      case "size":
        if (direction == "ascending") {
          this.sortContents(this._bySize);
        } else {
          this.sortContents((a, b) => !this._bySize(a, b));
        }
        break;
      case "waterfall":
        if (direction == "ascending") {
          this.sortContents(this._byTiming);
        } else {
          this.sortContents((a, b) => !this._byTiming(a, b));
        }
        break;
    }

    this.refreshSummary();
    this.refreshZebra();
  },

  /**
   * Removes all network requests and closes the sidebar if open.
   */
  clear: function() {
    NetMonitorController.NetworkEventsHandler.clearMarkers();
    NetMonitorView.Sidebar.toggle(false);
    $("#details-pane-toggle").disabled = true;

    this.empty();
    this.refreshSummary();
  },

  /**
   * Predicates used when filtering items.
   *
   * @param object aItem
   *        The filtered item.
   * @return boolean
   *         True if the item should be visible, false otherwise.
   */
  isHtml: function({ attachment: { mimeType } }) {
    return mimeType && mimeType.includes("/html");
  },

  isCss: function({ attachment: { mimeType } }) {
    return mimeType && mimeType.includes("/css");
  },

  isJs: function({ attachment: { mimeType } }) {
    return mimeType && (
      mimeType.includes("/ecmascript") ||
      mimeType.includes("/javascript") ||
      mimeType.includes("/x-javascript"));
  },

  isXHR: function({ attachment: { isXHR } }) {
    return isXHR;
  },

  isFont: function({ attachment: { url, mimeType } }) {
    // Fonts are a mess.
    return (mimeType && (
        mimeType.includes("font/") ||
        mimeType.includes("/font"))) ||
      url.includes(".eot") ||
      url.includes(".ttf") ||
      url.includes(".otf") ||
      url.includes(".woff");
  },

  isImage: function({ attachment: { mimeType } }) {
    return mimeType && mimeType.includes("image/");
  },

  isMedia: function({ attachment: { mimeType } }) {
    // Not including images.
    return mimeType && (
      mimeType.includes("audio/") ||
      mimeType.includes("video/") ||
      mimeType.includes("model/"));
  },

  isFlash: function({ attachment: { url, mimeType } }) {
    // Flash is a mess.
    return (mimeType && (
        mimeType.includes("/x-flv") ||
        mimeType.includes("/x-shockwave-flash"))) ||
      url.includes(".swf") ||
      url.includes(".flv");
  },

  isOther: function(e) {
    return !this.isHtml(e) &&
           !this.isCss(e) &&
           !this.isJs(e) &&
           !this.isXHR(e) &&
           !this.isFont(e) &&
           !this.isImage(e) &&
           !this.isMedia(e) &&
           !this.isFlash(e);
  },

  isFreetextMatch: function({ attachment: { url } }, text) {
    let lowerCaseUrl = url.toLowerCase();
    let lowerCaseText = text.toLowerCase();
    //no text is a positive match
    return !text || lowerCaseUrl.includes(lowerCaseText);
  },

  /**
   * Predicates used when sorting items.
   *
   * @param object aFirst
   *        The first item used in the comparison.
   * @param object aSecond
   *        The second item used in the comparison.
   * @return number
   *         -1 to sort aFirst to a lower index than aSecond
   *          0 to leave aFirst and aSecond unchanged with respect to each other
   *          1 to sort aSecond to a lower index than aFirst
   */
  _byTiming: function({ attachment: first }, { attachment: second }) {
    return first.startedMillis > second.startedMillis;
  },

  _byStatus: function({ attachment: first }, { attachment: second }) {
    return first.status == second.status
           ? first.startedMillis > second.startedMillis
           : first.status > second.status;
  },

  _byMethod: function({ attachment: first }, { attachment: second }) {
    return first.method == second.method
           ? first.startedMillis > second.startedMillis
           : first.method > second.method;
  },

  _byFile: function({ attachment: first }, { attachment: second }) {
    let firstUrl = this._getUriNameWithQuery(first.url).toLowerCase();
    let secondUrl = this._getUriNameWithQuery(second.url).toLowerCase();
    return firstUrl == secondUrl
      ? first.startedMillis > second.startedMillis
      : firstUrl > secondUrl;
  },

  _byDomain: function({ attachment: first }, { attachment: second }) {
    let firstDomain = this._getUriHostPort(first.url).toLowerCase();
    let secondDomain = this._getUriHostPort(second.url).toLowerCase();
    return firstDomain == secondDomain
      ? first.startedMillis > second.startedMillis
      : firstDomain > secondDomain;
  },

  _byType: function({ attachment: first }, { attachment: second }) {
    let firstType = this._getAbbreviatedMimeType(first.mimeType).toLowerCase();
    let secondType = this._getAbbreviatedMimeType(second.mimeType).toLowerCase();
    return firstType == secondType
      ? first.startedMillis > second.startedMillis
      : firstType > secondType;
  },

  _byTransferred: function({ attachment: first }, { attachment: second }) {
    return first.transferredSize > second.transferredSize;
  },

  _bySize: function({ attachment: first }, { attachment: second }) {
    return first.contentSize > second.contentSize;
  },

  /**
   * Refreshes the status displayed in this container's footer, providing
   * concise information about all requests.
   */
  refreshSummary: function() {
    let visibleItems = this.visibleItems;
    let visibleRequestsCount = visibleItems.length;
    if (!visibleRequestsCount) {
      this._summary.setAttribute("value", L10N.getStr("networkMenu.empty"));
      return;
    }

    let totalBytes = this._getTotalBytesOfRequests(visibleItems);
    let totalMillis =
      this._getNewestRequest(visibleItems).attachment.endedMillis -
      this._getOldestRequest(visibleItems).attachment.startedMillis;

    // https://developer.mozilla.org/en-US/docs/Localization_and_Plurals
    let str = PluralForm.get(visibleRequestsCount, L10N.getStr("networkMenu.summary2"));
    this._summary.setAttribute("value", str
      .replace("#1", visibleRequestsCount)
      .replace("#2", L10N.numberWithDecimals((totalBytes.contentSize || 0) / 1024, CONTENT_SIZE_DECIMALS))
      .replace("#3", L10N.numberWithDecimals((totalBytes.transferredSize || 0) / 1024, CONTENT_SIZE_DECIMALS))
      .replace("#4", L10N.numberWithDecimals((totalMillis || 0) / 1000, REQUEST_TIME_DECIMALS))
    );
  },

  /**
   * Adds odd/even attributes to all the visible items in this container.
   */
  refreshZebra: function() {
    let visibleItems = this.visibleItems;

    for (let i = 0, len = visibleItems.length; i < len; i++) {
      let requestItem = visibleItems[i];
      let requestTarget = requestItem.target;

      if (i % 2 == 0) {
        requestTarget.setAttribute("even", "");
        requestTarget.removeAttribute("odd");
      } else {
        requestTarget.setAttribute("odd", "");
        requestTarget.removeAttribute("even");
      }
    }
  },

  /**
   * Refreshes the toggling anchor for the specified item's tooltip.
   *
   * @param object aItem
   *        The network request item in this container.
   */
  refreshTooltip: function(aItem) {
    let tooltip = aItem.attachment.tooltip;
    tooltip.hide();
    tooltip.startTogglingOnHover(aItem.target, this._onHover);
    tooltip.defaultPosition = REQUESTS_TOOLTIP_POSITION;
  },

  /**
   * Attaches security icon click listener for the given request menu item.
   *
   * @param object item
   *        The network request item to attach the listener to.
   */
  attachSecurityIconClickListener: function ({ target }) {
    let icon = $(".requests-security-state-icon", target);
    icon.addEventListener("click", this._onSecurityIconClick);
  },

  /**
   * Schedules adding additional information to a network request.
   *
   * @param string aId
   *        An identifier coming from the network monitor controller.
   * @param object aData
   *        An object containing several { key: value } tuples of network info.
   *        Supported keys are "httpVersion", "status", "statusText" etc.
   * @param function aCallback
   *        A function to call once the request has been updated in the view.
   */
  updateRequest: function(aId, aData, aCallback) {
    this._updateQueue.push([aId, aData, aCallback]);

    // Lazy updating is disabled in some tests.
    if (!this.lazyUpdate) {
      return void this._flushRequests();
    }

    this._flushRequestsTask.arm();
  },

  /**
   * Starts adding all queued additional information about network requests.
   */
  _flushRequests: function() {
    // Prevent displaying any updates received after the target closed.
    if (NetMonitorView._isDestroyed) {
      return;
    }

    let widget = NetMonitorView.RequestsMenu.widget;
    let isScrolledToBottom = widget.isScrolledToBottom();

    for (let [id, startedDateTime, method, url, isXHR, fromCache] of this._addQueue) {
      // Convert the received date/time string to a unix timestamp.
      let unixTime = Date.parse(startedDateTime);

      // Create the element node for the network request item.
      let menuView = this._createMenuView(method, url);

      // Remember the first and last event boundaries.
      this._registerFirstRequestStart(unixTime);
      this._registerLastRequestEnd(unixTime);

      // Append a network request item to this container.
      let requestItem = this.push([menuView, id], {
        attachment: {
          startedDeltaMillis: unixTime - this._firstRequestStartedMillis,
          startedMillis: unixTime,
          method: method,
          url: url,
          isXHR: isXHR,
          fromCache: fromCache
        }
      });

      // Create a tooltip for the newly appended network request item.
      let requestTooltip = requestItem.attachment.tooltip = new Tooltip(document, {
        closeOnEvents: [{
          emitter: $("#requests-menu-contents"),
          event: "scroll",
          useCapture: true
        }]
      });

      this.refreshTooltip(requestItem);

      if (id == this._preferredItemId) {
        this.selectedItem = requestItem;
      }

      window.emit(EVENTS.REQUEST_ADDED, id);
    }

    if (isScrolledToBottom && this._addQueue.length) {
      widget.scrollToBottom();
    }

    // For each queued additional information packet, get the corresponding
    // request item in the view and update it based on the specified data.
    for (let [id, data, callback] of this._updateQueue) {
      let requestItem = this.getItemByValue(id);
      if (!requestItem) {
        // Packet corresponds to a dead request item, target navigated.
        continue;
      }

      // Each information packet may contain several { key: value } tuples of
      // network info, so update the view based on each one.
      for (let key in data) {
        let value = data[key];
        if (value === undefined) {
          // The information in the packet is empty, it can be safely ignored.
          continue;
        }

        switch (key) {
          case "requestHeaders":
            requestItem.attachment.requestHeaders = value;
            break;
          case "requestCookies":
            requestItem.attachment.requestCookies = value;
            break;
          case "requestPostData":
            // Search the POST data upload stream for request headers and add
            // them to a separate store, different from the classic headers.
            // XXX: Be really careful here! We're creating a function inside
            // a loop, so remember the actual request item we want to modify.
            let currentItem = requestItem;
            let currentStore = { headers: [], headersSize: 0 };

            Task.spawn(function*() {
              let postData = yield gNetwork.getString(value.postData.text);
              let payloadHeaders = CurlUtils.getHeadersFromMultipartText(postData);

              currentStore.headers = payloadHeaders;
              currentStore.headersSize = payloadHeaders.reduce(
                (acc, { name, value }) => acc + name.length + value.length + 2, 0);

              // The `getString` promise is async, so we need to refresh the
              // information displayed in the network details pane again here.
              refreshNetworkDetailsPaneIfNecessary(currentItem);
            });

            requestItem.attachment.requestPostData = value;
            requestItem.attachment.requestHeadersFromUploadStream = currentStore;
            break;
          case "securityState":
            requestItem.attachment.securityState = value;
            this.updateMenuView(requestItem, key, value);
            break;
          case "securityInfo":
            requestItem.attachment.securityInfo = value;
            break;
          case "responseHeaders":
            requestItem.attachment.responseHeaders = value;
            break;
          case "responseCookies":
            requestItem.attachment.responseCookies = value;
            break;
          case "httpVersion":
            requestItem.attachment.httpVersion = value;
            break;
          case "remoteAddress":
            requestItem.attachment.remoteAddress = value;
            this.updateMenuView(requestItem, key, value);
            break;
          case "remotePort":
            requestItem.attachment.remotePort = value;
            break;
          case "status":
            requestItem.attachment.status = value;
            this.updateMenuView(requestItem, key, {
              status: value,
              cached: requestItem.attachment.fromCache
            });
            break;
          case "statusText":
            requestItem.attachment.statusText = value;
            let text = (requestItem.attachment.status + " " +
                        requestItem.attachment.statusText);
            if(requestItem.attachment.fromCache) {
              text += " (cached)";
            }

            this.updateMenuView(requestItem, key, text);
            break;
          case "headersSize":
            requestItem.attachment.headersSize = value;
            break;
          case "contentSize":
            requestItem.attachment.contentSize = value;
            this.updateMenuView(requestItem, key, value);
            break;
          case "transferredSize":
            if(requestItem.attachment.fromCache) {
              requestItem.attachment.transferredSize = 0;
              this.updateMenuView(requestItem, key, 'cached');
            }
            else {
              requestItem.attachment.transferredSize = value;
              this.updateMenuView(requestItem, key, value);
            }
            break;
          case "mimeType":
            requestItem.attachment.mimeType = value;
            this.updateMenuView(requestItem, key, value);
            break;
          case "responseContent":
            // If there's no mime type available when the response content
            // is received, assume text/plain as a fallback.
            if (!requestItem.attachment.mimeType) {
              requestItem.attachment.mimeType = "text/plain";
              this.updateMenuView(requestItem, "mimeType", "text/plain");
            }
            requestItem.attachment.responseContent = value;
            this.updateMenuView(requestItem, key, value);
            break;
          case "totalTime":
            requestItem.attachment.totalTime = value;
            requestItem.attachment.endedMillis = requestItem.attachment.startedMillis + value;
            this.updateMenuView(requestItem, key, value);
            this._registerLastRequestEnd(requestItem.attachment.endedMillis);
            break;
          case "eventTimings":
            requestItem.attachment.eventTimings = value;
            this._createWaterfallView(
              requestItem, value.timings, requestItem.attachment.fromCache
            );
            break;
        }
      }
      refreshNetworkDetailsPaneIfNecessary(requestItem);

      if (callback) {
        callback();
      }
    }

    /**
     * Refreshes the information displayed in the sidebar, in case this update
     * may have additional information about a request which isn't shown yet
     * in the network details pane.
     *
     * @param object aRequestItem
     *        The item to repopulate the sidebar with in case it's selected in
     *        this requests menu.
     */
    function refreshNetworkDetailsPaneIfNecessary(aRequestItem) {
      let selectedItem = NetMonitorView.RequestsMenu.selectedItem;
      if (selectedItem == aRequestItem) {
        NetMonitorView.NetworkDetails.populate(selectedItem.attachment);
      }
    }

    // We're done flushing all the requests, clear the update queue.
    this._updateQueue = [];
    this._addQueue = [];

    $("#details-pane-toggle").disabled = !this.itemCount;
    $("#requests-menu-empty-notice").hidden = !!this.itemCount;

    // Make sure all the requests are sorted and filtered.
    // Freshly added requests may not yet contain all the information required
    // for sorting and filtering predicates, so this is done each time the
    // network requests table is flushed (don't worry, events are drained first
    // so this doesn't happen once per network event update).
    this.sortContents();
    this.filterContents();
    this.refreshSummary();
    this.refreshZebra();

    // Rescale all the waterfalls so that everything is visible at once.
    this._flushWaterfallViews();
  },

  /**
   * Customization function for creating an item's UI.
   *
   * @param string aMethod
   *        Specifies the request method (e.g. "GET", "POST", etc.)
   * @param string aUrl
   *        Specifies the request's url.
   * @return nsIDOMNode
   *         The network request view.
   */
  _createMenuView: function(aMethod, aUrl) {
    let template = $("#requests-menu-item-template");
    let fragment = document.createDocumentFragment();

    this.updateMenuView(template, 'method', aMethod);
    this.updateMenuView(template, 'url', aUrl);

    // Flatten the DOM by removing one redundant box (the template container).
    for (let node of template.childNodes) {
      fragment.appendChild(node.cloneNode(true));
    }

    return fragment;
  },

  /**
   * Updates the information displayed in a network request item view.
   *
   * @param object aItem
   *        The network request item in this container.
   * @param string aKey
   *        The type of information that is to be updated.
   * @param any aValue
   *        The new value to be shown.
   * @return object
   *         A promise that is resolved once the information is displayed.
   */
  updateMenuView: Task.async(function*(aItem, aKey, aValue) {
    let target = aItem.target || aItem;

    switch (aKey) {
      case "method": {
        let node = $(".requests-menu-method", target);
        node.setAttribute("value", aValue);
        break;
      }
      case "url": {
        let uri;
        try {
          uri = NetworkHelper.nsIURL(aValue);
        } catch(e) {
          break; // User input may not make a well-formed url yet.
        }
        let nameWithQuery = this._getUriNameWithQuery(uri);
        let hostPort = this._getUriHostPort(uri);
        let unicodeUrl = NetworkHelper.convertToUnicode(unescape(uri.spec));

        let file = $(".requests-menu-file", target);
        file.setAttribute("value", nameWithQuery);
        file.setAttribute("tooltiptext", unicodeUrl);

        let domain = $(".requests-menu-domain", target);
        domain.setAttribute("value", hostPort);
        domain.setAttribute("tooltiptext", hostPort);
        break;
      }
      case "remoteAddress":
        let domain = $(".requests-menu-domain", target);
        let tooltip = (domain.getAttribute("value") +
                       (aValue ? " (" + aValue + ")" : ""));
        domain.setAttribute("tooltiptext", tooltip);
        break;
      case "securityState": {
        let tooltip = L10N.getStr("netmonitor.security.state." + aValue);
        let icon = $(".requests-security-state-icon", target);
        icon.classList.add("security-state-" + aValue);
        icon.setAttribute("tooltiptext", tooltip);

        this.attachSecurityIconClickListener(aItem);
        break;
      }
      case "status": {
        let node = $(".requests-menu-status", target);
        node.setAttribute("code", aValue.cached ? "cached" : aValue.status);
        let codeNode = $(".requests-menu-status-code", target);
        codeNode.setAttribute("value", aValue.status);
        break;
      }
      case "statusText": {
        let node = $(".requests-menu-status-and-method", target);
        node.setAttribute("tooltiptext", aValue);
        break;
      }
      case "contentSize": {
        let kb = aValue / 1024;
        let size = L10N.numberWithDecimals(kb, CONTENT_SIZE_DECIMALS);
        let node = $(".requests-menu-size", target);
        let text = L10N.getFormatStr("networkMenu.sizeKB", size);
        node.setAttribute("value", text);
        node.setAttribute("tooltiptext", text);
        break;
      }
      case "transferredSize": {
        let node = $(".requests-menu-transferred", target);

        let text;
        if (aValue === null) {
          text = L10N.getStr("networkMenu.sizeUnavailable");
        }
        else if(aValue === "cached") {
          text = aValue;
          node.classList.add('theme-comment');
        }
        else {
          let kb = aValue / 1024;
          let size = L10N.numberWithDecimals(kb, CONTENT_SIZE_DECIMALS);
          text = L10N.getFormatStr("networkMenu.sizeKB", size);
        }

        node.setAttribute("value", text);
        node.setAttribute("tooltiptext", text);
        break;
      }
      case "mimeType": {
        let type = this._getAbbreviatedMimeType(aValue);
        let node = $(".requests-menu-type", target);
        let text = CONTENT_MIME_TYPE_ABBREVIATIONS[type] || type;
        node.setAttribute("value", text);
        node.setAttribute("tooltiptext", aValue);
        break;
      }
      case "responseContent": {
        let { mimeType } = aItem.attachment;

        if (mimeType.includes("image/")) {
          let { text, encoding } = aValue.content;
          let responseBody = yield gNetwork.getString(text);
          let node = $(".requests-menu-icon", aItem.target);
          node.src = "data:" + mimeType + ";" + encoding + "," + responseBody;
          node.setAttribute("type", "thumbnail");
          node.removeAttribute("hidden");

          window.emit(EVENTS.RESPONSE_IMAGE_THUMBNAIL_DISPLAYED);
        }
        break;
      }
      case "totalTime": {
        let node = $(".requests-menu-timings-total", target);
        let text = L10N.getFormatStr("networkMenu.totalMS", aValue); // integer
        node.setAttribute("value", text);
        node.setAttribute("tooltiptext", text);
        break;
      }
    }
  }),

  /**
   * Creates a waterfall representing timing information in a network request item view.
   *
   * @param object aItem
   *        The network request item in this container.
   * @param object aTimings
   *        An object containing timing information.
   * @param boolean aFromCache
   *        Indicates if the result came from the browser cache
   */
  _createWaterfallView: function(aItem, aTimings, aFromCache) {
    let { target, attachment } = aItem;
    let sections = ["dns", "connect", "send", "wait", "receive"];
    // Skipping "blocked" because it doesn't work yet.

    let timingsNode = $(".requests-menu-timings", target);
    let timingsTotal = $(".requests-menu-timings-total", timingsNode);

    if(aFromCache) {
      timingsTotal.style.display = 'none';
      return;
    }

    // Add a set of boxes representing timing information.
    for (let key of sections) {
      let width = aTimings[key];

      // Don't render anything if it surely won't be visible.
      // One millisecond == one unscaled pixel.
      if (width > 0) {
        let timingBox = document.createElement("hbox");
        timingBox.className = "requests-menu-timings-box " + key;
        timingBox.setAttribute("width", width);
        timingsNode.insertBefore(timingBox, timingsTotal);
      }
    }
  },

  /**
   * Rescales and redraws all the waterfall views in this container.
   *
   * @param boolean aReset
   *        True if this container's width was changed.
   */
  _flushWaterfallViews: function(aReset) {
    // Don't paint things while the waterfall view isn't even visible,
    // or there are no items added to this container.
    if (NetMonitorView.currentFrontendMode != "network-inspector-view" || !this.itemCount) {
      return;
    }

    // To avoid expensive operations like getBoundingClientRect() and
    // rebuilding the waterfall background each time a new request comes in,
    // stuff is cached. However, in certain scenarios like when the window
    // is resized, this needs to be invalidated.
    if (aReset) {
      this._cachedWaterfallWidth = 0;
    }

    // Determine the scaling to be applied to all the waterfalls so that
    // everything is visible at once. One millisecond == one unscaled pixel.
    let availableWidth = this._waterfallWidth - REQUESTS_WATERFALL_SAFE_BOUNDS;
    let longestWidth = this._lastRequestEndedMillis - this._firstRequestStartedMillis;
    let scale = Math.min(Math.max(availableWidth / longestWidth, EPSILON), 1);

    // Redraw and set the canvas background for each waterfall view.
    this._showWaterfallDivisionLabels(scale);
    this._drawWaterfallBackground(scale);

    // Apply CSS transforms to each waterfall in this container totalTime
    // accurately translate and resize as needed.
    for (let { target, attachment } of this) {
      let timingsNode = $(".requests-menu-timings", target);
      let totalNode = $(".requests-menu-timings-total", target);
      let direction = window.isRTL ? -1 : 1;

      // Render the timing information at a specific horizontal translation
      // based on the delta to the first monitored event network.
      let translateX = "translateX(" + (direction * attachment.startedDeltaMillis) + "px)";

      // Based on the total time passed until the last request, rescale
      // all the waterfalls to a reasonable size.
      let scaleX = "scaleX(" + scale + ")";

      // Certain nodes should not be scaled, even if they're children of
      // another scaled node. In this case, apply a reversed transformation.
      let revScaleX = "scaleX(" + (1 / scale) + ")";

      timingsNode.style.transform = scaleX + " " + translateX;
      totalNode.style.transform = revScaleX;
    }
  },

  /**
   * Creates the labels displayed on the waterfall header in this container.
   *
   * @param number aScale
   *        The current waterfall scale.
   */
  _showWaterfallDivisionLabels: function(aScale) {
    let container = $("#requests-menu-waterfall-button");
    let availableWidth = this._waterfallWidth - REQUESTS_WATERFALL_SAFE_BOUNDS;

    // Nuke all existing labels.
    while (container.hasChildNodes()) {
      container.firstChild.remove();
    }

    // Build new millisecond tick labels...
    let timingStep = REQUESTS_WATERFALL_HEADER_TICKS_MULTIPLE;
    let optimalTickIntervalFound = false;

    while (!optimalTickIntervalFound) {
      // Ignore any divisions that would end up being too close to each other.
      let scaledStep = aScale * timingStep;
      if (scaledStep < REQUESTS_WATERFALL_HEADER_TICKS_SPACING_MIN) {
        timingStep <<= 1;
        continue;
      }
      optimalTickIntervalFound = true;

      // Insert one label for each division on the current scale.
      let fragment = document.createDocumentFragment();
      let direction = window.isRTL ? -1 : 1;

      for (let x = 0; x < availableWidth; x += scaledStep) {
        let translateX = "translateX(" + ((direction * x) | 0) + "px)";
        let millisecondTime = x / aScale;

        let normalizedTime = millisecondTime;
        let divisionScale = "millisecond";

        // If the division is greater than 1 minute.
        if (normalizedTime > 60000) {
          normalizedTime /= 60000;
          divisionScale = "minute";
        }
        // If the division is greater than 1 second.
        else if (normalizedTime > 1000) {
          normalizedTime /= 1000;
          divisionScale = "second";
        }

        // Showing too many decimals is bad UX.
        if (divisionScale == "millisecond") {
          normalizedTime |= 0;
        } else {
          normalizedTime = L10N.numberWithDecimals(normalizedTime, REQUEST_TIME_DECIMALS);
        }

        let node = document.createElement("label");
        let text = L10N.getFormatStr("networkMenu." + divisionScale, normalizedTime);
        node.className = "plain requests-menu-timings-division";
        node.setAttribute("division-scale", divisionScale);
        node.style.transform = translateX;

        node.setAttribute("value", text);
        fragment.appendChild(node);
      }
      container.appendChild(fragment);
    }
  },

  /**
   * Creates the background displayed on each waterfall view in this container.
   *
   * @param number aScale
   *        The current waterfall scale.
   */
  _drawWaterfallBackground: function(aScale) {
    if (!this._canvas || !this._ctx) {
      this._canvas = document.createElementNS(HTML_NS, "canvas");
      this._ctx = this._canvas.getContext("2d");
    }
    let canvas = this._canvas;
    let ctx = this._ctx;

    // Nuke the context.
    let canvasWidth = canvas.width = this._waterfallWidth;
    let canvasHeight = canvas.height = 1; // Awww yeah, 1px, repeats on Y axis.

    // Start over.
    let imageData = ctx.createImageData(canvasWidth, canvasHeight);
    let pixelArray = imageData.data;

    let buf = new ArrayBuffer(pixelArray.length);
    let view8bit = new Uint8ClampedArray(buf);
    let view32bit = new Uint32Array(buf);

    // Build new millisecond tick lines...
    let timingStep = REQUESTS_WATERFALL_BACKGROUND_TICKS_MULTIPLE;
    let [r, g, b] = REQUESTS_WATERFALL_BACKGROUND_TICKS_COLOR_RGB;
    let alphaComponent = REQUESTS_WATERFALL_BACKGROUND_TICKS_OPACITY_MIN;
    let optimalTickIntervalFound = false;

    while (!optimalTickIntervalFound) {
      // Ignore any divisions that would end up being too close to each other.
      let scaledStep = aScale * timingStep;
      if (scaledStep < REQUESTS_WATERFALL_BACKGROUND_TICKS_SPACING_MIN) {
        timingStep <<= 1;
        continue;
      }
      optimalTickIntervalFound = true;

      // Insert one pixel for each division on each scale.
      for (let i = 1; i <= REQUESTS_WATERFALL_BACKGROUND_TICKS_SCALES; i++) {
        let increment = scaledStep * Math.pow(2, i);
        for (let x = 0; x < canvasWidth; x += increment) {
          let position = (window.isRTL ? canvasWidth - x : x) | 0;
          view32bit[position] = (alphaComponent << 24) | (b << 16) | (g << 8) | r;
        }
        alphaComponent += REQUESTS_WATERFALL_BACKGROUND_TICKS_OPACITY_ADD;
      }
    }

    {
      let t = NetMonitorController.NetworkEventsHandler.firstDocumentDOMContentLoadedTimestamp;
      let delta = Math.floor((t - this._firstRequestStartedMillis) * aScale);
      let [r, g, b, a] = REQUESTS_WATERFALL_DOMCONTENTLOADED_TICKS_COLOR_RGBA;
      view32bit[delta] = (a << 24) | (r << 16) | (g << 8) | b;
    }
    {
      let t = NetMonitorController.NetworkEventsHandler.firstDocumentLoadTimestamp;
      let delta = Math.floor((t - this._firstRequestStartedMillis) * aScale);
      let [r, g, b, a] = REQUESTS_WATERFALL_LOAD_TICKS_COLOR_RGBA;
      view32bit[delta] = (a << 24) | (r << 16) | (g << 8) | b;
    }

    // Flush the image data and cache the waterfall background.
    pixelArray.set(view8bit);
    ctx.putImageData(imageData, 0, 0);
    document.mozSetImageElement("waterfall-background", canvas);
  },

  /**
   * The selection listener for this container.
   */
  _onSelect: function({ detail: item }) {
    if (item) {
      NetMonitorView.Sidebar.populate(item.attachment);
      NetMonitorView.Sidebar.toggle(true);
    } else {
      NetMonitorView.Sidebar.toggle(false);
    }
  },

  /**
   * The swap listener for this container.
   * Called when two items switch places, when the contents are sorted.
   */
  _onSwap: function({ detail: [firstItem, secondItem] }) {
    // Sorting will create new anchor nodes for all the swapped request items
    // in this container, so it's necessary to refresh the Tooltip instances.
    this.refreshTooltip(firstItem);
    this.refreshTooltip(secondItem);

    // Reattach click listener to the security icons
    this.attachSecurityIconClickListener(firstItem);
    this.attachSecurityIconClickListener(secondItem);

  },

  /**
   * The predicate used when deciding whether a popup should be shown
   * over a request item or not.
   *
   * @param nsIDOMNode aTarget
   *        The element node currently being hovered.
   * @param object aTooltip
   *        The current tooltip instance.
   */
  _onHover: function(aTarget, aTooltip) {
    let requestItem = this.getItemForElement(aTarget);
    if (!requestItem || !requestItem.attachment.responseContent) {
      return;
    }

    let hovered = requestItem.attachment;
    let { url } = hovered;
    let { mimeType, text, encoding } = hovered.responseContent.content;

    if (mimeType && mimeType.includes("image/") && (
      aTarget.classList.contains("requests-menu-icon") ||
      aTarget.classList.contains("requests-menu-file")))
    {
      return gNetwork.getString(text).then(aString => {
        let anchor = $(".requests-menu-icon", requestItem.target);
        let src = "data:" + mimeType + ";" + encoding + "," + aString;
        aTooltip.setImageContent(src, { maxDim: REQUESTS_TOOLTIP_IMAGE_MAX_DIM });
        return anchor;
      });
    }
  },

  /**
   * A handler that opens the security tab in the details view if secure or
   * broken security indicator is clicked.
   */
  _onSecurityIconClick: function(e) {
    let state = this.selectedItem.attachment.securityState;
    if (state !== "insecure") {
      // Choose the security tab.
      NetMonitorView.NetworkDetails.widget.selectedIndex = 5;
    }
  },

  /**
   * The resize listener for this container's window.
   */
  _onResize: function(e) {
    // Allow requests to settle down first.
    setNamedTimeout(
      "resize-events", RESIZE_REFRESH_RATE, () => this._flushWaterfallViews(true));
  },

  /**
   * Handle the context menu opening. Hide items if no request is selected.
   */
  _onContextShowing: function() {
    let selectedItem = this.selectedItem;

    let resendElement = $("#request-menu-context-resend");
    resendElement.hidden = !NetMonitorController.supportsCustomRequest ||
      !selectedItem || selectedItem.attachment.isCustom;

    let copyUrlElement = $("#request-menu-context-copy-url");
    copyUrlElement.hidden = !selectedItem;

    let copyUrlParamsElement = $("#request-menu-context-copy-url-params");
    copyUrlParamsElement.hidden = !selectedItem || !NetworkHelper.nsIURL(selectedItem.attachment.url).query;

    let copyPostDataElement = $("#request-menu-context-copy-post-data");
    copyPostDataElement.hidden = !selectedItem || !selectedItem.attachment.requestPostData;

    let copyAsCurlElement = $("#request-menu-context-copy-as-curl");
    copyAsCurlElement.hidden = !selectedItem || !selectedItem.attachment.responseContent;

    let copyRequestHeadersElement = $("#request-menu-context-copy-request-headers");
    copyRequestHeadersElement.hidden = !selectedItem || !selectedItem.attachment.requestHeaders;

    let copyResponseHeadersElement = $("#response-menu-context-copy-response-headers");
    copyResponseHeadersElement.hidden = !selectedItem || !selectedItem.attachment.responseHeaders;

    let copyResponse = $("#request-menu-context-copy-response");
    copyResponse.hidden = !selectedItem ||
      !selectedItem.attachment.responseContent ||
      !selectedItem.attachment.responseContent.content.text ||
      selectedItem.attachment.responseContent.content.text.length === 0;

    let copyImageAsDataUriElement = $("#request-menu-context-copy-image-as-data-uri");
    copyImageAsDataUriElement.hidden = !selectedItem ||
      !selectedItem.attachment.responseContent ||
      !selectedItem.attachment.responseContent.content.mimeType.includes("image/");

    let separators = $all(".request-menu-context-separator");
    Array.forEach(separators, separator => separator.hidden = !selectedItem);

    let copyAsHar = $("#request-menu-context-copy-all-as-har");
    copyAsHar.hidden = !NetMonitorView.RequestsMenu.items.length;

    let saveAsHar = $("#request-menu-context-save-all-as-har");
    saveAsHar.hidden = !NetMonitorView.RequestsMenu.items.length;

    let newTabElement = $("#request-menu-context-newtab");
    newTabElement.hidden = !selectedItem;
  },

  /**
   * Checks if the specified unix time is the first one to be known of,
   * and saves it if so.
   *
   * @param number aUnixTime
   *        The milliseconds to check and save.
   */
  _registerFirstRequestStart: function(aUnixTime) {
    if (this._firstRequestStartedMillis == -1) {
      this._firstRequestStartedMillis = aUnixTime;
    }
  },

  /**
   * Checks if the specified unix time is the last one to be known of,
   * and saves it if so.
   *
   * @param number aUnixTime
   *        The milliseconds to check and save.
   */
  _registerLastRequestEnd: function(aUnixTime) {
    if (this._lastRequestEndedMillis < aUnixTime) {
      this._lastRequestEndedMillis = aUnixTime;
    }
  },

  /**
   * Helpers for getting details about an nsIURL.
   *
   * @param nsIURL | string aUrl
   * @return string
   */
  _getUriNameWithQuery: function(aUrl) {
    if (!(aUrl instanceof Ci.nsIURL)) {
      aUrl = NetworkHelper.nsIURL(aUrl);
    }
    let name = NetworkHelper.convertToUnicode(unescape(aUrl.fileName || aUrl.filePath || "/"));
    let query = NetworkHelper.convertToUnicode(unescape(aUrl.query));
    return name + (query ? "?" + query : "");
  },
  _getUriHostPort: function(aUrl) {
    if (!(aUrl instanceof Ci.nsIURL)) {
      aUrl = NetworkHelper.nsIURL(aUrl);
    }
    return NetworkHelper.convertToUnicode(unescape(aUrl.hostPort));
  },

  /**
   * Helper for getting an abbreviated string for a mime type.
   *
   * @param string aMimeType
   * @return string
   */
  _getAbbreviatedMimeType: function(aMimeType) {
    if (!aMimeType) {
      return "";
    }
    return (aMimeType.split(";")[0].split("/")[1] || "").split("+")[0];
  },

  /**
   * Gets the total number of bytes representing the cumulated
   * content and transferred size of a set of requests.
   * Returns 0 for an empty set.
   *
   * @param array aItemsArray
   * @return object {contentSize: number, transferredSize: number}
   */
  _getTotalBytesOfRequests: function(aItemsArray) {
    let contentSize = 0;
    let transferredSize = 0;

    let result = {
      contentSize: contentSize,
      transferredSize: transferredSize,
    };
    if (!aItemsArray.length) {
      return result;
    }

    aItemsArray.forEach(item => {
      let size;
      size = item.attachment.contentSize;
      contentSize += (typeof size == "number") ? size : 0;
      result.contentSize = contentSize;
      size = item.attachment.transferredSize;
      transferredSize += (typeof size == "number") ? size : 0;
      result.transferredSize = transferredSize;
    });

    return result;
  },

  /**
   * Gets the oldest (first performed) request in a set. Returns null for an
   * empty set.
   *
   * @param array aItemsArray
   * @return object
   */
  _getOldestRequest: function(aItemsArray) {
    if (!aItemsArray.length) {
      return null;
    }
    return aItemsArray.reduce((prev, curr) =>
      prev.attachment.startedMillis < curr.attachment.startedMillis ? prev : curr);
  },

  /**
   * Gets the newest (latest performed) request in a set. Returns null for an
   * empty set.
   *
   * @param array aItemsArray
   * @return object
   */
  _getNewestRequest: function(aItemsArray) {
    if (!aItemsArray.length) {
      return null;
    }
    return aItemsArray.reduce((prev, curr) =>
      prev.attachment.startedMillis > curr.attachment.startedMillis ? prev : curr);
  },

  /**
   * Gets the available waterfall width in this container.
   * @return number
   */
  get _waterfallWidth() {
    if (this._cachedWaterfallWidth == 0) {
      let container = $("#requests-menu-toolbar");
      let waterfall = $("#requests-menu-waterfall-header-box");
      let containerBounds = container.getBoundingClientRect();
      let waterfallBounds = waterfall.getBoundingClientRect();
      if (!window.isRTL) {
        this._cachedWaterfallWidth = containerBounds.width - waterfallBounds.left;
      } else {
        this._cachedWaterfallWidth = waterfallBounds.right;
      }
    }
    return this._cachedWaterfallWidth;
  },

  _splitter: null,
  _summary: null,
  _canvas: null,
  _ctx: null,
  _cachedWaterfallWidth: 0,
  _firstRequestStartedMillis: -1,
  _lastRequestEndedMillis: -1,
  _updateQueue: [],
  _addQueue: [],
  _updateTimeout: null,
  _resizeTimeout: null,
  _activeFilters: ["all"],
  _currentFreetextFilter: ""
});

/**
 * Functions handling the sidebar details view.
 */
function SidebarView() {
  dumpn("SidebarView was instantiated");
}

SidebarView.prototype = {
  /**
   * Sets this view hidden or visible. It's visible by default.
   *
   * @param boolean aVisibleFlag
   *        Specifies the intended visibility.
   */
  toggle: function(aVisibleFlag) {
    NetMonitorView.toggleDetailsPane({ visible: aVisibleFlag });
    NetMonitorView.RequestsMenu._flushWaterfallViews(true);
  },

  /**
   * Populates this view with the specified data.
   *
   * @param object aData
   *        The data source (this should be the attachment of a request item).
   * @return object
   *        Returns a promise that resolves upon population of the subview.
   */
  populate: Task.async(function*(aData) {
    let isCustom = aData.isCustom;
    let view = isCustom ?
      NetMonitorView.CustomRequest :
      NetMonitorView.NetworkDetails;

    yield view.populate(aData);
    $("#details-pane").selectedIndex = isCustom ? 0 : 1;

    window.emit(EVENTS.SIDEBAR_POPULATED);
  })
}

/**
 * Functions handling the custom request view.
 */
function CustomRequestView() {
  dumpn("CustomRequestView was instantiated");
}

CustomRequestView.prototype = {
  /**
   * Initialization function, called when the network monitor is started.
   */
  initialize: function() {
    dumpn("Initializing the CustomRequestView");

    this.updateCustomRequestEvent = getKeyWithEvent(this.onUpdate.bind(this));
    $("#custom-pane").addEventListener("input", this.updateCustomRequestEvent, false);
  },

  /**
   * Destruction function, called when the network monitor is closed.
   */
  destroy: function() {
    dumpn("Destroying the CustomRequestView");

    $("#custom-pane").removeEventListener("input", this.updateCustomRequestEvent, false);
  },

  /**
   * Populates this view with the specified data.
   *
   * @param object aData
   *        The data source (this should be the attachment of a request item).
   * @return object
   *        Returns a promise that resolves upon population the view.
   */
  populate: Task.async(function*(aData) {
    $("#custom-url-value").value = aData.url;
    $("#custom-method-value").value = aData.method;
    this.updateCustomQuery(aData.url);

    if (aData.requestHeaders) {
      let headers = aData.requestHeaders.headers;
      $("#custom-headers-value").value = writeHeaderText(headers);
    }
    if (aData.requestPostData) {
      let postData = aData.requestPostData.postData.text;
      $("#custom-postdata-value").value = yield gNetwork.getString(postData);
    }

    window.emit(EVENTS.CUSTOMREQUESTVIEW_POPULATED);
  }),

  /**
   * Handle user input in the custom request form.
   *
   * @param object aField
   *        the field that the user updated.
   */
  onUpdate: function(aField) {
    let selectedItem = NetMonitorView.RequestsMenu.selectedItem;
    let field = aField;
    let value;

    switch(aField) {
      case 'method':
        value = $("#custom-method-value").value.trim();
        selectedItem.attachment.method = value;
        break;
      case 'url':
        value = $("#custom-url-value").value;
        this.updateCustomQuery(value);
        selectedItem.attachment.url = value;
        break;
      case 'query':
        let query = $("#custom-query-value").value;
        this.updateCustomUrl(query);
        field = 'url';
        value = $("#custom-url-value").value
        selectedItem.attachment.url = value;
        break;
      case 'body':
        value = $("#custom-postdata-value").value;
        selectedItem.attachment.requestPostData = { postData: { text: value } };
        break;
      case 'headers':
        let headersText = $("#custom-headers-value").value;
        value = parseHeadersText(headersText);
        selectedItem.attachment.requestHeaders = { headers: value };
        break;
    }

    NetMonitorView.RequestsMenu.updateMenuView(selectedItem, field, value);
  },

  /**
   * Update the query string field based on the url.
   *
   * @param object aUrl
   *        The URL to extract query string from.
   */
  updateCustomQuery: function(aUrl) {
    let paramsArray = NetworkHelper.parseQueryString(NetworkHelper.nsIURL(aUrl).query);
    if (!paramsArray) {
      $("#custom-query").hidden = true;
      return;
    }
    $("#custom-query").hidden = false;
    $("#custom-query-value").value = writeQueryText(paramsArray);
  },

  /**
   * Update the url based on the query string field.
   *
   * @param object aQueryText
   *        The contents of the query string field.
   */
  updateCustomUrl: function(aQueryText) {
    let params = parseQueryText(aQueryText);
    let queryString = writeQueryString(params);

    let url = $("#custom-url-value").value;
    let oldQuery = NetworkHelper.nsIURL(url).query;
    let path = url.replace(oldQuery, queryString);

    $("#custom-url-value").value = path;
  }
}

/**
 * Functions handling the requests details view.
 */
function NetworkDetailsView() {
  dumpn("NetworkDetailsView was instantiated");

  // The ToolSidebar requires the panel object to be able to emit events.
  EventEmitter.decorate(this);

  this._onTabSelect = this._onTabSelect.bind(this);
};

NetworkDetailsView.prototype = {
  /**
   * An object containing the state of tabs.
   */
  _viewState: {
    // if updating[tab] is true a task is currently updating the given tab.
    updating: [],
    // if dirty[tab] is true, the tab needs to be repopulated once current
    // update task finishes
    dirty: [],
    // the most recently received attachment data for the request
    latestData: null,
  },

  /**
   * Initialization function, called when the network monitor is started.
   */
  initialize: function() {
    dumpn("Initializing the NetworkDetailsView");

    this.widget = $("#event-details-pane");
    this.sidebar = new ToolSidebar(this.widget, this, "netmonitor", {
      disableTelemetry: true,
      showAllTabsMenu: true
    });

    this._headers = new VariablesView($("#all-headers"),
      Heritage.extend(GENERIC_VARIABLES_VIEW_SETTINGS, {
        emptyText: L10N.getStr("headersEmptyText"),
        searchPlaceholder: L10N.getStr("headersFilterText")
      }));
    this._cookies = new VariablesView($("#all-cookies"),
      Heritage.extend(GENERIC_VARIABLES_VIEW_SETTINGS, {
        emptyText: L10N.getStr("cookiesEmptyText"),
        searchPlaceholder: L10N.getStr("cookiesFilterText")
      }));
    this._params = new VariablesView($("#request-params"),
      Heritage.extend(GENERIC_VARIABLES_VIEW_SETTINGS, {
        emptyText: L10N.getStr("paramsEmptyText"),
        searchPlaceholder: L10N.getStr("paramsFilterText")
      }));
    this._json = new VariablesView($("#response-content-json"),
      Heritage.extend(GENERIC_VARIABLES_VIEW_SETTINGS, {
        onlyEnumVisible: true,
        searchPlaceholder: L10N.getStr("jsonFilterText")
      }));
    VariablesViewController.attach(this._json);

    this._paramsQueryString = L10N.getStr("paramsQueryString");
    this._paramsFormData = L10N.getStr("paramsFormData");
    this._paramsPostPayload = L10N.getStr("paramsPostPayload");
    this._requestHeaders = L10N.getStr("requestHeaders");
    this._requestHeadersFromUpload = L10N.getStr("requestHeadersFromUpload");
    this._responseHeaders = L10N.getStr("responseHeaders");
    this._requestCookies = L10N.getStr("requestCookies");
    this._responseCookies = L10N.getStr("responseCookies");

    $("tabpanels", this.widget).addEventListener("select", this._onTabSelect);
  },

  /**
   * Destruction function, called when the network monitor is closed.
   */
  destroy: function() {
    dumpn("Destroying the NetworkDetailsView");
    this.sidebar.destroy();
    $("tabpanels", this.widget).removeEventListener("select", this._onTabSelect);
  },

  /**
   * Populates this view with the specified data.
   *
   * @param object aData
   *        The data source (this should be the attachment of a request item).
   * @return object
   *        Returns a promise that resolves upon population the view.
   */
  populate: function(aData) {
    $("#request-params-box").setAttribute("flex", "1");
    $("#request-params-box").hidden = false;
    $("#request-post-data-textarea-box").hidden = true;
    $("#response-content-info-header").hidden = true;
    $("#response-content-json-box").hidden = true;
    $("#response-content-textarea-box").hidden = true;
    $("#raw-headers").hidden = true;
    $("#response-content-image-box").hidden = true;

    let isHtml = RequestsMenuView.prototype.isHtml({ attachment: aData });

    // Show the "Preview" tabpanel only for plain HTML responses.
    this.sidebar.toggleTab(isHtml, "preview-tab");

    // Show the "Security" tab only for requests that
    //   1) are https (state != insecure)
    //   2) come from a target that provides security information.
    let hasSecurityInfo = aData.securityState &&
                          aData.securityState !== "insecure";
    this.sidebar.toggleTab(hasSecurityInfo, "security-tab");

    // Switch to the "Headers" tabpanel if the "Preview" previously selected
    // and this is not an HTML response or "Security" was selected but this
    // request has no security information.

    if (!isHtml && this.widget.selectedPanel === $("#preview-tabpanel") ||
        !hasSecurityInfo && this.widget.selectedPanel === $("#security-tabpanel")) {
      this.widget.selectedIndex = 0;
    }

    this._headers.empty();
    this._cookies.empty();
    this._params.empty();
    this._json.empty();

    this._dataSrc = { src: aData, populated: [] };
    this._onTabSelect();
    window.emit(EVENTS.NETWORKDETAILSVIEW_POPULATED);

    return promise.resolve();
  },

  /**
   * Listener handling the tab selection event.
   */
  _onTabSelect: function() {
    let { src, populated } = this._dataSrc || {};
    let tab = this.widget.selectedIndex;
    let view = this;

    // Make sure the data source is valid and don't populate the same tab twice.
    if (!src || populated[tab]) {
      return;
    }

    let viewState = this._viewState;
    if (viewState.updating[tab]) {
      // A task is currently updating this tab. If we started another update
      // task now it would result in a duplicated content as described in bugs
      // 997065 and 984687. As there's no way to stop the current task mark the
      // tab dirty and refresh the panel once the current task finishes.
      viewState.dirty[tab] = true;
      viewState.latestData = src;
      return;
    }

    Task.spawn(function*() {
      viewState.updating[tab] = true;
      switch (tab) {
        case 0: // "Headers"
          yield view._setSummary(src);
          yield view._setResponseHeaders(src.responseHeaders);
          yield view._setRequestHeaders(
            src.requestHeaders,
            src.requestHeadersFromUploadStream);
          break;
        case 1: // "Cookies"
          yield view._setResponseCookies(src.responseCookies);
          yield view._setRequestCookies(src.requestCookies);
          break;
        case 2: // "Params"
          yield view._setRequestGetParams(src.url);
          yield view._setRequestPostParams(
            src.requestHeaders,
            src.requestHeadersFromUploadStream,
            src.requestPostData);
          break;
        case 3: // "Response"
          yield view._setResponseBody(src.url, src.responseContent);
          break;
        case 4: // "Timings"
          yield view._setTimingsInformation(src.eventTimings);
          break;
        case 5: // "Security"
          yield view._setSecurityInfo(src.securityInfo, src.url);
          break;
        case 6: // "Preview"
          yield view._setHtmlPreview(src.responseContent);
          break;
      }
      viewState.updating[tab] = false;
    }).then(() => {
      if (tab == this.widget.selectedIndex) {
        if (viewState.dirty[tab]) {
          // The request information was updated while the task was running.
          viewState.dirty[tab] = false;
          view.populate(viewState.latestData);
        }
        else {
          // Tab is selected but not dirty. We're done here.
          populated[tab] = true;
          window.emit(EVENTS.TAB_UPDATED);

          if (NetMonitorController.isConnected()) {
            NetMonitorView.RequestsMenu.ensureSelectedItemIsVisible();
          }
        }
      }
      else {
        if (viewState.dirty[tab]) {
          // Tab is dirty but no longer selected. Don't refresh it now, it'll be
          // done if the tab is shown again.
          viewState.dirty[tab] = false;
        }
      }
    }, Cu.reportError);
  },

  /**
   * Sets the network request summary shown in this view.
   *
   * @param object aData
   *        The data source (this should be the attachment of a request item).
   */
  _setSummary: function(aData) {
    if (aData.url) {
      let unicodeUrl = NetworkHelper.convertToUnicode(unescape(aData.url));
      $("#headers-summary-url-value").setAttribute("value", unicodeUrl);
      $("#headers-summary-url-value").setAttribute("tooltiptext", unicodeUrl);
      $("#headers-summary-url").removeAttribute("hidden");
    } else {
      $("#headers-summary-url").setAttribute("hidden", "true");
    }

    if (aData.method) {
      $("#headers-summary-method-value").setAttribute("value", aData.method);
      $("#headers-summary-method").removeAttribute("hidden");
    } else {
      $("#headers-summary-method").setAttribute("hidden", "true");
    }

    if (aData.remoteAddress) {
      let address = aData.remoteAddress;
      if (address.indexOf(":") != -1) {
        address = `[${address}]`;
      }
      if(aData.remotePort) {
        address += `:${aData.remotePort}`;
      }
      $("#headers-summary-address-value").setAttribute("value", address);
      $("#headers-summary-address-value").setAttribute("tooltiptext", address);
      $("#headers-summary-address").removeAttribute("hidden");
    } else {
      $("#headers-summary-address").setAttribute("hidden", "true");
    }

    if (aData.status) {
      $("#headers-summary-status-circle").setAttribute("code", aData.fromCache ? "cached" : aData.status);
      $("#headers-summary-status-value").setAttribute("value", aData.status + " " + aData.statusText);
      $("#headers-summary-status").removeAttribute("hidden");
    } else {
      $("#headers-summary-status").setAttribute("hidden", "true");
    }

    if (aData.httpVersion) {
      $("#headers-summary-version-value").setAttribute("value", aData.httpVersion);
      $("#headers-summary-version").removeAttribute("hidden");
    } else {
      $("#headers-summary-version").setAttribute("hidden", "true");
    }
  },

  /**
   * Sets the network request headers shown in this view.
   *
   * @param object aHeaders
   *        The "requestHeaders" message received from the server.
   * @param object aUploadHeaders
   *        The "requestHeadersFromUploadStream" inferred from the POST payload.
   * @return object
   *        A promise that resolves when request headers are set.
   */
  _setRequestHeaders: Task.async(function*(aHeaders, aUploadHeaders) {
    if (aHeaders && aHeaders.headers.length) {
      yield this._addHeaders(this._requestHeaders, aHeaders);
    }
    if (aUploadHeaders && aUploadHeaders.headers.length) {
      yield this._addHeaders(this._requestHeadersFromUpload, aUploadHeaders);
    }
  }),

  /**
   * Sets the network response headers shown in this view.
   *
   * @param object aResponse
   *        The message received from the server.
   * @return object
   *        A promise that resolves when response headers are set.
   */
  _setResponseHeaders: Task.async(function*(aResponse) {
    if (aResponse && aResponse.headers.length) {
      aResponse.headers.sort((a, b) => a.name > b.name);
      yield this._addHeaders(this._responseHeaders, aResponse);
    }
  }),

  /**
   * Populates the headers container in this view with the specified data.
   *
   * @param string aName
   *        The type of headers to populate (request or response).
   * @param object aResponse
   *        The message received from the server.
   * @return object
   *        A promise that resolves when headers are added.
   */
  _addHeaders: Task.async(function*(aName, aResponse) {
    let kb = aResponse.headersSize / 1024;
    let size = L10N.numberWithDecimals(kb, HEADERS_SIZE_DECIMALS);
    let text = L10N.getFormatStr("networkMenu.sizeKB", size);

    let headersScope = this._headers.addScope(aName + " (" + text + ")");
    headersScope.expanded = true;

    for (let header of aResponse.headers) {
      let headerVar = headersScope.addItem(header.name, {}, true);
      let headerValue = yield gNetwork.getString(header.value);
      headerVar.setGrip(headerValue);
    }
  }),

  /**
   * Sets the network request cookies shown in this view.
   *
   * @param object aResponse
   *        The message received from the server.
   * @return object
   *        A promise that is resolved when the request cookies are set.
   */
  _setRequestCookies: Task.async(function*(aResponse) {
    if (aResponse && aResponse.cookies.length) {
      aResponse.cookies.sort((a, b) => a.name > b.name);
      yield this._addCookies(this._requestCookies, aResponse);
    }
  }),

  /**
   * Sets the network response cookies shown in this view.
   *
   * @param object aResponse
   *        The message received from the server.
   * @return object
   *        A promise that is resolved when the response cookies are set.
   */
  _setResponseCookies: Task.async(function*(aResponse) {
    if (aResponse && aResponse.cookies.length) {
      yield this._addCookies(this._responseCookies, aResponse);
    }
  }),

  /**
   * Populates the cookies container in this view with the specified data.
   *
   * @param string aName
   *        The type of cookies to populate (request or response).
   * @param object aResponse
   *        The message received from the server.
   * @return object
   *        Returns a promise that resolves upon the adding of cookies.
   */
  _addCookies: Task.async(function*(aName, aResponse) {
    let cookiesScope = this._cookies.addScope(aName);
    cookiesScope.expanded = true;

    for (let cookie of aResponse.cookies) {
      let cookieVar = cookiesScope.addItem(cookie.name, {}, true);
      let cookieValue = yield gNetwork.getString(cookie.value);
      cookieVar.setGrip(cookieValue);

      // By default the cookie name and value are shown. If this is the only
      // information available, then nothing else is to be displayed.
      let cookieProps = Object.keys(cookie);
      if (cookieProps.length == 2) {
        continue;
      }

      // Display any other information other than the cookie name and value
      // which may be available.
      let rawObject = Object.create(null);
      let otherProps = cookieProps.filter(e => e != "name" && e != "value");
      for (let prop of otherProps) {
        rawObject[prop] = cookie[prop];
      }
      cookieVar.populate(rawObject);
      cookieVar.twisty = true;
      cookieVar.expanded = true;
    }
  }),

  /**
   * Sets the network request get params shown in this view.
   *
   * @param string aUrl
   *        The request's url.
   */
  _setRequestGetParams: function(aUrl) {
    let query = NetworkHelper.nsIURL(aUrl).query;
    if (query) {
      this._addParams(this._paramsQueryString, query);
    }
  },

  /**
   * Sets the network request post params shown in this view.
   *
   * @param object aHeaders
   *        The "requestHeaders" message received from the server.
   * @param object aUploadHeaders
   *        The "requestHeadersFromUploadStream" inferred from the POST payload.
   * @param object aPostData
   *        The "requestPostData" message received from the server.
   * @return object
   *        A promise that is resolved when the request post params are set.
   */
  _setRequestPostParams: Task.async(function*(aHeaders, aUploadHeaders, aPostData) {
    if (!aHeaders || !aUploadHeaders || !aPostData) {
      return;
    }

    let formDataSections = yield RequestsMenuView.prototype._getFormDataSections(
      aHeaders, aUploadHeaders, aPostData);

    // Handle urlencoded form data sections (e.g. "?foo=bar&baz=42").
    if (formDataSections.length > 0) {
      formDataSections.forEach(section => {
        this._addParams(this._paramsFormData, section);
      });
    }
    // Handle actual forms ("multipart/form-data" content type).
    else {
      // This is really awkward, but hey, it works. Let's show an empty
      // scope in the params view and place the source editor containing
      // the raw post data directly underneath.
      $("#request-params-box").removeAttribute("flex");
      let paramsScope = this._params.addScope(this._paramsPostPayload);
      paramsScope.expanded = true;
      paramsScope.locked = true;

      $("#request-post-data-textarea-box").hidden = false;
      let editor = yield NetMonitorView.editor("#request-post-data-textarea");
      let postDataLongString = aPostData.postData.text;
      let postData = yield gNetwork.getString(postDataLongString);

      // Most POST bodies are usually JSON, so they can be neatly
      // syntax highlighted as JS. Otheriwse, fall back to plain text.
      try {
        JSON.parse(postData);
        editor.setMode(Editor.modes.js);
      } catch (e) {
        editor.setMode(Editor.modes.text);
      } finally {
        editor.setText(postData);
      }
    }

    window.emit(EVENTS.REQUEST_POST_PARAMS_DISPLAYED);
  }),

  /**
   * Populates the params container in this view with the specified data.
   *
   * @param string aName
   *        The type of params to populate (get or post).
   * @param string aQueryString
   *        A query string of params (e.g. "?foo=bar&baz=42").
   */
  _addParams: function(aName, aQueryString) {
    let paramsArray = NetworkHelper.parseQueryString(aQueryString);
    if (!paramsArray) {
      return;
    }
    let paramsScope = this._params.addScope(aName);
    paramsScope.expanded = true;

    for (let param of paramsArray) {
      let paramVar = paramsScope.addItem(param.name, {}, true);
      paramVar.setGrip(param.value);
    }
  },

  /**
   * Sets the network response body shown in this view.
   *
   * @param string aUrl
   *        The request's url.
   * @param object aResponse
   *        The message received from the server.
   * @return object
   *         A promise that is resolved when the response body is set.
   */
  _setResponseBody: Task.async(function*(aUrl, aResponse) {
    if (!aResponse) {
      return;
    }
    let { mimeType, text, encoding } = aResponse.content;
    let responseBody = yield gNetwork.getString(text);

    // Handle json, which we tentatively identify by checking the MIME type
    // for "json" after any word boundary. This works for the standard
    // "application/json", and also for custom types like "x-bigcorp-json".
    // Additionally, we also directly parse the response text content to
    // verify whether it's json or not, to handle responses incorrectly
    // labeled as text/plain instead.
    let jsonMimeType, jsonObject, jsonObjectParseError;
    try {
      jsonMimeType = /\bjson/.test(mimeType);
      jsonObject = JSON.parse(responseBody);
    } catch (e) {
      jsonObjectParseError = e;
    }
    if (jsonMimeType || jsonObject) {
      // Extract the actual json substring in case this might be a "JSONP".
      // This regex basically parses a function call and captures the
      // function name and arguments in two separate groups.
      let jsonpRegex = /^\s*([\w$]+)\s*\(\s*([^]*)\s*\)\s*;?\s*$/;
      let [_, callbackPadding, jsonpString] = responseBody.match(jsonpRegex) || [];

      // Make sure this is a valid JSON object first. If so, nicely display
      // the parsing results in a variables view. Otherwise, simply show
      // the contents as plain text.
      if (callbackPadding && jsonpString) {
        try {
          jsonObject = JSON.parse(jsonpString);
        } catch (e) {
          jsonObjectParseError = e;
        }
      }

      // Valid JSON or JSONP.
      if (jsonObject) {
        $("#response-content-json-box").hidden = false;
        let jsonScopeName = callbackPadding
          ? L10N.getFormatStr("jsonpScopeName", callbackPadding)
          : L10N.getStr("jsonScopeName");

        let jsonVar = { label: jsonScopeName, rawObject: jsonObject };
        yield this._json.controller.setSingleVariable(jsonVar).expanded;
      }
      // Malformed JSON.
      else {
        $("#response-content-textarea-box").hidden = false;
        let infoHeader = $("#response-content-info-header");
        infoHeader.setAttribute("value", jsonObjectParseError);
        infoHeader.setAttribute("tooltiptext", jsonObjectParseError);
        infoHeader.hidden = false;

        let editor = yield NetMonitorView.editor("#response-content-textarea");
        editor.setMode(Editor.modes.js);
        editor.setText(responseBody);
      }
    }
    // Handle images.
    else if (mimeType.includes("image/")) {
      $("#response-content-image-box").setAttribute("align", "center");
      $("#response-content-image-box").setAttribute("pack", "center");
      $("#response-content-image-box").hidden = false;
      $("#response-content-image").src =
        "data:" + mimeType + ";" + encoding + "," + responseBody;

      // Immediately display additional information about the image:
      // file name, mime type and encoding.
      $("#response-content-image-name-value").setAttribute("value", NetworkHelper.nsIURL(aUrl).fileName);
      $("#response-content-image-mime-value").setAttribute("value", mimeType);
      $("#response-content-image-encoding-value").setAttribute("value", encoding);

      // Wait for the image to load in order to display the width and height.
      $("#response-content-image").onload = e => {
        // XUL images are majestic so they don't bother storing their dimensions
        // in width and height attributes like the rest of the folk. Hack around
        // this by getting the bounding client rect and subtracting the margins.
        let { width, height } = e.target.getBoundingClientRect();
        let dimensions = (width - 2) + " \u00D7 " + (height - 2);
        $("#response-content-image-dimensions-value").setAttribute("value", dimensions);
      };
    }
    // Handle anything else.
    else {
      $("#response-content-textarea-box").hidden = false;
      let editor = yield NetMonitorView.editor("#response-content-textarea");
      editor.setMode(Editor.modes.text);
      editor.setText(responseBody);

      // Maybe set a more appropriate mode in the Source Editor if possible,
      // but avoid doing this for very large files.
      if (responseBody.length < SOURCE_SYNTAX_HIGHLIGHT_MAX_FILE_SIZE) {
        let mapping = Object.keys(CONTENT_MIME_TYPE_MAPPINGS).find(key => mimeType.includes(key));
        if (mapping) {
          editor.setMode(CONTENT_MIME_TYPE_MAPPINGS[mapping]);
        }
      }
    }

    window.emit(EVENTS.RESPONSE_BODY_DISPLAYED);
  }),

  /**
   * Sets the timings information shown in this view.
   *
   * @param object aResponse
   *        The message received from the server.
   */
  _setTimingsInformation: function(aResponse) {
    if (!aResponse) {
      return;
    }
    let { blocked, dns, connect, send, wait, receive } = aResponse.timings;

    let tabboxWidth = $("#details-pane").getAttribute("width");
    let availableWidth = tabboxWidth / 2; // Other nodes also take some space.
    let scale = (aResponse.totalTime > 0 ?
                 Math.max(availableWidth / aResponse.totalTime, 0) :
                 0);

    $("#timings-summary-blocked .requests-menu-timings-box")
      .setAttribute("width", blocked * scale);
    $("#timings-summary-blocked .requests-menu-timings-total")
      .setAttribute("value", L10N.getFormatStr("networkMenu.totalMS", blocked));

    $("#timings-summary-dns .requests-menu-timings-box")
      .setAttribute("width", dns * scale);
    $("#timings-summary-dns .requests-menu-timings-total")
      .setAttribute("value", L10N.getFormatStr("networkMenu.totalMS", dns));

    $("#timings-summary-connect .requests-menu-timings-box")
      .setAttribute("width", connect * scale);
    $("#timings-summary-connect .requests-menu-timings-total")
      .setAttribute("value", L10N.getFormatStr("networkMenu.totalMS", connect));

    $("#timings-summary-send .requests-menu-timings-box")
      .setAttribute("width", send * scale);
    $("#timings-summary-send .requests-menu-timings-total")
      .setAttribute("value", L10N.getFormatStr("networkMenu.totalMS", send));

    $("#timings-summary-wait .requests-menu-timings-box")
      .setAttribute("width", wait * scale);
    $("#timings-summary-wait .requests-menu-timings-total")
      .setAttribute("value", L10N.getFormatStr("networkMenu.totalMS", wait));

    $("#timings-summary-receive .requests-menu-timings-box")
      .setAttribute("width", receive * scale);
    $("#timings-summary-receive .requests-menu-timings-total")
      .setAttribute("value", L10N.getFormatStr("networkMenu.totalMS", receive));

    $("#timings-summary-dns .requests-menu-timings-box")
      .style.transform = "translateX(" + (scale * blocked) + "px)";
    $("#timings-summary-connect .requests-menu-timings-box")
      .style.transform = "translateX(" + (scale * (blocked + dns)) + "px)";
    $("#timings-summary-send .requests-menu-timings-box")
      .style.transform = "translateX(" + (scale * (blocked + dns + connect)) + "px)";
    $("#timings-summary-wait .requests-menu-timings-box")
      .style.transform = "translateX(" + (scale * (blocked + dns + connect + send)) + "px)";
    $("#timings-summary-receive .requests-menu-timings-box")
      .style.transform = "translateX(" + (scale * (blocked + dns + connect + send + wait)) + "px)";

    $("#timings-summary-dns .requests-menu-timings-total")
      .style.transform = "translateX(" + (scale * blocked) + "px)";
    $("#timings-summary-connect .requests-menu-timings-total")
      .style.transform = "translateX(" + (scale * (blocked + dns)) + "px)";
    $("#timings-summary-send .requests-menu-timings-total")
      .style.transform = "translateX(" + (scale * (blocked + dns + connect)) + "px)";
    $("#timings-summary-wait .requests-menu-timings-total")
      .style.transform = "translateX(" + (scale * (blocked + dns + connect + send)) + "px)";
    $("#timings-summary-receive .requests-menu-timings-total")
      .style.transform = "translateX(" + (scale * (blocked + dns + connect + send + wait)) + "px)";
  },

  /**
   * Sets the preview for HTML responses shown in this view.
   *
   * @param object aResponse
   *        The message received from the server.
   * @return object
   *        A promise that is resolved when the html preview is rendered.
   */
  _setHtmlPreview: Task.async(function*(aResponse) {
    if (!aResponse) {
      return promise.resolve();
    }
    let { text } = aResponse.content;
    let responseBody = yield gNetwork.getString(text);

    // Always disable JS when previewing HTML responses.
    let iframe = $("#response-preview");
    iframe.contentDocument.docShell.allowJavascript = false;
    iframe.contentDocument.documentElement.innerHTML = responseBody;

    window.emit(EVENTS.RESPONSE_HTML_PREVIEW_DISPLAYED);
  }),

  /**
   * Sets the security information shown in this view.
   *
   * @param object securityInfo
   *        The data received from server
   * @param string url
   *        The URL of this request
   * @return object
   *        A promise that is resolved when the security info is rendered.
   */
  _setSecurityInfo: Task.async(function* (securityInfo, url) {
    if (!securityInfo) {
      // We don't have security info. This could mean one of two things:
      // 1) This connection is not secure and this tab is not visible and thus
      //    we shouldn't be here.
      // 2) We have already received securityState and the tab is visible BUT
      //    the rest of the information is still on its way. Once it arrives
      //    this method is called again.
      return;
    }

    /**
     * A helper that sets value and tooltiptext attributes of an element to
     * specified value.
     *
     * @param string selector
     *        A selector for the element.
     * @param string value
     *        The value to set. If this evaluates to false a placeholder string
     *        <Not Available> is used instead.
     */
    function setValue(selector, value) {
      let label = $(selector);
      if (!value) {
        label.setAttribute("value", L10N.getStr("netmonitor.security.notAvailable"));
        label.setAttribute("tooltiptext", label.getAttribute("value"));
      } else {
        label.setAttribute("value", value);
        label.setAttribute("tooltiptext", value);
      }
    }

    let errorbox = $("#security-error");
    let infobox = $("#security-information");

    if (securityInfo.state === "secure" || securityInfo.state === "weak") {
      infobox.hidden = false;
      errorbox.hidden = true;

      // Warning icons
      let cipher = $("#security-warning-cipher");

      if (securityInfo.state === "weak") {
        cipher.hidden = securityInfo.weaknessReasons.indexOf("cipher") === -1;
      } else {
        cipher.hidden = true;
      }

      let enabledLabel = L10N.getStr("netmonitor.security.enabled");
      let disabledLabel = L10N.getStr("netmonitor.security.disabled");

      // Connection parameters
      setValue("#security-protocol-version-value", securityInfo.protocolVersion);
      setValue("#security-ciphersuite-value", securityInfo.cipherSuite);

      // Host header
      let domain = NetMonitorView.RequestsMenu._getUriHostPort(url);
      let hostHeader = L10N.getFormatStr("netmonitor.security.hostHeader", domain);
      setValue("#security-info-host-header", hostHeader);

      // Parameters related to the domain
      setValue("#security-http-strict-transport-security-value",
                securityInfo.hsts ? enabledLabel : disabledLabel);

      setValue("#security-public-key-pinning-value",
                securityInfo.hpkp ? enabledLabel : disabledLabel);

      // Certificate parameters
      let cert = securityInfo.cert;
      setValue("#security-cert-subject-cn", cert.subject.commonName);
      setValue("#security-cert-subject-o", cert.subject.organization);
      setValue("#security-cert-subject-ou", cert.subject.organizationalUnit);

      setValue("#security-cert-issuer-cn", cert.issuer.commonName);
      setValue("#security-cert-issuer-o", cert.issuer.organization);
      setValue("#security-cert-issuer-ou", cert.issuer.organizationalUnit);

      setValue("#security-cert-validity-begins", cert.validity.start);
      setValue("#security-cert-validity-expires", cert.validity.end);

      setValue("#security-cert-sha1-fingerprint", cert.fingerprint.sha1);
      setValue("#security-cert-sha256-fingerprint", cert.fingerprint.sha256);
    } else {
      infobox.hidden = true;
      errorbox.hidden = false;

      // Strip any HTML from the message.
      let plain = DOMParser.parseFromString(securityInfo.errorMessage, "text/html");
      setValue("#security-error-message", plain.body.textContent);
    }
  }),

  _dataSrc: null,
  _headers: null,
  _cookies: null,
  _params: null,
  _json: null,
  _paramsQueryString: "",
  _paramsFormData: "",
  _paramsPostPayload: "",
  _requestHeaders: "",
  _responseHeaders: "",
  _requestCookies: "",
  _responseCookies: ""
};

/**
 * Functions handling the performance statistics view.
 */
function PerformanceStatisticsView() {
}

PerformanceStatisticsView.prototype = {
  /**
   * Initializes and displays empty charts in this container.
   */
  displayPlaceholderCharts: function() {
    this._createChart({
      id: "#primed-cache-chart",
      title: "charts.cacheEnabled"
    });
    this._createChart({
      id: "#empty-cache-chart",
      title: "charts.cacheDisabled"
    });
    window.emit(EVENTS.PLACEHOLDER_CHARTS_DISPLAYED);
  },

  /**
   * Populates and displays the primed cache chart in this container.
   *
   * @param array aItems
   *        @see this._sanitizeChartDataSource
   */
  createPrimedCacheChart: function(aItems) {
    this._createChart({
      id: "#primed-cache-chart",
      title: "charts.cacheEnabled",
      data: this._sanitizeChartDataSource(aItems),
      strings: this._commonChartStrings,
      totals: this._commonChartTotals,
      sorted: true
    });
    window.emit(EVENTS.PRIMED_CACHE_CHART_DISPLAYED);
  },

  /**
   * Populates and displays the empty cache chart in this container.
   *
   * @param array aItems
   *        @see this._sanitizeChartDataSource
   */
  createEmptyCacheChart: function(aItems) {
    this._createChart({
      id: "#empty-cache-chart",
      title: "charts.cacheDisabled",
      data: this._sanitizeChartDataSource(aItems, true),
      strings: this._commonChartStrings,
      totals: this._commonChartTotals,
      sorted: true
    });
    window.emit(EVENTS.EMPTY_CACHE_CHART_DISPLAYED);
  },

  /**
   * Common stringifier predicates used for items and totals in both the
   * "primed" and "empty" cache charts.
   */
  _commonChartStrings: {
    size: value => {
      let string = L10N.numberWithDecimals(value / 1024, CONTENT_SIZE_DECIMALS);
      return L10N.getFormatStr("charts.sizeKB", string);
    },
    transferredSize: value => {
      let string = L10N.numberWithDecimals(value / 1024, CONTENT_SIZE_DECIMALS);
      return L10N.getFormatStr("charts.transferredSizeKB", string);
    },
    time: value => {
      let string = L10N.numberWithDecimals(value / 1000, REQUEST_TIME_DECIMALS);
      return L10N.getFormatStr("charts.totalS", string);
    }
  },
  _commonChartTotals: {
    cached: total => {
      return L10N.getFormatStr("charts.totalCached", total);
    },
    count: total => {
      return L10N.getFormatStr("charts.totalCount", total);
    },
    size: total => {
      let string = L10N.numberWithDecimals(total / 1024, CONTENT_SIZE_DECIMALS);
      return L10N.getFormatStr("charts.totalSize", string);
    },
    transferredSize: total => {
      let string = L10N.numberWithDecimals(total / 1024, CONTENT_SIZE_DECIMALS);
      return L10N.getFormatStr("charts.totalTransferredSize", string);
    },
    time: total => {
      let seconds = total / 1000;
      let string = L10N.numberWithDecimals(seconds, REQUEST_TIME_DECIMALS);
      return PluralForm.get(seconds, L10N.getStr("charts.totalSeconds")).replace("#1", string);
    },
  },

  /**
   * Adds a specific chart to this container.
   *
   * @param object
   *        An object containing all or some the following properties:
   *          - id: either "#primed-cache-chart" or "#empty-cache-chart"
   *          - title/data/strings/totals/sorted: @see Chart.jsm for details
   */
  _createChart: function({ id, title, data, strings, totals, sorted }) {
    let container = $(id);

    // Nuke all existing charts of the specified type.
    while (container.hasChildNodes()) {
      container.firstChild.remove();
    }

    // Create a new chart.
    let chart = Chart.PieTable(document, {
      diameter: NETWORK_ANALYSIS_PIE_CHART_DIAMETER,
      title: L10N.getStr(title),
      header: {
        cached: "",
        count: "",
        label: L10N.getStr("charts.type"),
        size: L10N.getStr("charts.size"),
        transferredSize: L10N.getStr("charts.transferred"),
        time: L10N.getStr("charts.time")
      },
      data: data,
      strings: strings,
      totals: totals,
      sorted: sorted
    });

    chart.on("click", (_, item) => {
      NetMonitorView.RequestsMenu.filterOnlyOn(item.label);
      NetMonitorView.showNetworkInspectorView();
    });

    container.appendChild(chart.node);
  },

  /**
   * Sanitizes the data source used for creating charts, to follow the
   * data format spec defined in Chart.jsm.
   *
   * @param array aItems
   *        A collection of request items used as the data source for the chart.
   * @param boolean aEmptyCache
   *        True if the cache is considered enabled, false for disabled.
   */
  _sanitizeChartDataSource: function(aItems, aEmptyCache) {
    const data = [
      "html", "css", "js", "xhr", "fonts", "images", "media", "flash", "other"
    ].map(e => ({
      cached: 0,
      count: 0,
      label: e,
      size: 0,
      transferredSize: 0,
      time: 0
    }));

    for (let requestItem of aItems) {
      let details = requestItem.attachment;
      let type;

      if (RequestsMenuView.prototype.isHtml(requestItem)) {
        type = 0; // "html"
      } else if (RequestsMenuView.prototype.isCss(requestItem)) {
        type = 1; // "css"
      } else if (RequestsMenuView.prototype.isJs(requestItem)) {
        type = 2; // "js"
      } else if (RequestsMenuView.prototype.isFont(requestItem)) {
        type = 4; // "fonts"
      } else if (RequestsMenuView.prototype.isImage(requestItem)) {
        type = 5; // "images"
      } else if (RequestsMenuView.prototype.isMedia(requestItem)) {
        type = 6; // "media"
      } else if (RequestsMenuView.prototype.isFlash(requestItem)) {
        type = 7; // "flash"
      } else if (RequestsMenuView.prototype.isXHR(requestItem)) {
        // Verify XHR last, to categorize other mime types in their own blobs.
        type = 3; // "xhr"
      } else {
        type = 8; // "other"
      }

      if (aEmptyCache || !responseIsFresh(details)) {
        data[type].time += details.totalTime || 0;
        data[type].size += details.contentSize || 0;
        data[type].transferredSize += details.transferredSize || 0;
      } else {
        data[type].cached++;
      }
      data[type].count++;
    }

    return data.filter(e => e.count > 0);
  },
};

/**
 * DOM query helper.
 */
var $ = (aSelector, aTarget = document) => aTarget.querySelector(aSelector);
var $all = (aSelector, aTarget = document) => aTarget.querySelectorAll(aSelector);

/**
 * Parse text representation of multiple HTTP headers.
 *
 * @param string aText
 *        Text of headers
 * @return array
 *         Array of headers info {name, value}
 */
function parseHeadersText(aText) {
  return parseRequestText(aText, "\\S+?", ":");
}

/**
 * Parse readable text list of a query string.
 *
 * @param string aText
 *        Text of query string represetation
 * @return array
 *         Array of query params {name, value}
 */
function parseQueryText(aText) {
  return parseRequestText(aText, ".+?", "=");
}

/**
 * Parse a text representation of a name[divider]value list with
 * the given name regex and divider character.
 *
 * @param string aText
 *        Text of list
 * @return array
 *         Array of headers info {name, value}
 */
function parseRequestText(aText, aName, aDivider) {
  let regex = new RegExp("(" + aName + ")\\" + aDivider + "\\s*(.+)");
  let pairs = [];
  for (let line of aText.split("\n")) {
    let matches;
    if (matches = regex.exec(line)) {
      let [, name, value] = matches;
      pairs.push({name: name, value: value});
    }
  }
  return pairs;
}

/**
 * Write out a list of headers into a chunk of text
 *
 * @param array aHeaders
 *        Array of headers info {name, value}
 * @return string aText
 *         List of headers in text format
 */
function writeHeaderText(aHeaders) {
  return aHeaders.map(({name, value}) => name + ": " + value).join("\n");
}

/**
 * Write out a list of query params into a chunk of text
 *
 * @param array aParams
 *        Array of query params {name, value}
 * @return string
 *         List of query params in text format
 */
function writeQueryText(aParams) {
  return aParams.map(({name, value}) => name + "=" + value).join("\n");
}

/**
 * Write out a list of query params into a query string
 *
 * @param array aParams
 *        Array of query  params {name, value}
 * @return string
 *         Query string that can be appended to a url.
 */
function writeQueryString(aParams) {
  return aParams.map(({name, value}) => name + "=" + value).join("&");
}

/**
 * Checks if the "Expiration Calculations" defined in section 13.2.4 of the
 * "HTTP/1.1: Caching in HTTP" spec holds true for a collection of headers.
 *
 * @param object
 *        An object containing the { responseHeaders, status } properties.
 * @return boolean
 *         True if the response is fresh and loaded from cache.
 */
function responseIsFresh({ responseHeaders, status }) {
  // Check for a "304 Not Modified" status and response headers availability.
  if (status != 304 || !responseHeaders) {
    return false;
  }

  let list = responseHeaders.headers;
  let cacheControl = list.filter(e => e.name.toLowerCase() == "cache-control")[0];
  let expires = list.filter(e => e.name.toLowerCase() == "expires")[0];

  // Check the "Cache-Control" header for a maximum age value.
  if (cacheControl) {
    let maxAgeMatch =
      cacheControl.value.match(/s-maxage\s*=\s*(\d+)/) ||
      cacheControl.value.match(/max-age\s*=\s*(\d+)/);

    if (maxAgeMatch && maxAgeMatch.pop() > 0) {
      return true;
    }
  }

  // Check the "Expires" header for a valid date.
  if (expires && Date.parse(expires.value)) {
    return true;
  }

  return false;
}

/**
 * Helper method to get a wrapped function which can be bound to as an event listener directly and is executed only when data-key is present in event.target.
 *
 * @param function callback
 *          Function to execute execute when data-key is present in event.target.
 * @return function
 *          Wrapped function with the target data-key as the first argument.
 */
function getKeyWithEvent(callback) {
  return function(event) {
    var key = event.target.getAttribute("data-key");
    if (key) {
      callback.call(null, key);
    }
  };
}

/**
 * Preliminary setup for the NetMonitorView object.
 */
NetMonitorView.Toolbar = new ToolbarView();
NetMonitorView.RequestsMenu = new RequestsMenuView();
NetMonitorView.Sidebar = new SidebarView();
NetMonitorView.CustomRequest = new CustomRequestView();
NetMonitorView.NetworkDetails = new NetworkDetailsView();
NetMonitorView.PerformanceStatistics = new PerformanceStatisticsView();
