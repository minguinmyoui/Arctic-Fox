# -*- indent-tabs-mode: nil -*-
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;
const Cu = Components.utils;

const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "AppConstants",
                                  "resource://gre/modules/AppConstants.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "AboutHome",
                                  "resource:///modules/AboutHome.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "AddonManager",
                                  "resource://gre/modules/AddonManager.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "ContentClick",
                                  "resource:///modules/ContentClick.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NetUtil",
                                  "resource://gre/modules/NetUtil.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "UserAgentOverrides",
                                  "resource://gre/modules/UserAgentOverrides.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
                                  "resource://gre/modules/FileUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils",
                                  "resource://gre/modules/PlacesUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "BookmarkHTMLUtils",
                                  "resource://gre/modules/BookmarkHTMLUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "BookmarkJSONUtils",
                                  "resource://gre/modules/BookmarkJSONUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs",
                                  "resource://gre/modules/PageThumbs.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NewTabUtils",
                                  "resource://gre/modules/NewTabUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "webrtcUI",
                                  "resource:///modules/webrtcUI.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PrivateBrowsingUtils",
                                  "resource://gre/modules/PrivateBrowsingUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "RecentWindow",
                                  "resource:///modules/RecentWindow.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Task",
                                  "resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesBackups",
                                  "resource://gre/modules/PlacesBackups.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "OS",
                                  "resource://gre/modules/osfile.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Feeds",
                                  "resource:///modules/Feeds.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "LoginManagerParent",
                                  "resource://gre/modules/LoginManagerParent.jsm");

XPCOMUtils.defineLazyGetter(this, "gBrandBundle", function() {
  return Services.strings.createBundle('chrome://branding/locale/brand.properties');
});

XPCOMUtils.defineLazyGetter(this, "gBrowserBundle", function() {
  return Services.strings.createBundle('chrome://browser/locale/browser.properties');
});

XPCOMUtils.defineLazyModuleGetter(this, "FormValidationHandler",
                                  "resource:///modules/FormValidationHandler.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "AddonWatcher",
                                  "resource://gre/modules/AddonWatcher.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "SessionStore",
                                  "resource:///modules/sessionstore/SessionStore.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "BrowserUITelemetry",
                                  "resource:///modules/BrowserUITelemetry.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "AsyncShutdown",
                                  "resource://gre/modules/AsyncShutdown.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "LoginManagerParent",
                                  "resource://gre/modules/LoginManagerParent.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "SimpleServiceDiscovery",
                                  "resource://gre/modules/SimpleServiceDiscovery.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "ContentSearch",
                                  "resource:///modules/ContentSearch.jsm");

#ifdef E10S_TESTING_ONLY
XPCOMUtils.defineLazyModuleGetter(this, "UpdateUtils",
                                  "resource://gre/modules/UpdateUtils.jsm");
#endif

#ifdef MOZ_CRASHREPORTER
XPCOMUtils.defineLazyModuleGetter(this, "TabCrashReporter",
                                  "resource:///modules/ContentCrashReporters.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PluginCrashReporter",
                                  "resource:///modules/ContentCrashReporters.jsm");
#endif

XPCOMUtils.defineLazyModuleGetter(this, "ReaderParent",
                                  "resource:///modules/ReaderParent.jsm");

XPCOMUtils.defineLazyGetter(this, "ShellService", function() {
  try {
    return Cc["@mozilla.org/browser/shell-service;1"].
           getService(Ci.nsIShellService);
  }
  catch(ex) {
    return null;
  }
});

XPCOMUtils.defineLazyModuleGetter(this, "LightweightThemeManager",
                                  "resource://gre/modules/LightweightThemeManager.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "ExtensionManagement",
                                  "resource://gre/modules/ExtensionManagement.jsm");

const ABOUT_NEWTAB = "about:newtab";

const PREF_PLUGINS_NOTIFYUSER = "plugins.update.notifyUser";
const PREF_PLUGINS_UPDATEURL  = "plugins.update.url";

// Seconds of idle before trying to create a bookmarks backup.
const BOOKMARKS_BACKUP_IDLE_TIME_SEC = 8 * 60;
// Minimum interval between backups.  We try to not create more than one backup
// per interval.
const BOOKMARKS_BACKUP_MIN_INTERVAL_DAYS = 1;
// Maximum interval between backups.  If the last backup is older than these
// days we will try to create a new one more aggressively.
const BOOKMARKS_BACKUP_MAX_INTERVAL_DAYS = 3;

// Record the current default search engine in Telemetry.
function recordDefaultSearchEngine() {
  let engine;
  try {
    engine = Services.search.defaultEngine;
  } catch (e) {}
  let name;

  if (!engine) {
    name = "NONE";
  } else if (engine.identifier) {
    name = engine.identifier;
  } else if (engine.name) {
    name = "other-" + engine.name;
  } else {
    name = "UNDEFINED";
  }

  let engines = Services.telemetry.getKeyedHistogramById("SEARCH_DEFAULT_ENGINE");
  engines.add(name, true)
}

// Factory object
const BrowserGlueServiceFactory = {
  _instance: null,
  createInstance: function BGSF_createInstance(outer, iid) {
    if (outer != null)
      throw Components.results.NS_ERROR_NO_AGGREGATION;
    return this._instance == null ?
      this._instance = new BrowserGlue() : this._instance;
  }
};

// Constructor

function BrowserGlue() {
  XPCOMUtils.defineLazyServiceGetter(this, "_idleService",
                                     "@mozilla.org/widget/idleservice;1",
                                     "nsIIdleService");

  XPCOMUtils.defineLazyGetter(this, "_distributionCustomizer", function() {
                                Cu.import("resource:///modules/distribution.js");
                                return new DistributionCustomizer();
                              });

  XPCOMUtils.defineLazyGetter(this, "_sanitizer",
    function() {
      let sanitizerScope = {};
      Services.scriptloader.loadSubScript("chrome://browser/content/sanitize.js", sanitizerScope);
      return sanitizerScope.Sanitizer;
    });

  this._init();
}

#ifndef XP_MACOSX
# OS X has the concept of zero-window sessions and therefore ignores the
# browser-lastwindow-close-* topics.
#define OBSERVE_LASTWINDOW_CLOSE_TOPICS 1
#endif

BrowserGlue.prototype = {
  _saveSession: false,
  _isPlacesInitObserver: false,
  _isPlacesLockedObserver: false,
  _isPlacesShutdownObserver: false,
  _isPlacesDatabaseLocked: false,
  _migrationImportsDefaultBookmarks: false,

  _setPrefToSaveSession: function BG__setPrefToSaveSession(aForce) {
    if (!this._saveSession && !aForce)
      return;

    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);

    // This method can be called via [NSApplication terminate:] on Mac, which
    // ends up causing prefs not to be flushed to disk, so we need to do that
    // explicitly here. See bug 497652.
    Services.prefs.savePrefFile(null);
  },

#ifdef MOZ_SERVICES_SYNC
  _setSyncAutoconnectDelay: function BG__setSyncAutoconnectDelay() {
    // Assume that a non-zero value for services.sync.autoconnectDelay should override
    if (Services.prefs.prefHasUserValue("services.sync.autoconnectDelay")) {
      let prefDelay = Services.prefs.getIntPref("services.sync.autoconnectDelay");

      if (prefDelay > 0)
        return;
    }

    // delays are in seconds
    const MAX_DELAY = 300;
    let delay = 3;
    let browserEnum = Services.wm.getEnumerator("navigator:browser");
    while (browserEnum.hasMoreElements()) {
      delay += browserEnum.getNext().gBrowser.tabs.length;
    }
    delay = delay <= MAX_DELAY ? delay : MAX_DELAY;

    Cu.import("resource://services-sync/main.js");
    Weave.Service.scheduler.delayedAutoConnect(delay);
  },
