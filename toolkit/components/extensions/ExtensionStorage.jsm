/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["ExtensionStorage"];

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://gre/modules/AsyncShutdown.jsm");

/* globals OS ExtensionStorage */

var Path = OS.Path;
var profileDir = OS.Constants.Path.profileDir;

this.ExtensionStorage = {
  cache: new Map(),
  listeners: new Map(),

  extensionDir: Path.join(profileDir, "browser-extension-data"),

  getExtensionDir(extensionId) {
    return Path.join(this.extensionDir, extensionId);
  },

  getStorageFile(extensionId) {
    return Path.join(this.extensionDir, extensionId, "storage.js");
  },

  read(extensionId) {
    if (this.cache.has(extensionId)) {
      return this.cache.get(extensionId);
    }

    let path = this.getStorageFile(extensionId);
    let decoder = new TextDecoder();
    let promise = OS.File.read(path);
    promise = promise.then(array => {
      return JSON.parse(decoder.decode(array));
    }).catch(() => {
      Cu.reportError("Unable to parse JSON data for extension storage.");
      return {};
    });
    this.cache.set(extensionId, promise);
    return promise;
  },

  write(extensionId) {
    let promise = this.read(extensionId).then(extData => {
      let encoder = new TextEncoder();
      let array = encoder.encode(JSON.stringify(extData));
      let path = this.getStorageFile(extensionId);
      OS.File.makeDir(this.getExtensionDir(extensionId), {ignoreExisting: true, from: profileDir});
      let promise = OS.File.writeAtomic(path, array);
      return promise;
    }).catch(() => {
      // Make sure this promise is never rejected.
      Cu.reportError("Unable to write JSON data for extension storage.");
    });

    AsyncShutdown.profileBeforeChange.addBlocker(
      "ExtensionStorage: Finish writing extension data",
      promise);

    return promise.then(() => {
      AsyncShutdown.profileBeforeChange.removeBlocker(promise);
    });
  },

  set(extensionId, items) {
    return this.read(extensionId).then(extData => {
      let changes = {};
      for (let prop in items) {
        changes[prop] = {oldValue: extData[prop], newValue: items[prop]};
        extData[prop] = items[prop];
      }

      let listeners = this.listeners.get(extensionId);
      if (listeners) {
        for (let listener of listeners) {
          listener(changes);
        }
      }

      return this.write(extensionId);
    });
  },

  remove(extensionId, items) {
    return this.read(extensionId).then(extData => {
      let changes = {};
      if (Array.isArray(items)) {
        for (let prop of items) {
          changes[prop] = {oldValue: extData[prop]};
          delete extData[prop];
        }
      } else {
        let prop = items;
        changes[prop] = {oldValue: extData[prop]};
        delete extData[prop];
      }

      let listeners = this.listeners.get(extensionId);
      if (listeners) {
        for (let listener of listeners) {
          listener(changes);
        }
      }

      return this.write(extensionId);
    });
  },

  get(extensionId, keys) {
    return this.read(extensionId).then(extData => {
      let result = {};
      if (keys === null) {
        Object.assign(result, extData);
      } else if (typeof(keys) == "object" && !Array.isArray(keys)) {
        for (let prop in keys) {
          if (prop in extData) {
            result[prop] = extData[prop];
          } else {
            result[prop] = keys[prop];
          }
        }
      } else if (typeof(keys) == "string") {
        let prop = keys;
        if (prop in extData) {
          result[prop] = extData[prop];
        }
      } else {
        for (let prop of keys) {
          if (prop in extData) {
            result[prop] = extData[prop];
          }
        }
      }

      return result;
    });
  },

  addOnChangedListener(extensionId, listener) {
    let listeners = this.listeners.get(extensionId) || new Set();
    listeners.add(listener);
    this.listeners.set(extensionId, listeners);
  },

  removeOnChangedListener(extensionId, listener) {
    let listeners = this.listeners.get(extensionId);
    listeners.delete(listener);
  },

  init() {
    Services.obs.addObserver(this, "extension-invalidate-storage-cache", false);
    Services.obs.addObserver(this, "xpcom-shutdown", false);
  },

  observe(subject, topic, data) {
    if (topic == "xpcom-shutdown") {
      Services.obs.removeObserver(this, "extension-invalidate-storage-cache");
      Services.obs.removeObserver(this, "xpcom-shutdown");
    } else if (topic == "extension-invalidate-storage-cache") {
      this.cache.clear();
    }
  },
};

ExtensionStorage.init();