#endif

  // nsIObserver implementation
  observe: function BG_observe(subject, topic, data) {
    switch (topic) {
      case "notifications-open-settings":
        this._openPreferences("content");
        break;
      case "prefservice:after-app-defaults":
        this._onAppDefaults();
        break;
      case "final-ui-startup":
        this._finalUIStartup();
        break;
      case "browser-delayed-startup-finished":
        this._onFirstWindowLoaded(subject);
        Services.obs.removeObserver(this, "browser-delayed-startup-finished");
        break;
      case "sessionstore-windows-restored":
        this._onWindowsRestored();
        break;
      case "browser:purge-session-history":
        // reset the console service's error buffer
        Services.console.logStringMessage(null); // clear the console (in case it's open)
        Services.console.reset();
        break;
      case "restart-in-safe-mode":
        this._onSafeModeRestart();
        break;
      case "quit-application-requested":
        this._onQuitRequest(subject, data);
        break;
      case "quit-application-granted":
        // This pref must be set here because SessionStore will use its value
        // on quit-application.
        this._setPrefToSaveSession();
        try {
          let appStartup = Cc["@mozilla.org/toolkit/app-startup;1"].
                           getService(Ci.nsIAppStartup);
          appStartup.trackStartupCrashEnd();
        } catch (e) {
          Cu.reportError("Could not end startup crash tracking in quit-application-granted: " + e);
        }
        break;
#ifdef OBSERVE_LASTWINDOW_CLOSE_TOPICS
      case "browser-lastwindow-close-requested":
        // The application is not actually quitting, but the last full browser
        // window is about to be closed.
        this._onQuitRequest(subject, "lastwindow");
        break;
      case "browser-lastwindow-close-granted":
        this._setPrefToSaveSession();
        break;
#endif
#ifdef MOZ_SERVICES_SYNC
      case "weave:service:ready":
        this._setSyncAutoconnectDelay();
        break;
      case "weave:engine:clients:display-uri":
        this._onDisplaySyncURI(subject);
        break;
#endif
      case "session-save":
        this._setPrefToSaveSession(true);
        subject.QueryInterface(Ci.nsISupportsPRBool);
        subject.data = true;
        break;
      case "places-init-complete":
        if (!this._migrationImportsDefaultBookmarks)
          this._initPlaces(false);

        Services.obs.removeObserver(this, "places-init-complete");
        this._isPlacesInitObserver = false;
        // no longer needed, since history was initialized completely.
        Services.obs.removeObserver(this, "places-database-locked");
        this._isPlacesLockedObserver = false;
        break;
      case "places-database-locked":
        this._isPlacesDatabaseLocked = true;
        // Stop observing, so further attempts to load history service
        // will not show the prompt.
        Services.obs.removeObserver(this, "places-database-locked");
        this._isPlacesLockedObserver = false;
        break;
      case "places-shutdown":
        if (this._isPlacesShutdownObserver) {
          Services.obs.removeObserver(this, "places-shutdown");
          this._isPlacesShutdownObserver = false;
        }
        // places-shutdown is fired when the profile is about to disappear.
        this._onPlacesShutdown();
        break;
      case "idle":
        this._backupBookmarks();
        break;
      case "distribution-customization-complete":
        Services.obs.removeObserver(this, "distribution-customization-complete");
        // Customization has finished, we don't need the customizer anymore.
        delete this._distributionCustomizer;
        break;
      case "browser-glue-test": // used by tests
        if (data == "post-update-notification") {
          if (Services.prefs.prefHasUserValue("app.update.postupdate"))
            this._showUpdateNotification();
        }
        else if (data == "force-ui-migration") {
          this._migrateUI();
        }
        else if (data == "force-distribution-customization") {
          this._distributionCustomizer.applyPrefDefaults();
          this._distributionCustomizer.applyCustomizations();
          // To apply distribution bookmarks use "places-init-complete".
        }
        else if (data == "force-places-init") {
          this._initPlaces(false);
        }
        else if (data == "smart-bookmarks-init") {
          this.ensurePlacesDefaultQueriesInitialized().then(() => {
            Services.obs.notifyObservers(null, "test-smart-bookmarks-done", null);
          });
        }
        break;
      case "initial-migration-will-import-default-bookmarks":
        this._migrationImportsDefaultBookmarks = true;
        break;
      case "initial-migration-did-import-default-bookmarks":
        this._initPlaces(true);
        break;
      case "handle-xul-text-link":
        let linkHandled = subject.QueryInterface(Ci.nsISupportsPRBool);
        if (!linkHandled.data) {
          let win = this.getMostRecentBrowserWindow();
          if (win) {
            win.openUILinkIn(data, "tab");
            linkHandled.data = true;
          }
        }
        break;
      case "profile-before-change":
        this._onProfileShutdown();
        break;
      case "browser-search-engine-modified":
        if (data != "engine-default" && data != "engine-current") {
          break;
        }
        // Enforce that the search service's defaultEngine is always equal to
        // its currentEngine. The search service will notify us any time either
        // of them are changed (either by directly setting the relevant prefs,
        // i.e. if add-ons try to change this directly, or if the
        // nsIBrowserSearchService setters are called).
        // No need to initialize the search service, since it's guaranteed to be
        // initialized already when this notification fires.
        let ss = Services.search;
        if (ss.currentEngine.name == ss.defaultEngine.name)
          return;
        if (data == "engine-current")
          ss.defaultEngine = ss.currentEngine;
        else
          ss.currentEngine = ss.defaultEngine;
        recordDefaultSearchEngine();
        break;
      case "browser-search-service":
        if (data != "init-complete")
          return;
        Services.obs.removeObserver(this, "browser-search-service");
        this._syncSearchEngines();
        recordDefaultSearchEngine();
        break;
      case "flash-plugin-hang":
        this._handleFlashHang();
        break;
      case "test-initialize-sanitizer":
        this._sanitizer.onStartup();
        break;
      case "xpi-signature-changed":
        let disabledAddons = JSON.parse(data).disabled;
        AddonManager.getAddonsByIDs(disabledAddons, (addons) => {
          for (let addon of addons) {
            if (addon.type != "experiment") {
              this._notifyUnsignedAddonsDisabled();
              break;
            }
          }
        });
        break;
      case "autocomplete-did-enter-text":
        this._handleURLBarTelemetry(subject.QueryInterface(Ci.nsIAutoCompleteInput));
        break;
    }
  },

  _handleURLBarTelemetry(input) {
    if (!input ||
        input.id != "urlbar" ||
        input.inPrivateContext ||
        input.popup.selectedIndex < 0) {
      return;
    }
    let controller =
      input.popup.view.QueryInterface(Ci.nsIAutoCompleteController);
    let idx = input.popup.selectedIndex;
    let value = controller.getValueAt(idx);
    let action = input._parseActionUrl(value);
    let actionType;
    if (action) {
      actionType =
        action.type == "searchengine" && action.params.searchSuggestion ?
          "searchsuggestion" :
        action.type;
    }
    if (!actionType) {
      let styles = controller.getStyleAt(idx).split(/\s+/);
      let style = ["autofill", "tag", "bookmark"].find(s => styles.includes(s));
      actionType = style || "history";
    }

    Services.telemetry
            .getHistogramById("FX_URLBAR_SELECTED_RESULT_INDEX")
            .add(idx);

    // Ideally this would be a keyed histogram and we'd just add(actionType),
    // but keyed histograms aren't currently shown on the telemetry dashboard
    // (bug 1151756).
    //
    // You can add values but don't change any of the existing values.
    // Otherwise you'll break our data.
    let buckets = {
      autofill: 0,
      bookmark: 1,
      history: 2,
      keyword: 3,
      searchengine: 4,
      searchsuggestion: 5,
      switchtab: 6,
      tag: 7,
      visiturl: 8,
    };
    if (actionType in buckets) {
      Services.telemetry
              .getHistogramById("FX_URLBAR_SELECTED_RESULT_TYPE")
              .add(buckets[actionType]);
    } else {
      Cu.reportError("Unknown FX_URLBAR_SELECTED_RESULT_TYPE type: " +
                     actionType);
    }
  },

  _syncSearchEngines: function () {
    // Only do this if the search service is already initialized. This function
    // gets called in finalUIStartup and from a browser-search-service observer,
    // to catch both cases (search service initialization occurring before and
    // after final-ui-startup)
    if (Services.search.isInitialized) {
      Services.search.defaultEngine = Services.search.currentEngine;
    }
  },

  // initialization (called on application startup)
  _init: function BG__init() {
    let os = Services.obs;
    os.addObserver(this, "notifications-open-settings", false);
    os.addObserver(this, "prefservice:after-app-defaults", false);
    os.addObserver(this, "final-ui-startup", false);
    os.addObserver(this, "browser-delayed-startup-finished", false);
    os.addObserver(this, "sessionstore-windows-restored", false);
    os.addObserver(this, "browser:purge-session-history", false);
    os.addObserver(this, "quit-application-requested", false);
    os.addObserver(this, "quit-application-granted", false);
#ifdef OBSERVE_LASTWINDOW_CLOSE_TOPICS
    os.addObserver(this, "browser-lastwindow-close-requested", false);
    os.addObserver(this, "browser-lastwindow-close-granted", false);
#endif
#ifdef MOZ_SERVICES_SYNC
    os.addObserver(this, "weave:service:ready", false);
    os.addObserver(this, "weave:engine:clients:display-uri", false);
#endif
    os.addObserver(this, "session-save", false);
    os.addObserver(this, "places-init-complete", false);
    this._isPlacesInitObserver = true;
    os.addObserver(this, "places-database-locked", false);
    this._isPlacesLockedObserver = true;
    os.addObserver(this, "distribution-customization-complete", false);
    os.addObserver(this, "places-shutdown", false);
    this._isPlacesShutdownObserver = true;
    os.addObserver(this, "handle-xul-text-link", false);
    os.addObserver(this, "profile-before-change", false);
    os.addObserver(this, "browser-search-engine-modified", false);
    os.addObserver(this, "browser-search-service", false);
    os.addObserver(this, "restart-in-safe-mode", false);
    os.addObserver(this, "flash-plugin-hang", false);
    os.addObserver(this, "xpi-signature-changed", false);
    os.addObserver(this, "autocomplete-did-enter-text", false);

    ExtensionManagement.registerScript("chrome://browser/content/ext-utils.js");
    ExtensionManagement.registerScript("chrome://browser/content/ext-browserAction.js");
    ExtensionManagement.registerScript("chrome://browser/content/ext-pageAction.js");
    ExtensionManagement.registerScript("chrome://browser/content/ext-contextMenus.js");
    ExtensionManagement.registerScript("chrome://browser/content/ext-tabs.js");
    ExtensionManagement.registerScript("chrome://browser/content/ext-windows.js");
    ExtensionManagement.registerScript("chrome://browser/content/ext-bookmarks.js");

    this._flashHangCount = 0;
  },

  // cleanup (called on application shutdown)
  _dispose: function BG__dispose() {
    let os = Services.obs;
    os.removeObserver(this, "notifications-open-settings");
    os.removeObserver(this, "prefservice:after-app-defaults");
    os.removeObserver(this, "final-ui-startup");
    os.removeObserver(this, "sessionstore-windows-restored");
    os.removeObserver(this, "browser:purge-session-history");
    os.removeObserver(this, "quit-application-requested");
    os.removeObserver(this, "quit-application-granted");
    os.removeObserver(this, "restart-in-safe-mode");
#ifdef OBSERVE_LASTWINDOW_CLOSE_TOPICS
    os.removeObserver(this, "browser-lastwindow-close-requested");
    os.removeObserver(this, "browser-lastwindow-close-granted");
#endif
#ifdef MOZ_SERVICES_SYNC
    os.removeObserver(this, "weave:service:ready");
    os.removeObserver(this, "weave:engine:clients:display-uri");
#endif
    os.removeObserver(this, "session-save");
    if (this._bookmarksBackupIdleTime) {
      this._idleService.removeIdleObserver(this, this._bookmarksBackupIdleTime);
      delete this._bookmarksBackupIdleTime;
    }
    if (this._isPlacesInitObserver)
      os.removeObserver(this, "places-init-complete");
    if (this._isPlacesLockedObserver)
      os.removeObserver(this, "places-database-locked");
    if (this._isPlacesShutdownObserver)
      os.removeObserver(this, "places-shutdown");
    os.removeObserver(this, "handle-xul-text-link");
    os.removeObserver(this, "profile-before-change");
    os.removeObserver(this, "browser-search-engine-modified");
    try {
      os.removeObserver(this, "browser-search-service");
      // may have already been removed by the observer
    } catch (ex) {}
    os.removeObserver(this, "flash-plugin-hang");
    os.removeObserver(this, "xpi-signature-changed");
    os.removeObserver(this, "autocomplete-did-enter-text");
  },

  _onAppDefaults: function BG__onAppDefaults() {
    // apply distribution customizations (prefs)
    // other customizations are applied in _finalUIStartup()
    this._distributionCustomizer.applyPrefDefaults();
  },

  _notifySlowAddon: function BG_notifySlowAddon(addonId) {
    let addonCallback = function(addon) {
      if (!addon) {
        Cu.reportError("couldn't look up addon: " + addonId);
        return;
      }
      let win = RecentWindow.getMostRecentBrowserWindow();

      if (!win) {
        return;
      }

      let brandBundle = win.document.getElementById("bundle_brand");
      let brandShortName = brandBundle.getString("brandShortName");
      let message = win.gNavigatorBundle.getFormattedString("addonwatch.slow", [addon.name, brandShortName]);
      let notificationBox = win.document.getElementById("global-notificationbox");
      let notificationId = 'addon-slow:' + addonId;
      let notification = notificationBox.getNotificationWithValue(notificationId);
      if(notification) {
        notification.label = message;
      } else {
        let buttons = [
          {
            label: win.gNavigatorBundle.getFormattedString("addonwatch.disable.label", [addon.name]),
            accessKey: win.gNavigatorBundle.getString("addonwatch.disable.accesskey"),
            callback: function() {
              addon.userDisabled = true;
              if (addon.pendingOperations != addon.PENDING_NONE) {
                let restartMessage = win.gNavigatorBundle.getFormattedString("addonwatch.restart.message", [addon.name, brandShortName]);
                let restartButton = [
                  {
                    label: win.gNavigatorBundle.getFormattedString("addonwatch.restart.label", [brandShortName]),
                    accessKey: win.gNavigatorBundle.getString("addonwatch.restart.accesskey"),
                    callback: function() {
                      let appStartup = Cc["@mozilla.org/toolkit/app-startup;1"]
                        .getService(Ci.nsIAppStartup);
                      appStartup.quit(appStartup.eForceQuit | appStartup.eRestart);
                    }
                  }
                ];
                const priority = notificationBox.PRIORITY_WARNING_MEDIUM;
                notificationBox.appendNotification(restartMessage, "restart-" + addonId, "",
                                                   priority, restartButton);
              }
            }
          },
          {
            label: win.gNavigatorBundle.getString("addonwatch.ignoreSession.label"),
            accessKey: win.gNavigatorBundle.getString("addonwatch.ignoreSession.accesskey"),
            callback: function() {
              AddonWatcher.ignoreAddonForSession(addonId);
            }
          },
          {
            label: win.gNavigatorBundle.getString("addonwatch.ignorePerm.label"),
            accessKey: win.gNavigatorBundle.getString("addonwatch.ignorePerm.accesskey"),
            callback: function() {
              AddonWatcher.ignoreAddonPermanently(addonId);
            }
          },
        ];

        const priority = notificationBox.PRIORITY_WARNING_MEDIUM;
        notificationBox.appendNotification(message, notificationId, "",
                                             priority, buttons);
      }
    };
    AddonManager.getAddonByID(addonId, addonCallback);
  },

  // runs on startup, before the first command line handler is invoked
  // (i.e. before the first window is opened)
  _finalUIStartup: function BG__finalUIStartup() {
    this._sanitizer.onStartup();
    // check if we're in safe mode
    if (Services.appinfo.inSafeMode) {
      Services.ww.openWindow(null, "chrome://browser/content/safeMode.xul", 
                             "_blank", "chrome,centerscreen,modal,resizable=no", null);
    }

    // apply distribution customizations
    // prefs are applied in _onAppDefaults()
    this._distributionCustomizer.applyCustomizations();

    // handle any UI migration
    this._migrateUI();

    this._setUpUserAgentOverrides();

    this._syncSearchEngines();

    PageThumbs.init();
    NewTabUtils.init();
    webrtcUI.init();
    AboutHome.init();
    SessionStore.init();
    BrowserUITelemetry.init();
    ContentSearch.init();
    FormValidationHandler.init();
    
    LoginManagerParent.init();
    
    // Make sure conflicting MSE prefs don't coexist
    if (Services.prefs.getBoolPref('media.mediasource.format-reader', true)) {
      Services.prefs.setBoolPref('media.mediasource.webm.enabled', false);
    }

    if (Services.prefs.getBoolPref("browser.tabs.remote"))
      ContentClick.init();
    Feeds.init();

    LoginManagerParent.init();
    ReaderParent.init();

#ifdef MOZ_CRASHREPORTER
    TabCrashReporter.init();
    PluginCrashReporter.init();
#endif

#ifndef RELEASE_BUILD
    let browserBundle = Services.strings.createBundle("chrome://browser/locale/browser.properties");
    let brandBundle = Services.strings.createBundle("chrome://branding/locale/brand.properties");
    let themeName = browserBundle.GetStringFromName("deveditionTheme.name");
    let vendorShortName = brandBundle.GetStringFromName("vendorShortName");

    LightweightThemeManager.addBuiltInTheme({
      id: "firefox-devedition@mozilla.org",
      name: themeName,
      headerURL: "resource:///chrome/browser/content/browser/defaultthemes/devedition.header.png",
      iconURL: "resource:///chrome/browser/content/browser/defaultthemes/devedition.icon.png",
      author: vendorShortName,
    });
#endif

    Services.obs.notifyObservers(null, "browser-ui-startup-complete", "");

#ifdef NIGHTLY_BUILD
    AddonWatcher.init(this._notifySlowAddon);
#endif
  },

  _setUpUserAgentOverrides: function BG__setUpUserAgentOverrides() {
    UserAgentOverrides.init();

    if (Services.prefs.getBoolPref("general.useragent.complexOverride.moodle")) {
      UserAgentOverrides.addComplexOverride(function (aHttpChannel, aOriginalUA) {
        let cookies;
        try {
          cookies = aHttpChannel.getRequestHeader("Cookie");
        } catch (e) { /* no cookie sent */ }
        if (cookies && cookies.indexOf("MoodleSession") > -1)
          return aOriginalUA.replace(/Gecko\/[^ ]*/, "Gecko/20100101");
        return null;
      });
    }
  },

  _onSafeModeRestart: function BG_onSafeModeRestart() {
    // prompt the user to confirm
    let strings = gBrowserBundle;
    let promptTitle = strings.GetStringFromName("safeModeRestartPromptTitle");
    let promptMessage = strings.GetStringFromName("safeModeRestartPromptMessage");
    let restartText = strings.GetStringFromName("safeModeRestartButton");
    let buttonFlags = (Services.prompt.BUTTON_POS_0 *
                       Services.prompt.BUTTON_TITLE_IS_STRING) +
                      (Services.prompt.BUTTON_POS_1 *
                       Services.prompt.BUTTON_TITLE_CANCEL) +
                      Services.prompt.BUTTON_POS_0_DEFAULT;

    let rv = Services.prompt.confirmEx(null, promptTitle, promptMessage,
                                       buttonFlags, restartText, null, null,
                                       null, {});
    if (rv != 0)
      return;

    let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"]
                       .createInstance(Ci.nsISupportsPRBool);
    Services.obs.notifyObservers(cancelQuit, "quit-application-requested", "restart");

    if (!cancelQuit.data) {
      Services.startup.restartInSafeMode(Ci.nsIAppStartup.eAttemptQuit);
    }
  },

  _trackSlowStartup: function () {
    if (Services.startup.interrupted ||
        Services.prefs.getBoolPref("browser.slowStartup.notificationDisabled"))
      return;

    let currentTime = Date.now() - Services.startup.getStartupInfo().process;
    let averageTime = 0;
    let samples = 0;
    try {
      averageTime = Services.prefs.getIntPref("browser.slowStartup.averageTime");
      samples = Services.prefs.getIntPref("browser.slowStartup.samples");
    } catch (e) { }

    averageTime = (averageTime * samples + currentTime) / ++samples;

    if (samples >= Services.prefs.getIntPref("browser.slowStartup.maxSamples")) {
      if (averageTime > Services.prefs.getIntPref("browser.slowStartup.timeThreshold"))
        this._showSlowStartupNotification();
      averageTime = 0;
      samples = 0;
    }

    Services.prefs.setIntPref("browser.slowStartup.averageTime", averageTime);
    Services.prefs.setIntPref("browser.slowStartup.samples", samples);
  },

  _showSlowStartupNotification: function () {
    let win = this.getMostRecentBrowserWindow();
    if (!win)
      return;

    let productName = gBrandBundle.GetStringFromName("brandFullName");
    let message = win.gNavigatorBundle.getFormattedString("slowStartup.message", [productName]);

    let buttons = [
      {
        label:     win.gNavigatorBundle.getString("slowStartup.helpButton.label"),
        accessKey: win.gNavigatorBundle.getString("slowStartup.helpButton.accesskey"),
        callback: function () {
          win.openUILinkIn(Services.prefs.getCharPref("browser.slowstartup.help.url"), "tab");
        }
      },
      {
        label:     win.gNavigatorBundle.getString("slowStartup.disableNotificationButton.label"),
        accessKey: win.gNavigatorBundle.getString("slowStartup.disableNotificationButton.accesskey"),
        callback: function () {
          Services.prefs.setBoolPref("browser.slowStartup.notificationDisabled", true);
        }
      }
    ];

    let nb = win.document.getElementById("global-notificationbox");
    nb.appendNotification(message, "slow-startup",
                          "chrome://browser/skin/slowStartup-16.png",
                          nb.PRIORITY_INFO_LOW, buttons);
  },

  /**
   * Show a notification bar offering a reset if the profile has been unused for some time.
   */
  _resetUnusedProfileNotification: function () {
    let win = this.getMostRecentBrowserWindow();
    if (!win)
      return;

    Cu.import("resource://gre/modules/ResetProfile.jsm");
    if (!ResetProfile.resetSupported())
      return;

    let productName = gBrandBundle.GetStringFromName("brandShortName");
    let resetBundle = Services.strings
                              .createBundle("chrome://global/locale/resetProfile.properties");

    let message = resetBundle.formatStringFromName("resetUnusedProfile.message", [productName], 1);
    let buttons = [
      {
        label:     resetBundle.formatStringFromName("refreshProfile.resetButton.label", [productName], 1),
        accessKey: resetBundle.GetStringFromName("refreshProfile.resetButton.accesskey"),
        callback: function () {
          ResetProfile.openConfirmationDialog(win);
        }
      },
    ];

    let nb = win.document.getElementById("global-notificationbox");
    nb.appendNotification(message, "reset-unused-profile",
                          "chrome://global/skin/icons/question-16.png",
                          nb.PRIORITY_INFO_LOW, buttons);
  },

  _notifyUnsignedAddonsDisabled: function () {
    let win = this.getMostRecentBrowserWindow();
    if (!win)
      return;

    let message = win.gNavigatorBundle.getString("unsignedAddonsDisabled.message");
    let buttons = [
      {
        label:     win.gNavigatorBundle.getString("unsignedAddonsDisabled.learnMore.label"),
        accessKey: win.gNavigatorBundle.getString("unsignedAddonsDisabled.learnMore.accesskey"),
        callback: function () {
          win.BrowserOpenAddonsMgr("addons://list/extension?unsigned=true");
        }
      },
    ];

    let nb = win.document.getElementById("high-priority-global-notificationbox");
    nb.appendNotification(message, "unsigned-addons-disabled", "",
                          nb.PRIORITY_WARNING_MEDIUM, buttons);
  },

  _firstWindowTelemetry: function(aWindow) {
#ifdef XP_WIN
    let SCALING_PROBE_NAME = "DISPLAY_SCALING_MSWIN";
#elifdef XP_MACOSX
    let SCALING_PROBE_NAME = "DISPLAY_SCALING_OSX";
#elifdef XP_LINUX
    let SCALING_PROBE_NAME = "DISPLAY_SCALING_LINUX";
#else
    let SCALING_PROBE_NAME = "";
#endif
    if (SCALING_PROBE_NAME) {
      let scaling = aWindow.devicePixelRatio * 100;
      Services.telemetry.getHistogramById(SCALING_PROBE_NAME).add(scaling);
    }
  },

  // the first browser window has finished initializing
  _onFirstWindowLoaded: function BG__onFirstWindowLoaded(aWindow) {

#ifdef NIGHTLY_BUILD
    // Registering Shumway bootstrap script the child processes.
    aWindow.messageManager.loadFrameScript("chrome://shumway/content/bootstrap-content.js", true);
    // Initializing Shumway (shall be run after child script registration).
    ShumwayUtils.init();
#endif

#ifdef XP_WIN
    // For windows seven, initialize the jump list module.
    const WINTASKBAR_CONTRACTID = "@mozilla.org/windows-taskbar;1";
    if (WINTASKBAR_CONTRACTID in Cc &&
        Cc[WINTASKBAR_CONTRACTID].getService(Ci.nsIWinTaskbar).available) {
      let temp = {};
      Cu.import("resource:///modules/WindowsJumpLists.jsm", temp);
      temp.WinTaskbarJumpList.startup();
    }
#endif

    this._trackSlowStartup();

    // Offer to reset a user's profile if it hasn't been used for 60 days.
    const OFFER_PROFILE_RESET_INTERVAL_MS = 60 * 24 * 60 * 60 * 1000;
    let processStartupTime = Services.startup.getStartupInfo().process;
    let lastUse = Services.appinfo.replacedLockTime;
    if (processStartupTime && lastUse &&
        processStartupTime.getTime() - lastUse >= OFFER_PROFILE_RESET_INTERVAL_MS) {
      this._resetUnusedProfileNotification();
    }

    this._firstWindowTelemetry(aWindow);
  },

  /**
   * Profile shutdown handler (contains profile cleanup routines).
   * All components depending on Places should be shut down in
   * _onPlacesShutdown() and not here.
   */
  _onProfileShutdown: function BG__onProfileShutdown() {
    UserAgentOverrides.uninit();
    webrtcUI.uninit();
    FormValidationHandler.uninit();
#ifdef NIGHTLY_BUILD
    AddonWatcher.uninit();
#endif
    this._dispose();
  },

  _initServiceDiscovery: function () {
    if (!Services.prefs.getBoolPref("browser.casting.enabled")) {
      return;
    }
    var rokuDevice = {
      id: "roku:ecp",
      target: "roku:ecp",
      factory: function(aService) {
        Cu.import("resource://gre/modules/RokuApp.jsm");
        return new RokuApp(aService);
      },
      mirror: true,
      types: ["video/mp4"],
      extensions: ["mp4"]
    };

    // Register targets
    SimpleServiceDiscovery.registerDevice(rokuDevice);

    // Search for devices continuously every 120 seconds
    SimpleServiceDiscovery.search(120 * 1000);
  },

  // All initial windows have opened.
  _onWindowsRestored: function BG__onWindowsRestored() {
    this._initServiceDiscovery();

    // Show update notification, if needed.
    if (Services.prefs.prefHasUserValue("app.update.postupdate"))
      this._showUpdateNotification();

    // Load the "more info" page for a locked places.sqlite
    // This property is set earlier by places-database-locked topic.
    if (this._isPlacesDatabaseLocked) {
      this._showPlacesLockedNotificationBox();
    }

    // If there are plugins installed that are outdated, and the user hasn't
    // been warned about them yet, open the plugins update page.
    // Pale Moon: disable this functionality, people are already notified
    // if they visit a page with an outdated plugin, and they can check
    // properly from the plugins page as well.
//    if (Services.prefs.getBoolPref(PREF_PLUGINS_NOTIFYUSER))
//      this._showPluginUpdatePage();

    // For any add-ons that were installed disabled and can be enabled offer
    // them to the user.
    let changedIDs = AddonManager.getStartupChanges(AddonManager.STARTUP_CHANGE_INSTALLED);
    if (changedIDs.length > 0) {
      let win = this.getMostRecentBrowserWindow();
      AddonManager.getAddonsByIDs(changedIDs, function(aAddons) {
        aAddons.forEach(function(aAddon) {
          // If the add-on isn't user disabled or can't be enabled then skip it.
          if (!aAddon.userDisabled || !(aAddon.permissions & AddonManager.PERM_CAN_ENABLE))
            return;

          win.openUILinkIn("about:newaddon?id=" + aAddon.id, "tab");
        })
      });
    }

#ifdef MOZ_REQUIRE_SIGNING
    let signingRequired = true;
#else
    let signingRequired = Services.prefs.getBoolPref("xpinstall.signatures.required");
#endif

    if (signingRequired) {
      let disabledAddons = AddonManager.getStartupChanges(AddonManager.STARTUP_CHANGE_DISABLED);
      AddonManager.getAddonsByIDs(disabledAddons, (addons) => {
        for (let addon of addons) {
          if (addon.type == "experiment")
            continue;

          if (addon.signedState <= AddonManager.SIGNEDSTATE_MISSING) {
            this._notifyUnsignedAddonsDisabled();
            break;
          }
        }
      });
    }

    // Perform default browser checking.
    if (ShellService) {
#ifdef DEBUG
      let shouldCheck = false;
#else
      let shouldCheck = ShellService.shouldCheckDefaultBrowser;
#endif
      let willRecoverSession = false;
      try {
        let ss = Cc["@mozilla.org/browser/sessionstartup;1"].
                 getService(Ci.nsISessionStartup);
        willRecoverSession =
          (ss.sessionType == Ci.nsISessionStartup.RECOVER_SESSION);
      }
      catch (ex) { /* never mind; suppose SessionStore is broken */ }

      // startup check, check all assoc
      let isDefault = ShellService.isDefaultBrowser(true, false);

      if (shouldCheck && !isDefault && !willRecoverSession) {
        Services.tm.mainThread.dispatch(function() {
          DefaultBrowserCheck.prompt(this.getMostRecentBrowserWindow());
        }.bind(this), Ci.nsIThread.DISPATCH_NORMAL);
      }
    }

#ifdef E10S_TESTING_ONLY
    E10SUINotification.checkStatus();
#endif
  },

  _onQuitRequest: function BG__onQuitRequest(aCancelQuit, aQuitType) {
    // If user has already dismissed quit request, then do nothing
    if ((aCancelQuit instanceof Ci.nsISupportsPRBool) && aCancelQuit.data)
      return;

    // There are several cases where we won't show a dialog here:
    // 1. There is only 1 tab open in 1 window
    // 2. The session will be restored at startup, indicated by
    //    browser.startup.page == 3 or browser.sessionstore.resume_session_once == true
    // 3. browser.warnOnQuit == false
    // 4. The browser is currently in Private Browsing mode
    // 5. The browser will be restarted.
    //
    // Otherwise these are the conditions and the associated dialogs that will be shown:
    // 1. aQuitType == "lastwindow" or "quit" and browser.showQuitWarning == true
    //    - The quit dialog will be shown
    // 2. aQuitType == "lastwindow" && browser.tabs.warnOnClose == true
    //    - The "closing multiple tabs" dialog will be shown
    //
    // aQuitType == "lastwindow" is overloaded. "lastwindow" is used to indicate
    // "the last window is closing but we're not quitting (a non-browser window is open)"
    // and also "we're quitting by closing the last window".

    if (aQuitType == "restart")
      return;

    var windowcount = 0;
    var pagecount = 0;
    var browserEnum = Services.wm.getEnumerator("navigator:browser");
    let allWindowsPrivate = true;
    while (browserEnum.hasMoreElements()) {
      // XXXbz should we skip closed windows here?
      windowcount++;

      var browser = browserEnum.getNext();
      if (!PrivateBrowsingUtils.isWindowPrivate(browser))
        allWindowsPrivate = false;
      var tabbrowser = browser.document.getElementById("content");
      if (tabbrowser)
        pagecount += tabbrowser.browsers.length - tabbrowser._numPinnedTabs;
    }

    this._saveSession = false;
    if (pagecount < 2)
      return;

    if (!aQuitType)
      aQuitType = "quit";

    // browser.warnOnQuit is a hidden global boolean to override all quit prompts
    // browser.showQuitWarning specifically covers quitting
    // browser.tabs.warnOnClose is the global "warn when closing multiple tabs" pref

    var sessionWillBeRestored = Services.prefs.getIntPref("browser.startup.page") == 3 ||
                                Services.prefs.getBoolPref("browser.sessionstore.resume_session_once");
    if (sessionWillBeRestored || !Services.prefs.getBoolPref("browser.warnOnQuit"))
      return;

    let win = Services.wm.getMostRecentWindow("navigator:browser");

    // On last window close or quit && showQuitWarning, we want to show the
    // quit warning.
    if (!Services.prefs.getBoolPref("browser.showQuitWarning")) {
      if (aQuitType == "lastwindow") {
        // If aQuitType is "lastwindow" and we aren't showing the quit warning,
        // we should show the window closing warning instead. warnAboutClosing
        // tabs checks browser.tabs.warnOnClose and returns if it's ok to close
        // the window. It doesn't actually close the window.
        aCancelQuit.data =
          !win.gBrowser.warnAboutClosingTabs(win.gBrowser.closingTabsEnum.ALL);
      }
      return;
    }

    let prompt = Services.prompt;
    let quitBundle = Services.strings.createBundle("chrome://browser/locale/quitDialog.properties");
    let appName = gBrandBundle.GetStringFromName("brandShortName");
    let quitDialogTitle = quitBundle.formatStringFromName("quitDialogTitle",
                                                          [appName], 1);
    let neverAskText = quitBundle.GetStringFromName("neverAsk2");
    let neverAsk = {value: false};

    let choice;
    if (allWindowsPrivate) {
      let text = quitBundle.formatStringFromName("messagePrivate", [appName], 1);
      let flags = prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_0 +
                  prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_1 +
                  prompt.BUTTON_POS_0_DEFAULT;
      choice = prompt.confirmEx(win, quitDialogTitle, text, flags,
                                quitBundle.GetStringFromName("quitTitle"),
                                quitBundle.GetStringFromName("cancelTitle"),
                                null,
                                neverAskText, neverAsk);

      // The order of the buttons differs between the prompt.confirmEx calls
      // here so we need to fix this for proper handling below.
      if (choice == 0) {
        choice = 2;
      }
    } else {
      let text = quitBundle.formatStringFromName(
        windowcount == 1 ? "messageNoWindows" : "message", [appName], 1);
      let flags = prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_0 +
                  prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_1 +
                  prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_2 +
                  prompt.BUTTON_POS_0_DEFAULT;
      choice = prompt.confirmEx(win, quitDialogTitle, text, flags,
                                quitBundle.GetStringFromName("saveTitle"),
                                quitBundle.GetStringFromName("cancelTitle"),
                                quitBundle.GetStringFromName("quitTitle"),
                                neverAskText, neverAsk);
    }

    switch (choice) {
    case 2: // Quit
      if (neverAsk.value)
        Services.prefs.setBoolPref("browser.showQuitWarning", false);
      break;
    case 1: // Cancel
      aCancelQuit.QueryInterface(Ci.nsISupportsPRBool);
      aCancelQuit.data = true;
      break;
    case 0: // Save & Quit
      this._saveSession = true;
      if (neverAsk.value) {
        // always save state when shutting down
        Services.prefs.setIntPref("browser.startup.page", 3);
      }
      break;
    }
  },

  _showUpdateNotification: function BG__showUpdateNotification() {
    Services.prefs.clearUserPref("app.update.postupdate");

    var um = Cc["@mozilla.org/updates/update-manager;1"].
             getService(Ci.nsIUpdateManager);
    try {
      // If the updates.xml file is deleted then getUpdateAt will throw.
      var update = um.getUpdateAt(0).QueryInterface(Ci.nsIPropertyBag);
    }
    catch (e) {
      // This should never happen.
      Cu.reportError("Unable to find update: " + e);
      return;
    }

    var actions = update.getProperty("actions");
    if (!actions || actions.indexOf("silent") != -1)
      return;

    var formatter = Cc["@mozilla.org/toolkit/URLFormatterService;1"].
                    getService(Ci.nsIURLFormatter);
    var appName = gBrandBundle.GetStringFromName("brandShortName");

    function getNotifyString(aPropData) {
      var propValue = update.getProperty(aPropData.propName);
      if (!propValue) {
        if (aPropData.prefName)
          propValue = formatter.formatURLPref(aPropData.prefName);
        else if (aPropData.stringParams)
          propValue = gBrowserBundle.formatStringFromName(aPropData.stringName,
                                                          aPropData.stringParams,
                                                          aPropData.stringParams.length);
        else
          propValue = gBrowserBundle.GetStringFromName(aPropData.stringName);
      }
      return propValue;
    }

    if (actions.indexOf("showNotification") != -1) {
      let text = getNotifyString({propName: "notificationText",
                                  stringName: "puNotifyText",
                                  stringParams: [appName]});
      let url = getNotifyString({propName: "notificationURL",
                                 prefName: "startup.homepage_override_url"});
      let label = getNotifyString({propName: "notificationButtonLabel",
                                   stringName: "pu.notifyButton.label"});
      let key = getNotifyString({propName: "notificationButtonAccessKey",
                                 stringName: "pu.notifyButton.accesskey"});

      let win = this.getMostRecentBrowserWindow();
      let notifyBox = win.gBrowser.getNotificationBox();

      let buttons = [
                      {
                        label:     label,
                        accessKey: key,
                        popup:     null,
                        callback: function(aNotificationBar, aButton) {
                          win.openUILinkIn(url, "tab");
                        }
                      }
                    ];

      let notification = notifyBox.appendNotification(text, "post-update-notification",
                                                      null, notifyBox.PRIORITY_INFO_LOW,
                                                      buttons);
      notification.persistence = -1; // Until user closes it
    }

    if (actions.indexOf("showAlert") == -1)
      return;

    let notifier;
    try {
      notifier = Cc["@mozilla.org/alerts-service;1"].
                 getService(Ci.nsIAlertsService);
    }
    catch (e) {
      // nsIAlertsService is not available for this platform
      return;
    }

    let title = getNotifyString({propName: "alertTitle",
                                 stringName: "puAlertTitle",
                                 stringParams: [appName]});
    let text = getNotifyString({propName: "alertText",
                                stringName: "puAlertText",
                                stringParams: [appName]});
    let url = getNotifyString({propName: "alertURL",
                               prefName: "startup.homepage_override_url"});

    var self = this;
    function clickCallback(subject, topic, data) {
      // This callback will be called twice but only once with this topic
      if (topic != "alertclickcallback")
        return;
      let win = self.getMostRecentBrowserWindow();
      win.openUILinkIn(data, "tab");
    }

    try {
      // This will throw NS_ERROR_NOT_AVAILABLE if the notification cannot
      // be displayed per the idl.
      notifier.showAlertNotification(null, title, text,
                                     true, url, clickCallback);
    }
    catch (e) {
    }
  },

  _showPluginUpdatePage: function BG__showPluginUpdatePage() {
    // Pale Moon: disable this functionality from BrowserGlue, people are 
    // already notified if they visit a page with an outdated plugin, and
    // they can check properly from the plugins page as well. 

//    Services.prefs.setBoolPref(PREF_PLUGINS_NOTIFYUSER, false);
//
//    var formatter = Cc["@mozilla.org/toolkit/URLFormatterService;1"].
//                    getService(Ci.nsIURLFormatter);
//    var updateUrl = formatter.formatURLPref(PREF_PLUGINS_UPDATEURL);
//
//    var win = this.getMostRecentBrowserWindow();
//    win.openUILinkIn(updateUrl, "tab");
  },

  /**
   * Initialize Places
   * - imports the bookmarks html file if bookmarks database is empty, try to
   *   restore bookmarks from a JSON/JSONLZ4 backup if the backend indicates
   *   that the database was corrupt.
   *
   * These prefs can be set up by the frontend:
   *
   * WARNING: setting these preferences to true will overwite existing bookmarks
   *
   * - browser.places.importBookmarksHTML
   *   Set to true will import the bookmarks.html file from the profile folder.
   * - browser.places.smartBookmarksVersion
   *   Set during HTML import to indicate that Smart Bookmarks were created.
   *   Set to -1 to disable Smart Bookmarks creation.
   *   Set to 0 to restore current Smart Bookmarks.
   * - browser.bookmarks.restore_default_bookmarks
   *   Set to true by safe-mode dialog to indicate we must restore default
   *   bookmarks.
   */
  _initPlaces: function BG__initPlaces(aInitialMigrationPerformed) {
    // We must instantiate the history service since it will tell us if we
    // need to import or restore bookmarks due to first-run, corruption or
    // forced migration (due to a major schema change).
    // If the database is corrupt or has been newly created we should
    // import bookmarks.
    let dbStatus = PlacesUtils.history.databaseStatus;
    let importBookmarks = !aInitialMigrationPerformed &&
                          (dbStatus == PlacesUtils.history.DATABASE_STATUS_CREATE ||
                           dbStatus == PlacesUtils.history.DATABASE_STATUS_CORRUPT);

    // Check if user or an extension has required to import bookmarks.html
    let importBookmarksHTML = false;
    try {
      importBookmarksHTML =
        Services.prefs.getBoolPref("browser.places.importBookmarksHTML");
      if (importBookmarksHTML)
        importBookmarks = true;
    } catch(ex) {}

    Task.spawn(function* () {
      // Check if Safe Mode or the user has required to restore bookmarks from
      // default profile's bookmarks.html
      let restoreDefaultBookmarks = false;
      try {
        restoreDefaultBookmarks =
          Services.prefs.getBoolPref("browser.bookmarks.restore_default_bookmarks");
        if (restoreDefaultBookmarks) {
          // Ensure that we already have a bookmarks backup for today.
          yield this._backupBookmarks();
          importBookmarks = true;
        }
      } catch(ex) {}

      // This may be reused later, check for "=== undefined" to see if it has
      // been populated already.
      let lastBackupFile;

      // If the user did not require to restore default bookmarks, or import
      // from bookmarks.html, we will try to restore from JSON
      if (importBookmarks && !restoreDefaultBookmarks && !importBookmarksHTML) {
        // get latest JSON backup
        lastBackupFile = yield PlacesBackups.getMostRecentBackup();
        if (lastBackupFile) {
          // restore from JSON backup
          yield BookmarkJSONUtils.importFromFile(lastBackupFile, true);
          importBookmarks = false;
        }
        else {
          // We have created a new database but we don't have any backup available
          importBookmarks = true;
          if (yield OS.File.exists(BookmarkHTMLUtils.defaultPath)) {
            // If bookmarks.html is available in current profile import it...
            importBookmarksHTML = true;
          }
          else {
            // ...otherwise we will restore defaults
            restoreDefaultBookmarks = true;
          }
        }
      }

      // If bookmarks are not imported, then initialize smart bookmarks.  This
      // happens during a common startup.
      // Otherwise, if any kind of import runs, smart bookmarks creation should be
      // delayed till the import operations has finished.  Not doing so would
      // cause them to be overwritten by the newly imported bookmarks.
      if (!importBookmarks) {
        // Now apply distribution customized bookmarks.
        // This should always run after Places initialization.
        yield this._distributionCustomizer.applyBookmarks();
        yield this.ensurePlacesDefaultQueriesInitialized();
      }
      else {
        // An import operation is about to run.
        // Don't try to recreate smart bookmarks if autoExportHTML is true or
        // smart bookmarks are disabled.
        var autoExportHTML = false;
        try {
          autoExportHTML = Services.prefs.getBoolPref("browser.bookmarks.autoExportHTML");
        } catch(ex) {}
        let smartBookmarksVersion = 0;
        try {
          smartBookmarksVersion = Services.prefs.getIntPref("browser.places.smartBookmarksVersion");
        } catch(ex) {}
        if (!autoExportHTML && smartBookmarksVersion != -1)
          Services.prefs.setIntPref("browser.places.smartBookmarksVersion", 0);

        let bookmarksUrl = null;
        if (restoreDefaultBookmarks) {
          // User wants to restore bookmarks.html file from default profile folder
          bookmarksUrl = "resource:///defaults/profile/bookmarks.html";
        }
        else if (yield OS.File.exists(BookmarkHTMLUtils.defaultPath)) {
          bookmarksUrl = OS.Path.toFileURI(BookmarkHTMLUtils.defaultPath);
        }

        if (bookmarksUrl) {
          // Import from bookmarks.html file.
          try {
            yield BookmarkHTMLUtils.importFromURL(bookmarksUrl, true);
          } catch (e) {
            Cu.reportError("Bookmarks.html file could be corrupt. " + e);
          }
          try {
            // Now apply distribution customized bookmarks.
            // This should always run after Places initialization.
            yield this._distributionCustomizer.applyBookmarks();
            // Ensure that smart bookmarks are created once the operation is
            // complete.
            yield this.ensurePlacesDefaultQueriesInitialized();
          } catch (e) {
            Cu.reportError(e);
          }

        }
        else {
          Cu.reportError(new Error("Unable to find bookmarks.html file."));
        }

        // See #1083:
        // "Delete all bookmarks except for backups" in Safe Mode doesn't work
        var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        let observer = {
          "observe": function() {
            delete observer.timer;
            // Reset preferences, so we won't try to import again at next run
            if (importBookmarksHTML) {
              Services.prefs.setBoolPref("browser.places.importBookmarksHTML", false);
            }
            if (restoreDefaultBookmarks) {
              Services.prefs.setBoolPref("browser.bookmarks.restore_default_bookmarks",
                                         false);
            }
          },
          "timer": timer,
        };
        timer.init(observer, 100, Ci.nsITimer.TYPE_ONE_SHOT);
      }

      // Initialize bookmark archiving on idle.
      if (!this._bookmarksBackupIdleTime) {
        this._bookmarksBackupIdleTime = BOOKMARKS_BACKUP_IDLE_TIME_SEC;

        // If there is no backup, or the last bookmarks backup is too old, use
        // a more aggressive idle observer.
        if (lastBackupFile === undefined)
          lastBackupFile = yield PlacesBackups.getMostRecentBackup();
        if (!lastBackupFile) {
            this._bookmarksBackupIdleTime /= 2;
        }
        else {
          let lastBackupTime = PlacesBackups.getDateForFile(lastBackupFile);
          let profileLastUse = Services.appinfo.replacedLockTime || Date.now();

          // If there is a backup after the last profile usage date it's fine,
          // regardless its age.  Otherwise check how old is the last
          // available backup compared to that session.
          if (profileLastUse > lastBackupTime) {
            let backupAge = Math.round((profileLastUse - lastBackupTime) / 86400000);
            // Report the age of the last available backup.
            try {
              Services.telemetry
                      .getHistogramById("PLACES_BACKUPS_DAYSFROMLAST")
                      .add(backupAge);
            } catch (ex) {
              Components.utils.reportError("Unable to report telemetry.");
            }

            if (backupAge > BOOKMARKS_BACKUP_MAX_INTERVAL_DAYS)
              this._bookmarksBackupIdleTime /= 2;
          }
        }
        this._idleService.addIdleObserver(this, this._bookmarksBackupIdleTime);
      }

    }.bind(this)).catch(ex => {
      Cu.reportError(ex);
    }).then(result => {
      // NB: deliberately after the catch so that we always do this, even if
      // we threw halfway through initializing in the Task above.
      Services.obs.notifyObservers(null, "places-browser-init-complete", "");
    });
  },

  /**
   * Places shut-down tasks
   * - finalize components depending on Places.
   * - export bookmarks as HTML, if so configured.
   */
  _onPlacesShutdown: function BG__onPlacesShutdown() {
    PageThumbs.uninit();

    if (this._bookmarksBackupIdleTime) {
      this._idleService.removeIdleObserver(this, this._bookmarksBackupIdleTime);
      delete this._bookmarksBackupIdleTime;
    }

    // Support legacy bookmarks.html format for apps that depend on that format.
    try {
      if (Services.prefs.getBoolPref("browser.bookmarks.autoExportHTML")) {
        // places-shutdown happens at profile-change-teardown, so here we
        // can safely add a profile-before-change blocker.
        AsyncShutdown.profileBeforeChange.addBlocker(
          "Places: bookmarks.html",
          () => BookmarkHTMLUtils.exportToFile(Services.dirsvc.get("BMarks", Ci.nsIFile))
                                 .then(null, Cu.reportError)
        );
      }
    } catch (ex) {} // Do not export.
  },

  /**
   * If a backup for today doesn't exist, this creates one.
   */
  _backupBookmarks: function BG__backupBookmarks() {
    return Task.spawn(function() {
      let lastBackupFile = yield PlacesBackups.getMostRecentBackup();
      // Should backup bookmarks if there are no backups or the maximum
      // interval between backups elapsed.
      if (!lastBackupFile ||
          new Date() - PlacesBackups.getDateForFile(lastBackupFile) > BOOKMARKS_BACKUP_MIN_INTERVAL_DAYS * 86400000) {
        let maxBackups = Services.prefs.getIntPref("browser.bookmarks.max_backups");
        yield PlacesBackups.create(maxBackups);
      }
    });
  },

  /**
   * Show the notificationBox for a locked places database.
   */
  _showPlacesLockedNotificationBox: function BG__showPlacesLockedNotificationBox() {
    var applicationName = gBrandBundle.GetStringFromName("brandShortName");
    var placesBundle = Services.strings.createBundle("chrome://browser/locale/places/places.properties");
    var title = placesBundle.GetStringFromName("lockPrompt.title");
    var text = placesBundle.formatStringFromName("lockPrompt.text", [applicationName], 1);
    var buttonText = placesBundle.GetStringFromName("lockPromptInfoButton.label");
    var accessKey = placesBundle.GetStringFromName("lockPromptInfoButton.accessKey");

    var helpTopic = "places-locked";
    var url = Cc["@mozilla.org/toolkit/URLFormatterService;1"].
              getService(Components.interfaces.nsIURLFormatter).
              formatURLPref("app.support.baseURL");
    url += helpTopic;

    var win = this.getMostRecentBrowserWindow();

    var buttons = [
                    {
                      label:     buttonText,
                      accessKey: accessKey,
                      popup:     null,
                      callback:  function(aNotificationBar, aButton) {
                        win.openUILinkIn(url, "tab");
                      }
                    }
                  ];

    var notifyBox = win.gBrowser.getNotificationBox();
    var notification = notifyBox.appendNotification(text, title, null,
                                                    notifyBox.PRIORITY_CRITICAL_MEDIUM,
                                                    buttons);
    notification.persistence = -1; // Until user closes it
  },

  _migrateUI: function BG__migrateUI() {
    const UI_VERSION = 28;
    const BROWSER_DOCURL = "chrome://browser/content/browser.xul";
    let currentUIVersion = 0;
    try {
      currentUIVersion = Services.prefs.getIntPref("browser.migration.version");
    } catch(ex) {}
    if (currentUIVersion >= UI_VERSION)
      return;

    let xulStore = Cc["@mozilla.org/xul/xulstore;1"].getService(Ci.nsIXULStore);

    if (currentUIVersion < 2) {
      // This code adds the customizable bookmarks button.
      let currentset = xulStore.getValue(BROWSER_DOCURL, "nav-bar", "currentset");
      // Need to migrate only if toolbar is customized and the element is not found.
      if (currentset &&
          currentset.indexOf("bookmarks-menu-button-container") == -1) {
        currentset += ",bookmarks-menu-button-container";
        xulStore.setValue(BROWSER_DOCURL, "nav-bar", "currentset", currentset);
      }
    }

    if (currentUIVersion < 3) {
      // This code merges the reload/stop/go button into the url bar.
      let currentset = xulStore.getValue(BROWSER_DOCURL, "nav-bar", "currentset");
      // Need to migrate only if toolbar is customized and all 3 elements are found.
      if (currentset &&
          currentset.indexOf("reload-button") != -1 &&
          currentset.indexOf("stop-button") != -1 &&
          currentset.indexOf("urlbar-container") != -1 &&
          currentset.indexOf("urlbar-container,reload-button,stop-button") == -1) {
        currentset = currentset.replace(/(^|,)reload-button($|,)/, "$1$2")
                               .replace(/(^|,)stop-button($|,)/, "$1$2")
                               .replace(/(^|,)urlbar-container($|,)/,
                                        "$1urlbar-container,reload-button,stop-button$2");
        xulStore.setValue(BROWSER_DOCURL, "nav-bar", "currentset", currentset);
      }
    }

    if (currentUIVersion < 4) {
      // This code moves the home button to the immediate left of the bookmarks menu button.
      let currentset = xulStore.getValue(BROWSER_DOCURL, "nav-bar", "currentset");
      // Need to migrate only if toolbar is customized and the elements are found.
      if (currentset &&
          currentset.indexOf("home-button") != -1 &&
          currentset.indexOf("bookmarks-menu-button-container") != -1) {
        currentset = currentset.replace(/(^|,)home-button($|,)/, "$1$2")
                               .replace(/(^|,)bookmarks-menu-button-container($|,)/,
                                        "$1home-button,bookmarks-menu-button-container$2");
        xulStore.setValue(BROWSER_DOCURL, "nav-bar", "currentset", currentset);
      }
    }

    if (currentUIVersion < 5) {
      // This code uncollapses PersonalToolbar if its collapsed status is not
      // persisted, and user customized it or changed default bookmarks.
      //
      // If the user does not have a persisted value for the toolbar's
      // "collapsed" attribute, try to determine whether it's customized.
      if (!xulStore.hasValue(BROWSER_DOCURL, "PersonalToolbar", "collapsed")) {
        // We consider the toolbar customized if it has more than
        // 3 children, or if it has a persisted currentset value.
        let toolbarIsCustomized = xulStore.hasValue(BROWSER_DOCURL,
                                                    "PersonalToolbar", "currentset");
        let getToolbarFolderCount = function () {
          let toolbarFolder =
            PlacesUtils.getFolderContents(PlacesUtils.toolbarFolderId).root;
          let toolbarChildCount = toolbarFolder.childCount;
          toolbarFolder.containerOpen = false;
          return toolbarChildCount;
        };

        if (toolbarIsCustomized || getToolbarFolderCount() > 3) {
          xulStore.setValue(BROWSER_DOCURL, "PersonalToolbar", "collapsed", "false");
        }
      }
    }

    if (currentUIVersion < 9) {
      // This code adds the customizable downloads buttons.
      let currentset = xulStore.getValue(BROWSER_DOCURL, "nav-bar", "currentset");

      // Since the Downloads button is located in the navigation bar by default,
      // migration needs to happen only if the toolbar was customized using a
      // previous UI version, and the button was not already placed on the
      // toolbar manually.
      if (currentset &&
          currentset.indexOf("downloads-button") == -1) {
        // The element is added either after the search bar or before the home
        // button. As a last resort, the element is added just before the
        // non-customizable window controls.
        if (currentset.indexOf("search-container") != -1) {
          currentset = currentset.replace(/(^|,)search-container($|,)/,
                                          "$1search-container,downloads-button$2")
        } else if (currentset.indexOf("home-button") != -1) {
          currentset = currentset.replace(/(^|,)home-button($|,)/,
                                          "$1downloads-button,home-button$2")
        } else {
          currentset = currentset.replace(/(^|,)window-controls($|,)/,
                                          "$1downloads-button,window-controls$2")
        }
        xulStore.setValue(BROWSER_DOCURL, "nav-bar", "currentset", currentset);
      }

      Services.prefs.clearUserPref("browser.download.useToolkitUI");
      Services.prefs.clearUserPref("browser.library.useNewDownloadsView");
    }

#ifdef XP_WIN
    if (currentUIVersion < 10) {
      // For Windows systems with display set to > 96dpi (i.e. systemDefaultScale
      // will return a value > 1.0), we want to discard any saved full-zoom settings,
      // as we'll now be scaling the content according to the system resolution
      // scale factor (Windows "logical DPI" setting)
      let sm = Cc["@mozilla.org/gfx/screenmanager;1"].getService(Ci.nsIScreenManager);
      if (sm.systemDefaultScale > 1.0) {
        let cps2 = Cc["@mozilla.org/content-pref/service;1"].
                   getService(Ci.nsIContentPrefService2);
        cps2.removeByName("browser.content.full-zoom", null);
      }
    }
#endif

    if (currentUIVersion < 11) {
      Services.prefs.clearUserPref("dom.disable_window_move_resize");
      Services.prefs.clearUserPref("dom.disable_window_flip");
      Services.prefs.clearUserPref("dom.event.contextmenu.enabled");
      Services.prefs.clearUserPref("javascript.enabled");
      Services.prefs.clearUserPref("permissions.default.image");
    }

    if (currentUIVersion < 12) {
      // Remove bookmarks-menu-button-container, then place
      // bookmarks-menu-button into its position.
      let currentset = xulStore.getValue(BROWSER_DOCURL, "nav-bar", "currentset");
      // Need to migrate only if toolbar is customized.
      if (currentset) {
        if (currentset.includes("bookmarks-menu-button-container")) {
          currentset = currentset.replace(/(^|,)bookmarks-menu-button-container($|,)/,
                                          "$1bookmarks-menu-button$2");
          xulStore.setValue(BROWSER_DOCURL, "nav-bar", "currentset", currentset);
        }
      }
    }

    if (currentUIVersion < 14) {
      // DOM Storage doesn't specially handle about: pages anymore.
      let path = OS.Path.join(OS.Constants.Path.profileDir,
                              "chromeappsstore.sqlite");
      OS.File.remove(path);
    }

    if (currentUIVersion < 16) {
      xulStore.removeValue(BROWSER_DOCURL, "nav-bar", "collapsed");
    }

    // Insert the bookmarks-menu-button into the nav-bar if it isn't already
    // there.
    if (currentUIVersion < 17) {
      let currentset = xulStore.getValue(BROWSER_DOCURL, "nav-bar", "currentset");
      // Need to migrate only if toolbar is customized.
      if (currentset) {
        if (!currentset.includes("bookmarks-menu-button")) {
          // The button isn't in the nav-bar, so let's look for an appropriate
          // place to put it.
          if (currentset.includes("downloads-button")) {
            currentset = currentset.replace(/(^|,)downloads-button($|,)/,
                                            "$1bookmarks-menu-button,downloads-button$2");
          } else if (currentset.includes("home-button")) {
            currentset = currentset.replace(/(^|,)home-button($|,)/,
                                            "$1bookmarks-menu-button,home-button$2");
          } else {
            // Just append.
            currentset = currentset.replace(/(^|,)window-controls($|,)/,
                                            "$1bookmarks-menu-button,window-controls$2")
          }
          xulStore.setValue(BROWSER_DOCURL, "nav-bar", "currentset", currentset);
        }
      }
    }

    if (currentUIVersion < 18) {
      // Remove iconsize and mode from all the toolbars
      let toolbars = ["navigator-toolbox", "nav-bar", "PersonalToolbar",
                      "addon-bar", "TabsToolbar", "toolbar-menubar"];
      for (let resourceName of ["mode", "iconsize"]) {
        for (let toolbarId of toolbars) {
          xulStore.removeValue(BROWSER_DOCURL, toolbarId, resourceName);
        }
      }
    }

    if (currentUIVersion < 19) {
      let detector = null;    
      try {
        detector = Services.prefs.getComplexValue("intl.charset.detector",
                                                  Ci.nsIPrefLocalizedString).data;
      } catch (ex) {}
      if (!(detector == "" ||
            detector == "ja_parallel_state_machine" ||
            detector == "ruprob" ||
            detector == "ukprob")) {
        // If the encoding detector pref value is not reachable from the UI,
        // reset to default (varies by localization).
        Services.prefs.clearUserPref("intl.charset.detector");
      }
    }

    if (currentUIVersion < 20) {
      // Remove persisted collapsed state from TabsToolbar.
      xulStore.removeValue(BROWSER_DOCURL, "TabsToolbar", "collapsed");
    }

    if (currentUIVersion < 22) {
      // Reset the Sync promobox count to promote the new FxAccount-based Sync.
      Services.prefs.clearUserPref("browser.syncPromoViewsLeft");
      Services.prefs.clearUserPref("browser.syncPromoViewsLeftMap");
    }

    if (currentUIVersion < 23) {
      const kSelectedEnginePref = "browser.search.selectedEngine";
      if (Services.prefs.prefHasUserValue(kSelectedEnginePref)) {
        try {
          let name = Services.prefs.getComplexValue(kSelectedEnginePref,
                                                    Ci.nsIPrefLocalizedString).data;
          Services.search.currentEngine = Services.search.getEngineByName(name);
        } catch (ex) {}
      }
    }

    if (currentUIVersion < 24) {
      // Reset homepage pref for users who have it set to start.mozilla.org
      // or google.com/firefox.
      const HOMEPAGE_PREF = "browser.startup.homepage";
      if (Services.prefs.prefHasUserValue(HOMEPAGE_PREF)) {
        const DEFAULT =
          Services.prefs.getDefaultBranch(HOMEPAGE_PREF)
                        .getComplexValue("", Ci.nsIPrefLocalizedString).data;
        let value =
          Services.prefs.getComplexValue(HOMEPAGE_PREF, Ci.nsISupportsString);
        let updated =
          value.data.replace(/https?:\/\/start\.mozilla\.org[^|]*/i, DEFAULT)
                    .replace(/https?:\/\/(www\.)?google\.[a-z.]+\/firefox[^|]*/i,
                             DEFAULT);
        if (updated != value.data) {
          if (updated == DEFAULT) {
            Services.prefs.clearUserPref(HOMEPAGE_PREF);
          } else {
            value.data = updated;
            Services.prefs.setComplexValue(HOMEPAGE_PREF,
                                           Ci.nsISupportsString, value);
          }
        }
      }
    }

    if (currentUIVersion < 25) {
      // Make sure the doNotTrack value conforms to the conversion from
      // three-state to two-state. (This reverts a setting of "please track me"
      // to the default "don't say anything").
      try {
        if (Services.prefs.getBoolPref("privacy.donottrackheader.enabled") &&
            Services.prefs.getIntPref("privacy.donottrackheader.value") != 1) {
          Services.prefs.clearUserPref("privacy.donottrackheader.enabled");
          Services.prefs.clearUserPref("privacy.donottrackheader.value");
        }
      }
      catch (ex) {}
    }

    if (currentUIVersion < 26) {
      // Refactor urlbar suggestion preferences to make it extendable and
      // allow new suggestion types (e.g: search suggestions).
      let types = ["history", "bookmark", "openpage"];
      let defaultBehavior = 0;
      try {
        defaultBehavior = Services.prefs.getIntPref("browser.urlbar.default.behavior");
      } catch (ex) {}
      try {
        let autocompleteEnabled = Services.prefs.getBoolPref("browser.urlbar.autocomplete.enabled");
        if (!autocompleteEnabled) {
          defaultBehavior = -1;
        }
      } catch (ex) {}

      // If the default behavior is:
      //    -1  - all new "...suggest.*" preferences will be false
      //     0  - all new "...suggest.*" preferences will use the default values
      //   > 0  - all new "...suggest.*" preferences will be inherited
      for (let type of types) {
        let prefValue = defaultBehavior == 0;
        if (defaultBehavior > 0) {
          prefValue = !!(defaultBehavior & Ci.mozIPlacesAutoComplete["BEHAVIOR_" + type.toUpperCase()]);
        }
        Services.prefs.setBoolPref("browser.urlbar.suggest." + type, prefValue);
      }

      // Typed behavior will be used only for results from history.
      if (defaultBehavior != -1 &&
          !!(defaultBehavior & Ci.mozIPlacesAutoComplete["BEHAVIOR_TYPED"])) {
        Services.prefs.setBoolPref("browser.urlbar.suggest.history.onlyTyped", true);
      }
    }

    if (currentUIVersion < 27) {
      // Fix up document color use:
      const kOldColorPref = "browser.display.use_document_colors";
      if (Services.prefs.prefHasUserValue(kOldColorPref) &&
          !Services.prefs.getBoolPref(kOldColorPref)) {
        Services.prefs.setIntPref("browser.display.document_color_use", 2);
      }
    }

    if (currentUIVersion < 29) {
      let group = null;
      try {
        group = Services.prefs.getComplexValue("font.language.group",
                                               Ci.nsIPrefLocalizedString);
      } catch (ex) {}
      if (group &&
          ["tr", "x-baltic", "x-central-euro"].some(g => g == group.data)) {
        // Latin groups were consolidated.
        group.data = "x-western";
        Services.prefs.setComplexValue("font.language.group",
                                       Ci.nsIPrefLocalizedString, group);
      }
    }

    if (currentUIVersion < 30) {
      // Convert old devedition theme pref to lightweight theme storage
      let lightweightThemeSelected = false;
      let selectedThemeID = null;
      try {
        lightweightThemeSelected = Services.prefs.prefHasUserValue("lightweightThemes.selectedThemeID");
        selectedThemeID = Services.prefs.getCharPref("lightweightThemes.selectedThemeID");
      } catch(e) {}

      let defaultThemeSelected = false;
      try {
         defaultThemeSelected = Services.prefs.getCharPref("general.skins.selectedSkin") == "classic/1.0";
      } catch(e) {}

      let deveditionThemeEnabled = false;
      try {
         deveditionThemeEnabled = Services.prefs.getBoolPref("browser.devedition.theme.enabled");
      } catch(e) {}

      // If we are on the devedition channel, the devedition theme is on by
      // default.  But we need to handle the case where they didn't want it
      // applied, and unapply the theme.
      let userChoseToNotUseDeveditionTheme =
        !deveditionThemeEnabled ||
        !defaultThemeSelected ||
        (lightweightThemeSelected && selectedThemeID != "firefox-devedition@mozilla.org");

      if (userChoseToNotUseDeveditionTheme && selectedThemeID == "firefox-devedition@mozilla.org") {
        Services.prefs.setCharPref("lightweightThemes.selectedThemeID", "");
      }

      // Not clearing browser.devedition.theme.enabled, to preserve user's pref
      // if for some reason this function runs again (even though it shouldn't)
      Services.prefs.clearUserPref("browser.devedition.showCustomizeButton");
    }

    if (currentUIVersion < 31) {
      xulStore.removeValue(BROWSER_DOCURL, "bookmarks-menu-button", "class");
      xulStore.removeValue(BROWSER_DOCURL, "home-button", "class");
    }

    // Update the migration version.
    Services.prefs.setIntPref("browser.migration.version", UI_VERSION);
  },

  // ------------------------------
  // public nsIBrowserGlue members
  // ------------------------------

  sanitize: function BG_sanitize(aParentWindow) {
    this._sanitizer.sanitize(aParentWindow);
  },

  ensurePlacesDefaultQueriesInitialized: Task.async(function* () {
    // This is the current smart bookmarks version, it must be increased every
    // time they change.
    // When adding a new smart bookmark below, its newInVersion property must
    // be set to the version it has been added in.  We will compare its value
    // to users' smartBookmarksVersion and add new smart bookmarks without
    // recreating old deleted ones.
    const SMART_BOOKMARKS_VERSION = 7;
    const SMART_BOOKMARKS_ANNO = "Places/SmartBookmark";
    const SMART_BOOKMARKS_PREF = "browser.places.smartBookmarksVersion";

    // TODO bug 399268: should this be a pref?
    const MAX_RESULTS = 10;

    // Get current smart bookmarks version.  If not set, create them.
    let smartBookmarksCurrentVersion = 0;
    try {
      smartBookmarksCurrentVersion = Services.prefs.getIntPref(SMART_BOOKMARKS_PREF);
    } catch(ex) {}

    // If version is current, or smart bookmarks are disabled, bail out.
    if (smartBookmarksCurrentVersion == -1 ||
        smartBookmarksCurrentVersion >= SMART_BOOKMARKS_VERSION) {
      return;
    }

    try {
      let menuIndex = 0;
      let toolbarIndex = 0;
      let bundle = Services.strings.createBundle("chrome://browser/locale/places/places.properties");
      let queryOptions = Ci.nsINavHistoryQueryOptions;

      let smartBookmarks = {
        MostVisited: {
          title: bundle.GetStringFromName("mostVisitedTitle"),
          url: "place:sort=" + queryOptions.SORT_BY_VISITCOUNT_DESCENDING +
                    "&maxResults=" + MAX_RESULTS,
          parentGuid: PlacesUtils.bookmarks.toolbarGuid,
          newInVersion: 1
        },
        RecentlyBookmarked: {
          title: bundle.GetStringFromName("recentlyBookmarkedTitle"),
          url: "place:folder=BOOKMARKS_MENU" +
                    "&folder=UNFILED_BOOKMARKS" +
                    "&folder=TOOLBAR" +
                    "&queryType=" + queryOptions.QUERY_TYPE_BOOKMARKS +
                    "&sort=" + queryOptions.SORT_BY_DATEADDED_DESCENDING +
                    "&maxResults=" + MAX_RESULTS +
                    "&excludeQueries=1",
          parentGuid: PlacesUtils.bookmarks.menuGuid,
          newInVersion: 1
        },
        RecentTags: {
          title: bundle.GetStringFromName("recentTagsTitle"),
          url: "place:type=" + queryOptions.RESULTS_AS_TAG_QUERY +
                    "&sort=" + queryOptions.SORT_BY_LASTMODIFIED_DESCENDING +
                    "&maxResults=" + MAX_RESULTS,
          parentGuid: PlacesUtils.bookmarks.menuGuid,
          newInVersion: 1
        },
      };

      // Set current guid, parentGuid and index of existing Smart Bookmarks.
      // We will use those to create a new version of the bookmark at the same
      // position.
      let smartBookmarkItemIds = PlacesUtils.annotations.getItemsWithAnnotation(SMART_BOOKMARKS_ANNO);
      for (let itemId of smartBookmarkItemIds) {
        let queryId = PlacesUtils.annotations.getItemAnnotation(itemId, SMART_BOOKMARKS_ANNO);
        if (queryId in smartBookmarks) {
          // Known smart bookmark.
          let smartBookmark = smartBookmarks[queryId];
          smartBookmark.guid = yield PlacesUtils.promiseItemGuid(itemId);

          if (!smartBookmark.url) {
            yield PlacesUtils.bookmarks.remove(smartBookmark.guid);
            continue;
          }

          let bm = yield PlacesUtils.bookmarks.fetch(smartBookmark.guid);
          smartBookmark.parentGuid = bm.parentGuid;
          smartBookmark.index = bm.index;
        }
        else {
          // We don't remove old Smart Bookmarks because user could still
          // find them useful, or could have personalized them.
          // Instead we remove the Smart Bookmark annotation.
          PlacesUtils.annotations.removeItemAnnotation(itemId, SMART_BOOKMARKS_ANNO);
        }
      }

      for (let queryId of Object.keys(smartBookmarks)) {
        let smartBookmark = smartBookmarks[queryId];

        // We update or create only changed or new smart bookmarks.
        // Also we respect user choices, so we won't try to create a smart
        // bookmark if it has been removed.
        if (smartBookmarksCurrentVersion > 0 &&
            smartBookmark.newInVersion <= smartBookmarksCurrentVersion &&
            !smartBookmark.guid || !smartBookmark.url)
          continue;

        // Remove old version of the smart bookmark if it exists, since it
        // will be replaced in place.
        if (smartBookmark.guid) {
          yield PlacesUtils.bookmarks.remove(smartBookmark.guid);
        }

        // Create the new smart bookmark and store its updated guid.
        if (!("index" in smartBookmark)) {
          if (smartBookmark.parentGuid == PlacesUtils.bookmarks.toolbarGuid)
            smartBookmark.index = toolbarIndex++;
          else if (smartBookmark.parentGuid == PlacesUtils.bookmarks.menuGuid)
            smartBookmark.index = menuIndex++;
        }
        smartBookmark = yield PlacesUtils.bookmarks.insert(smartBookmark);
        let itemId = yield PlacesUtils.promiseItemId(smartBookmark.guid);
        PlacesUtils.annotations.setItemAnnotation(itemId,
                                                  SMART_BOOKMARKS_ANNO,
                                                  queryId, 0,
                                                  PlacesUtils.annotations.EXPIRE_NEVER);
      }

      // If we are creating all Smart Bookmarks from ground up, add a
      // separator below them in the bookmarks menu.
      if (smartBookmarksCurrentVersion == 0 &&
          smartBookmarkItemIds.length == 0) {
        let bm = yield PlacesUtils.bookmarks.fetch({ parentGuid: PlacesUtils.bookmarks.menuGuid,
                                                     index: menuIndex });
        // Don't add a separator if the menu was empty or there is one already.
        if (bm && bm.type != PlacesUtils.bookmarks.TYPE_SEPARATOR) {
          yield PlacesUtils.bookmarks.insert({ type: PlacesUtils.bookmarks.TYPE_SEPARATOR,
                                               parentGuid: PlacesUtils.bookmarks.menuGuid,
                                               index: menuIndex });
        }
      }
    } catch(ex) {
      Cu.reportError(ex);
    } finally {
      Services.prefs.setIntPref(SMART_BOOKMARKS_PREF, SMART_BOOKMARKS_VERSION);
      Services.prefs.savePrefFile(null);
    }
  }),

  // this returns the most recent non-popup browser window
  getMostRecentBrowserWindow: function BG_getMostRecentBrowserWindow() {
    return RecentWindow.getMostRecentBrowserWindow();
  },

  /**
   * Open preferences even if there are no open windows.
   */
  _openPreferences(...args) {
    if (Services.appShell.hiddenDOMWindow.openPreferences) {
      Services.appShell.hiddenDOMWindow.openPreferences(...args);
      return;
    }

    let chromeWindow = RecentWindow.getMostRecentBrowserWindow();
    chromeWindow.openPreferences(...args);
  },

#ifdef MOZ_SERVICES_SYNC
  /**
   * Called as an observer when Sync's "display URI" notification is fired.
   *
   * We open the received URI in a background tab.
   *
   * Eventually, this will likely be replaced by a more robust tab syncing
   * feature. This functionality is considered somewhat evil by UX because it
   * opens a new tab automatically without any prompting. However, it is a
   * lesser evil than sending a tab to a specific device (from e.g. Fennec)
   * and having nothing happen on the receiving end.
   */
  _onDisplaySyncURI: function _onDisplaySyncURI(data) {
    try {
      let tabbrowser = RecentWindow.getMostRecentBrowserWindow({private: false}).gBrowser;

      // The payload is wrapped weirdly because of how Sync does notifications.
      tabbrowser.addTab(data.wrappedJSObject.object.uri);
    } catch (ex) {
      Cu.reportError("Error displaying tab received by Sync: " + ex);
    }
  },
#endif

  _handleFlashHang: function() {
    ++this._flashHangCount;
    if (this._flashHangCount < 2) {
      return;
    }
    // protected mode only applies to win32
    if (Services.appinfo.XPCOMABI != "x86-msvc") {
      return;
    }

    if (Services.prefs.getBoolPref("dom.ipc.plugins.flash.disable-protected-mode")) {
      return;
    }
    if (!Services.prefs.getBoolPref("browser.flash-protected-mode-flip.enable")) {
      return;
    }
    if (Services.prefs.getBoolPref("browser.flash-protected-mode-flip.done")) {
      return;
    }
    Services.prefs.setBoolPref("dom.ipc.plugins.flash.disable-protected-mode", true);
    Services.prefs.setBoolPref("browser.flash-protected-mode-flip.done", true);

    let win = this.getMostRecentBrowserWindow();
    if (!win) {
      return;
    }
    let productName = Services.strings
      .createBundle("chrome://branding/locale/brand.properties")
      .GetStringFromName("brandShortName");
    let message = win.gNavigatorBundle.
      getFormattedString("flashHang.message", [productName]);
    let buttons = [{
      label: win.gNavigatorBundle.getString("flashHang.helpButton.label"),
      accessKey: win.gNavigatorBundle.getString("flashHang.helpButton.accesskey"),
      callback: function() {
        win.openUILinkIn("https://support.mozilla.org/kb/flash-protected-mode-autodisabled", "tab");
      }
    }];
    let nb = win.document.getElementById("global-notificationbox");
    nb.appendNotification(message, "flash-hang", null,
                          nb.PRIORITY_INFO_MEDIUM, buttons);
  },

  _handleFlashHang: function() {
    ++this._flashHangCount;
    if (this._flashHangCount < 2) {
      return;
    }
    // protected mode only applies to win32
    if (Services.appinfo.XPCOMABI != "x86-msvc") {
      return;
    }

    if (Services.prefs.getBoolPref("dom.ipc.plugins.flash.disable-protected-mode")) {
      return;
    }
    if (!Services.prefs.getBoolPref("browser.flash-protected-mode-flip.enable")) {
      return;
    }
    if (Services.prefs.getBoolPref("browser.flash-protected-mode-flip.done")) {
      return;
    }
    Services.prefs.setBoolPref("dom.ipc.plugins.flash.disable-protected-mode", true);
    Services.prefs.setBoolPref("browser.flash-protected-mode-flip.done", true);

    let win = this.getMostRecentBrowserWindow();
    if (!win) {
      return;
    }
    let productName = gBrandBundle.GetStringFromName("brandShortName");
    let message = win.gNavigatorBundle.
      getFormattedString("flashHang.message", [productName]);
    let buttons = [{
      label: win.gNavigatorBundle.getString("flashHang.helpButton.label"),
      accessKey: win.gNavigatorBundle.getString("flashHang.helpButton.accesskey"),
      callback: function() {
        win.openUILinkIn("https://support.mozilla.org/kb/flash-protected-mode-autodisabled", "tab");
      }
    }];
    let nb = win.document.getElementById("global-notificationbox");
    nb.appendNotification(message, "flash-hang", null,
                          nb.PRIORITY_INFO_MEDIUM, buttons);
  },

  // for XPCOM
  classID:          Components.ID("{eab9012e-5f74-4cbc-b2b5-a590235513cc}"),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsISupportsWeakReference,
                                         Ci.nsIBrowserGlue]),

  // redefine the default factory for XPCOMUtils
  _xpcom_factory: BrowserGlueServiceFactory,
}

// ------------------------------------
// nsIAboutNewTabService implementation
//-------------------------------------

function AboutNewTabService()
{
  this._newTabURL = ABOUT_NEWTAB;
  this._overridden = false;
}

AboutNewTabService.prototype = {
  classID: Components.ID("{97eea4bb-db50-4ae0-9147-1e5ed55b4ed5}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutNewTabService]),

  get newTabURL() {

    if (!AppConstants.RELEASE_BUILD && Services.prefs.getBoolPref("browser.newtabpage.remote")) {
      return "about:remote-newtab";
    }

    return this._newTabURL;
  },

  set newTabURL(aNewTabURL) {
    if (aNewTabURL === ABOUT_NEWTAB) {
      this.resetNewTabURL();
      return;
    }
    this._newTabURL = aNewTabURL;
    this._overridden = true;
    Services.obs.notifyObservers(null, "newtab-url-changed", this._newTabURL);
  },

  get overridden() {
    return this._overridden;
  },

  resetNewTabURL: function() {
    this._newTabURL = ABOUT_NEWTAB;
    this._overridden = false;
    Services.obs.notifyObservers(null, "newtab-url-changed", this._newTabURL);
   }
};

function ContentPermissionPrompt() {}

ContentPermissionPrompt.prototype = {
  classID:          Components.ID("{d8903bf6-68d5-4e97-bcd1-e4d3012f721a}"),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIContentPermissionPrompt]),

  _getBrowserForRequest: function (aRequest) {
    var browser;
    try {
      // "element" is only defined in e10s mode, otherwise it throws.
      browser = aRequest.element;
    } catch (e) {}
    if (!browser) {
      var requestingWindow = aRequest.window.top;
      // find the requesting browser or iframe
      browser = requestingWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                                  .getInterface(Ci.nsIWebNavigation)
                                  .QueryInterface(Ci.nsIDocShell)
                                  .chromeEventHandler;
    }
    return browser;
  },

  /**
   * Show a permission prompt.
   *
   * @param aRequest               The permission request.
   * @param aMessage               The message to display on the prompt.
   * @param aPermission            The type of permission to prompt.
   * @param aActions               An array of actions of the form:
   *                               [main action, secondary actions, ...]
   *                               Actions are of the form { stringId, action, expireType, callback }
   *                               Permission is granted if action is null or ALLOW_ACTION.
   * @param aNotificationId        The id of the PopupNotification.
   * @param aAnchorId              The id for the PopupNotification anchor.
   * @param aOptions               Options for the PopupNotification
   */
  _showPrompt: function CPP_showPrompt(aRequest, aMessage, aPermission, aActions,
                                       aNotificationId, aAnchorId, aOptions) {
    var browser = this._getBrowserForRequest(aRequest);
    var chromeWin = browser.ownerDocument.defaultView;
    var requestPrincipal = aRequest.principal;

    // Transform the prompt actions into PopupNotification actions.
    var popupNotificationActions = [];
    for (var i = 0; i < aActions.length; i++) {
      let promptAction = aActions[i];

      // Don't offer action in PB mode if the action remembers permission for more than a session.
      if (PrivateBrowsingUtils.isWindowPrivate(chromeWin) &&
          promptAction.expireType != Ci.nsIPermissionManager.EXPIRE_SESSION &&
          promptAction.action) {
        continue;
      }

      var action = {
        label: gBrowserBundle.GetStringFromName(promptAction.stringId),
        accessKey: gBrowserBundle.GetStringFromName(promptAction.stringId + ".accesskey"),
        callback: function() {
          if (promptAction.callback) {
            promptAction.callback();
          }

          // Remember permissions.
          if (promptAction.action) {
            Services.perms.addFromPrincipal(requestPrincipal, aPermission,
                                            promptAction.action, promptAction.expireType);
          }

          // Grant permission if action is null or ALLOW_ACTION.
          if (!promptAction.action || promptAction.action == Ci.nsIPermissionManager.ALLOW_ACTION) {
            aRequest.allow();
          } else {
            aRequest.cancel();
          }
        },
      };

      popupNotificationActions.push(action);
    }

    var mainAction = popupNotificationActions.length ?
                       popupNotificationActions[0] : null;
    var secondaryActions = popupNotificationActions.splice(1);

    // Only allow exactly one permission request here.
    let types = aRequest.types.QueryInterface(Ci.nsIArray);
    if (types.length != 1) {
      aRequest.cancel();
      return;
    }

    if (!aOptions)
      aOptions = {};
    aOptions.displayOrigin = requestPrincipal.URI;

    return chromeWin.PopupNotifications.show(browser, aNotificationId, aMessage, aAnchorId,
                                             mainAction, secondaryActions, aOptions);
  },

  _promptGeo : function(aRequest) {
    var secHistogram = Services.telemetry.getHistogramById("SECURITY_UI");

    var message;

    // Share location action.
    var actions = [{
      stringId: "geolocation.shareLocation",
      action: null,
      expireType: null,
      callback: function() {
        secHistogram.add(Ci.nsISecurityUITelemetry.WARNING_GEOLOCATION_REQUEST_SHARE_LOCATION);
      },
    }];

    let options = {
      learnMoreURL: Services.urlFormatter.formatURLPref("browser.geolocation.warning.infoURL"),
    };

    if (aRequest.principal.URI.schemeIs("file")) {
      message = gBrowserBundle.GetStringFromName("geolocation.shareWithFile2");
    } else {
      message = gBrowserBundle.GetStringFromName("geolocation.shareWithSite2");
      // Always share location action.
      actions.push({
        stringId: "geolocation.alwaysShareLocation",
        action: Ci.nsIPermissionManager.ALLOW_ACTION,
        expireType: null,
        callback: function() {
          secHistogram.add(Ci.nsISecurityUITelemetry.WARNING_GEOLOCATION_REQUEST_ALWAYS_SHARE);
        },
      });

      // Never share location action.
      actions.push({
        stringId: "geolocation.neverShareLocation",
        action: Ci.nsIPermissionManager.DENY_ACTION,
        expireType: null,
        callback: function() {
          secHistogram.add(Ci.nsISecurityUITelemetry.WARNING_GEOLOCATION_REQUEST_NEVER_SHARE);
        },
      });
    }

    secHistogram.add(Ci.nsISecurityUITelemetry.WARNING_GEOLOCATION_REQUEST);

    this._showPrompt(aRequest, message, "geo", actions, "geolocation",
                     "geo-notification-icon", options);
  },

  _promptWebNotifications : function(aRequest) {
    var message = gBrowserBundle.GetStringFromName("webNotifications.receiveFromSite");

    var actions;

    var browser = this._getBrowserForRequest(aRequest);
    // Only show "allow for session" in PB mode, we don't
    // support "allow for session" in non-PB mode.
    if (PrivateBrowsingUtils.isBrowserPrivate(browser)) {
      actions = [
        {
          stringId: "webNotifications.receiveForSession",
          action: Ci.nsIPermissionManager.ALLOW_ACTION,
          expireType: Ci.nsIPermissionManager.EXPIRE_SESSION,
          callback: function() {},
        }
      ];
    } else {
      actions = [
        {
          stringId: "webNotifications.alwaysReceive",
          action: Ci.nsIPermissionManager.ALLOW_ACTION,
          expireType: null,
          callback: function() {},
        },
        {
          stringId: "webNotifications.neverShow",
          action: Ci.nsIPermissionManager.DENY_ACTION,
          expireType: null,
          callback: function() {},
        },
      ];
    }

    var options = {
      learnMoreURL: Services.urlFormatter.formatURLPref("browser.push.warning.infoURL"),
    };

    this._showPrompt(aRequest, message, "desktop-notification", actions,
                     "web-notifications",
                     "web-notifications-notification-icon", options);
  },

  _promptPointerLock: function CPP_promtPointerLock(aRequest, autoAllow) {
    let message = gBrowserBundle.GetStringFromName(autoAllow ?
                                  "pointerLock.autoLock.title3" : "pointerLock.title3");

    // If this is an autoAllow info prompt, offer no actions.
    // _showPrompt() will allow the request when it's dismissed.
    let actions = [];
    if (!autoAllow) {
      actions = [
        {
          stringId: "pointerLock.allow2",
          action: null,
          expireType: null,
          callback: function() {},
        },
        {
          stringId: "pointerLock.alwaysAllow",
          action: Ci.nsIPermissionManager.ALLOW_ACTION,
          expireType: null,
          callback: function() {},
        },
        {
          stringId: "pointerLock.neverAllow",
          action: Ci.nsIPermissionManager.DENY_ACTION,
          expireType: null,
          callback: function() {},
        },
      ];
    }

    function onFullScreen() {
      notification.remove();
    }

    let options = {};
    options.removeOnDismissal = autoAllow;
    options.eventCallback = type => {
      if (type == "removed") {
        notification.browser.removeEventListener("mozfullscreenchange", onFullScreen, true);
        if (autoAllow) {
          aRequest.allow();
        }
      }
    }

    let notification =
      this._showPrompt(aRequest, message, "pointerLock", actions, "pointerLock",
                       "pointerLock-notification-icon", options);

    // pointerLock is automatically allowed in fullscreen mode (and revoked
    // upon exit), so if the page enters fullscreen mode after requesting
    // pointerLock (but before the user has granted permission), we should
    // remove the now-impotent notification.
    notification.browser.addEventListener("mozfullscreenchange", onFullScreen, true);
  },

  prompt: function CPP_prompt(request) {
    // Only allow exactly one permission request here.
    let types = request.types.QueryInterface(Ci.nsIArray);
    if (types.length != 1) {
      request.cancel();
      return;
    }
    let perm = types.queryElementAt(0, Ci.nsIContentPermissionType);

    const kFeatureKeys = { "geolocation" : "geo",
                           "desktop-notification" : "desktop-notification",
                           "pointerLock" : "pointerLock",
                         };

    // Make sure that we support the request.
    if (!(perm.type in kFeatureKeys)) {
      return;
    }

    var requestingPrincipal = request.principal;
    var requestingURI = requestingPrincipal.URI;

    // Ignore requests from non-nsIStandardURLs
    if (!(requestingURI instanceof Ci.nsIStandardURL))
      return;

    var autoAllow = false;
    var permissionKey = kFeatureKeys[perm.type];
    var result = Services.perms.testExactPermissionFromPrincipal(requestingPrincipal, permissionKey);

    if (result == Ci.nsIPermissionManager.DENY_ACTION) {
      request.cancel();
      return;
    }

    if (result == Ci.nsIPermissionManager.ALLOW_ACTION) {
      autoAllow = true;
      // For pointerLock, we still want to show a warning prompt.
      if (perm.type != "pointerLock") {
        request.allow();
        return;
      }
    }

    // Show the prompt.
    switch (perm.type) {
    case "geolocation":
      this._promptGeo(request);
      break;
    case "desktop-notification":
      this._promptWebNotifications(request);
      break;
    case "pointerLock":
      this._promptPointerLock(request, autoAllow);
      break;
    }
  },

};

var DefaultBrowserCheck = {
  get OPTIONPOPUP() { return "defaultBrowserNotificationPopup" },

  closePrompt: function(aNode) {
    if (this._notification) {
      this._notification.close();
    }
  },

  setAsDefault: function() {
    let claimAllTypes = true;
#ifdef XP_WIN
    try {
      // In Windows 8, the UI for selecting default protocol is much
      // nicer than the UI for setting file type associations. So we
      // only show the protocol association screen on Windows 8.
      // Windows 8 is version 6.2.
      let version = Services.sysinfo.getProperty("version");
      claimAllTypes = (parseFloat(version) < 6.2);
    } catch (ex) { }
#endif
    try {
      ShellService.setDefaultBrowser(claimAllTypes, false);
    } catch (ex) {
      Cu.reportError(ex);
    }
  },

  _createPopup: function(win, notNowStrings, neverStrings) {
    let doc = win.document;
    let popup = doc.createElement("menupopup");
    popup.id = this.OPTIONPOPUP;

    let notNowItem = doc.createElement("menuitem");
    notNowItem.id = "defaultBrowserNotNow";
    notNowItem.setAttribute("label", notNowStrings.label);
    notNowItem.setAttribute("accesskey", notNowStrings.accesskey);
    popup.appendChild(notNowItem);

    let neverItem = doc.createElement("menuitem");
    neverItem.id = "defaultBrowserNever";
    neverItem.setAttribute("label", neverStrings.label);
    neverItem.setAttribute("accesskey", neverStrings.accesskey);
    popup.appendChild(neverItem);

    popup.addEventListener("command", this);

    let popupset = doc.getElementById("mainPopupSet");
    popupset.appendChild(popup);
  },

  handleEvent: function(event) {
    if (event.type == "command") {
      if (event.target.id == "defaultBrowserNever") {
        ShellService.shouldCheckDefaultBrowser = false;
      }
      this.closePrompt();
    }
  },

  prompt: function(win) {
    let useNotificationBar = Services.prefs.getBoolPref("browser.defaultbrowser.notificationbar");

    let brandBundle = win.document.getElementById("bundle_brand");
    let brandShortName = brandBundle.getString("brandShortName");

    let shellBundle = win.document.getElementById("bundle_shell");
    let buttonPrefix = "setDefaultBrowser" + (useNotificationBar ? "" : "Alert");
    let yesButton = shellBundle.getFormattedString(buttonPrefix + "Confirm.label",
                                                   [brandShortName]);
    let notNowButton = shellBundle.getString(buttonPrefix + "NotNow.label");

    if (useNotificationBar) {
      let promptMessage = shellBundle.getFormattedString("setDefaultBrowserMessage2",
                                                         [brandShortName]);
      let optionsMessage = shellBundle.getString("setDefaultBrowserOptions.label");
      let optionsKey = shellBundle.getString("setDefaultBrowserOptions.accesskey");

      let neverLabel = shellBundle.getString("setDefaultBrowserNever.label");
      let neverKey = shellBundle.getString("setDefaultBrowserNever.accesskey");

      let yesButtonKey = shellBundle.getString("setDefaultBrowserConfirm.accesskey");
      let notNowButtonKey = shellBundle.getString("setDefaultBrowserNotNow.accesskey");

      let notificationBox = win.document.getElementById("high-priority-global-notificationbox");

      this._createPopup(win, {
        label: notNowButton,
        accesskey: notNowButtonKey
      }, {
        label: neverLabel,
        accesskey: neverKey
      });

      let buttons = [
        {
          label: yesButton,
          accessKey: yesButtonKey,
          callback: () => {
            this.setAsDefault();
            this.closePrompt();
          }
        },
        {
          label: optionsMessage,
          accessKey: optionsKey,
          popup: this.OPTIONPOPUP
        }
      ];

      let iconPixels = win.devicePixelRatio > 1 ? "32" : "16";
      let iconURL = "chrome://branding/content/icon" + iconPixels + ".png";
      const priority = notificationBox.PRIORITY_WARNING_HIGH;
      let callback = this._onNotificationEvent.bind(this);
      this._notification = notificationBox.appendNotification(promptMessage, "default-browser",
                                                              iconURL, priority, buttons,
                                                              callback);
    } else {
      // Modal prompt
      let promptTitle = shellBundle.getString("setDefaultBrowserTitle");
      let promptMessage = shellBundle.getFormattedString("setDefaultBrowserMessage",
                                                         [brandShortName]);
      let askLabel = shellBundle.getFormattedString("setDefaultBrowserDontAsk",
                                                    [brandShortName]);

      let ps = Services.prompt;
      let shouldAsk = { value: true };
      let buttonFlags = (ps.BUTTON_TITLE_IS_STRING * ps.BUTTON_POS_0) +
                        (ps.BUTTON_TITLE_IS_STRING * ps.BUTTON_POS_1) +
                        ps.BUTTON_POS_0_DEFAULT;
      let rv = ps.confirmEx(win, promptTitle, promptMessage, buttonFlags,
                            yesButton, notNowButton, null, askLabel, shouldAsk);
      if (rv == 0) {
        this.setAsDefault();
      } else if (!shouldAsk.value) {
        ShellService.shouldCheckDefaultBrowser = false;
      }
    }
  },

  _onNotificationEvent: function(eventType) {
    if (eventType == "removed") {
      let doc = this._notification.ownerDocument;
      let popup = doc.getElementById(this.OPTIONPOPUP);
      popup.removeEventListener("command", this);
      popup.remove();
      delete this._notification;
    }
  },
};

#ifdef E10S_TESTING_ONLY
var E10SUINotification = {
  // Increase this number each time we want to roll out an
  // e10s testing period to Nightly users.
  CURRENT_NOTICE_COUNT: 0,
  CURRENT_NOTICE_COUNT: 1,
  CURRENT_PROMPT_PREF: "browser.displayedE10SPrompt.1",
  PREVIOUS_PROMPT_PREF: "browser.displayedE10SPrompt",

  checkStatus: function() {
    let skipE10sChecks = false;
    try {
      let updateChannel = UpdateUtils.UpdateChannel;
      let channelAuthorized = updateChannel == "nightly" || updateChannel == "aurora";

      skipE10sChecks = !channelAuthorized ||
                       Services.prefs.getBoolPref("browser.tabs.remote.disabled-for-a11y");
    } catch(e) {}

    if (skipE10sChecks) {
      return;
    }

    if (Services.appinfo.browserTabsRemoteAutostart) {
      let notice = 0;
      try {
        notice = Services.prefs.getIntPref("browser.displayedE10SNotice");
      } catch(e) {}
      let activationNoticeShown = notice >= this.CURRENT_NOTICE_COUNT;

      if (!activationNoticeShown) {
        this._showE10sActivatedNotice();
      }

      // e10s doesn't work with accessibility, so we prompt to disable
      // e10s if a11y is enabled, now or in the future.
      Services.obs.addObserver(this, "a11y-init-or-shutdown", true);
      if (Services.appinfo.accessibilityEnabled) {
        this._showE10sAccessibilityWarning();
      }
    } else {
      let e10sPromptShownCount = 0;
      try {
        e10sPromptShownCount = Services.prefs.getIntPref(this.CURRENT_PROMPT_PREF);
      } catch(e) {}

      let isHardwareAccelerated = true;
      try {
        let win = RecentWindow.getMostRecentBrowserWindow();
        let winutils = win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
        isHardwareAccelerated = winutils.layerManagerType != "Basic";
      } catch (e) {}

      if (!Services.appinfo.inSafeMode &&
          !Services.appinfo.accessibilityEnabled &&
          isHardwareAccelerated &&
          e10sPromptShownCount < 5) {
        Services.tm.mainThread.dispatch(() => {
          try {
            this._showE10SPrompt();
            Services.prefs.setIntPref(this.CURRENT_PROMPT_PREF, e10sPromptShownCount + 1);
            Services.prefs.clearUserPref(this.PREVIOUS_PROMPT_PREF);
          } catch (ex) {
            Cu.reportError("Failed to show e10s prompt: " + ex);
          }
        }, Ci.nsIThread.DISPATCH_NORMAL);
      }
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

  observe: function(subject, topic, data) {
    if (topic == "a11y-init-or-shutdown"
        && data == "1" &&
        Services.appinfo.accessibilityIsBlacklistedForE10S) {
      this._showE10sAccessibilityWarning();
    }
  },

  _showE10sActivatedNotice: function() {
    let win = RecentWindow.getMostRecentBrowserWindow();
    if (!win)
      return;

    Services.prefs.setIntPref("browser.displayedE10SNotice", this.CURRENT_NOTICE_COUNT);

    let nb = win.document.getElementById("high-priority-global-notificationbox");
    let message = win.gNavigatorBundle.getFormattedString(
                    "e10s.postActivationInfobar.message",
                    [gBrandBundle.GetStringFromName("brandShortName")]
                  );
    let buttons = [
      {
        label: win.gNavigatorBundle.getString("e10s.postActivationInfobar.learnMore.label"),
        accessKey: win.gNavigatorBundle.getString("e10s.postActivationInfobar.learnMore.accesskey"),
        callback: function () {
          win.openUILinkIn("https://wiki.mozilla.org/Electrolysis", "tab");
        }
      }
    ];
    nb.appendNotification(message, "e10s-activated-noticed",
                          null, nb.PRIORITY_WARNING_MEDIUM, buttons);

  },

  _showE10SPrompt: function BG__showE10SPrompt() {
    let win = RecentWindow.getMostRecentBrowserWindow();
    if (!win)
      return;

    let browser = win.gBrowser.selectedBrowser;

    let promptMessage = win.gNavigatorBundle.getFormattedString(
                          "e10s.offerPopup.mainMessage",
                          [gBrandBundle.GetStringFromName("brandShortName")]
                        );
    let mainAction = {
      label: win.gNavigatorBundle.getString("e10s.offerPopup.enableAndRestart.label"),
      accessKey: win.gNavigatorBundle.getString("e10s.offerPopup.enableAndRestart.accesskey"),
      callback: function () {
        Services.prefs.setBoolPref("browser.tabs.remote.autostart", true);
        Services.prefs.setBoolPref("browser.enabledE10SFromPrompt", true);
        // Restart the app
        let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
        Services.obs.notifyObservers(cancelQuit, "quit-application-requested", "restart");
        if (cancelQuit.data)
          return; // somebody canceled our quit request
        Services.startup.quit(Services.startup.eAttemptQuit | Services.startup.eRestart);
      }
    };
    let secondaryActions = [
      {
        label: win.gNavigatorBundle.getString("e10s.offerPopup.noThanks.label"),
        accessKey: win.gNavigatorBundle.getString("e10s.offerPopup.noThanks.accesskey"),
        callback: function () {
          Services.prefs.setIntPref(E10SUINotification.CURRENT_PROMPT_PREF, 5);
        }
      }
    ];
    let options = {
      popupIconURL: "chrome://browser/skin/e10s-64@2x.png",
      learnMoreURL: "https://wiki.mozilla.org/Electrolysis",
      persistWhileVisible: true
    };

    win.PopupNotifications.show(browser, "enable-e10s", promptMessage, null, mainAction, secondaryActions, options);

    let highlights = [
      win.gNavigatorBundle.getString("e10s.offerPopup.highlight1"),
      win.gNavigatorBundle.getString("e10s.offerPopup.highlight2")
    ];
  },

  _warnedAboutAccessibility: false,

  _showE10sAccessibilityWarning: function() {
    try {
      if (!Services.prefs.getBoolPref("browser.tabs.remote.disabled-for-a11y")) {
        // Only return if the pref exists and was set to false, but not
        // if the pref didn't exist (which will throw).
        return;
      }
    } catch (e) { }

    Services.prefs.setBoolPref("browser.tabs.remote.disabled-for-a11y", true);

    if (this._warnedAboutAccessibility) {
      return;
    }
    this._warnedAboutAccessibility = true;

    let win = RecentWindow.getMostRecentBrowserWindow();
    if (!win) {
      // Just restart immediately.
      Services.startup.quit(Services.startup.eAttemptQuit | Services.startup.eRestart);
      return;
    }

    let browser = win.gBrowser.selectedBrowser;

    let promptMessage = win.gNavigatorBundle.getFormattedString(
                          "e10s.accessibilityNotice.mainMessage",
                          [gBrandBundle.GetStringFromName("brandShortName")]
                        );
    let mainAction = {
      label: win.gNavigatorBundle.getString("e10s.accessibilityNotice.disableAndRestart.label"),
      accessKey: win.gNavigatorBundle.getString("e10s.accessibilityNotice.disableAndRestart.accesskey"),
      callback: function () {
        // Restart the app
        let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
        Services.obs.notifyObservers(cancelQuit, "quit-application-requested", "restart");
        if (cancelQuit.data)
          return; // somebody canceled our quit request
        Services.startup.quit(Services.startup.eAttemptQuit | Services.startup.eRestart);
      }
    };
    let secondaryActions = [
      {
        label: win.gNavigatorBundle.getString("e10s.accessibilityNotice.dontDisable.label"),
        accessKey: win.gNavigatorBundle.getString("e10s.accessibilityNotice.dontDisable.accesskey"),
        callback: function () {
          Services.prefs.setBoolPref("browser.tabs.remote.disabled-for-a11y", false);
        }
      }
    ];
    let options = {
      popupIconURL: "chrome://browser/skin/e10s-64@2x.png",
      learnMoreURL: "https://wiki.mozilla.org/Electrolysis",
      persistWhileVisible: true
    };

    win.PopupNotifications.show(browser, "a11y_enabled_with_e10s", promptMessage, null, mainAction, secondaryActions, options);
  },
};
#endif

var components = [BrowserGlue, ContentPermissionPrompt, AboutNewTabService];
this.NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
