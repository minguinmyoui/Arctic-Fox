/**
 * Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

const { 'classes': Cc, 'interfaces': Ci, 'utils': Cu } = Components;

if (!("self" in this)) {
  this.self = this;
}

const DOMException = Ci.nsIDOMDOMException;

var bufferCache = [];

function is(a, b, msg) {
  do_check_eq(a, b, Components.stack.caller);
}

function ok(cond, msg) {
  do_check_true(!!cond, Components.stack.caller); 
}

function isnot(a, b, msg) {
  do_check_neq(a, b, Components.stack.caller); 
}

function executeSoon(fun) {
  do_execute_soon(fun);
}

function todo(condition, name, diag) {
  todo_check_true(condition, Components.stack.caller);
}

function info(name, message) {
  do_print(name);
}

function run_test() {
  runTest();
};

if (!this.runTest) {
  this.runTest = function()
  {
    if (SpecialPowers.isMainProcess()) {
      // XPCShell does not get a profile by default.
      do_get_profile();

      enableTesting();
      enableExperimental();
    }

    Cu.importGlobalProperties(["indexedDB", "Blob", "File", "FileReader"]);

    do_test_pending();
    testGenerator.next();
  }
}

function finishTest()
{
  if (SpecialPowers.isMainProcess()) {
    resetExperimental();
    resetTesting();

    SpecialPowers.notifyObserversInParentProcess(null, "disk-space-watcher",
                                                 "free");
  }

  do_execute_soon(function(){
    testGenerator.close();
    do_test_finished();
  })
}

function grabEventAndContinueHandler(event)
{
  testGenerator.send(event);
}

function continueToNextStep()
{
  do_execute_soon(function() {
    testGenerator.next();
  });
}

function errorHandler(event)
{
  try {
    dump("indexedDB error: " + event.target.error.name);
  } catch(e) {
    dump("indexedDB error: " + e);
  }
  do_check_true(false);
  finishTest();
}

function unexpectedSuccessHandler()
{
  do_check_true(false);
  finishTest();
}

function expectedErrorHandler(name)
{
  return function(event) {
    do_check_eq(event.type, "error");
    do_check_eq(event.target.error.name, name);
    event.preventDefault();
    grabEventAndContinueHandler(event);
  };
}

function ExpectError(name)
{
  this._name = name;
}
ExpectError.prototype = {
  handleEvent: function(event)
  {
    do_check_eq(event.type, "error");
    do_check_eq(this._name, event.target.error.name);
    event.preventDefault();
    grabEventAndContinueHandler(event);
  }
};

function continueToNextStepSync()
{
  testGenerator.next();
}

function compareKeys(k1, k2) {
  let t = typeof k1;
  if (t != typeof k2)
    return false;

  if (t !== "object")
    return k1 === k2;

  if (k1 instanceof Date) {
    return (k2 instanceof Date) &&
      k1.getTime() === k2.getTime();
  }

  if (k1 instanceof Array) {
    if (!(k2 instanceof Array) ||
        k1.length != k2.length)
      return false;
    
    for (let i = 0; i < k1.length; ++i) {
      if (!compareKeys(k1[i], k2[i]))
        return false;
    }
    
    return true;
  }

  return false;
}

function addPermission(permission, url)
{
  throw "addPermission";
}

function removePermission(permission, url)
{
  throw "removePermission";
}

function allowIndexedDB(url)
{
  throw "allowIndexedDB";
}

function disallowIndexedDB(url)
{
  throw "disallowIndexedDB";
}

function enableExperimental()
{
  SpecialPowers.setBoolPref("dom.indexedDB.experimental", true);
}

function resetExperimental()
{
  SpecialPowers.clearUserPref("dom.indexedDB.experimental");
}

function enableTesting()
{
  SpecialPowers.setBoolPref("dom.indexedDB.testing", true);
}

function resetTesting()
{
  SpecialPowers.clearUserPref("dom.indexedDB.testing");
}

function gc()
{
  Cu.forceGC();
  Cu.forceCC();
}

function scheduleGC()
{
  SpecialPowers.exactGC(null, continueToNextStep);
}

function setTimeout(fun, timeout) {
  let timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  var event = {
    notify: function (timer) {
      fun();
    }
  };
  timer.initWithCallback(event, timeout,
                         Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  return timer;
}

function resetOrClearAllDatabases(callback, clear) {
  if (!SpecialPowers.isMainProcess()) {
    throw new Error("clearAllDatabases not implemented for child processes!");
  }

  let quotaManagerService = Cc["@mozilla.org/dom/quota-manager-service;1"]
                              .getService(Ci.nsIQuotaManagerService);

  const quotaPref = "dom.quotaManager.testing";

  let oldPrefValue;
  if (SpecialPowers._getPrefs().prefHasUserValue(quotaPref)) {
    oldPrefValue = SpecialPowers.getBoolPref(quotaPref);
  }

  SpecialPowers.setBoolPref(quotaPref, true);

  let request;

  try {
    if (clear) {
      request = quotaManagerService.clear();
    } else {
      request = quotaManagerService.reset();
    }
  } catch(e) {
    if (oldPrefValue !== undefined) {
      SpecialPowers.setBoolPref(quotaPref, oldPrefValue);
    } else {
      SpecialPowers.clearUserPref(quotaPref);
    }
    throw e;
  }

  request.callback = callback;
}

function resetAllDatabases(callback) {
  resetOrClearAllDatabases(callback, false);
}

function clearAllDatabases(callback) {
  resetOrClearAllDatabases(callback, true);
}

function installPackagedProfile(packageName)
{
  let directoryService = Cc["@mozilla.org/file/directory_service;1"]
                         .getService(Ci.nsIProperties);

  let profileDir = directoryService.get("ProfD", Ci.nsIFile);

  let currentDir = directoryService.get("CurWorkD", Ci.nsIFile);

  let packageFile = currentDir.clone();
  packageFile.append(packageName + ".zip");

  let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"]
                  .createInstance(Ci.nsIZipReader);
  zipReader.open(packageFile);

  let entryNames = [];
  let entries = zipReader.findEntries(null);
  while (entries.hasMore()) {
    let entry = entries.getNext();
    if (entry != "create_db.html") {
      entryNames.push(entry);
    }
  }
  entryNames.sort();

  for (let entryName of entryNames) {
    let zipentry = zipReader.getEntry(entryName);

    let file = profileDir.clone();
    let split = entryName.split("/");
    for(let i = 0; i < split.length; i++) {
      file.append(split[i]);
    }

    if (zipentry.isDirectory) {
      file.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt("0755", 8));
    } else {
      let istream = zipReader.getInputStream(entryName);

      var ostream = Cc["@mozilla.org/network/file-output-stream;1"]
                    .createInstance(Ci.nsIFileOutputStream);
      ostream.init(file, -1, parseInt("0644", 8), 0);

      let bostream = Cc['@mozilla.org/network/buffered-output-stream;1']
                     .createInstance(Ci.nsIBufferedOutputStream);
      bostream.init(ostream, 32768);

      bostream.writeFrom(istream, istream.available());

      istream.close();
      bostream.close();
    }
  }

  zipReader.close();
}

function getBlob(str)
{
  return new Blob([str], {type: "type/text"});
}

function getFile(name, type, str)
{
  return new File([str], name, {type: type});
}

function compareBuffers(buffer1, buffer2)
{
  if (buffer1.byteLength != buffer2.byteLength) {
    return false;
  }
  let view1 = new Uint8Array(buffer1);
  let view2 = new Uint8Array(buffer2);
  for (let i = 0; i < buffer1.byteLength; i++) {
    if (view1[i] != view2[i]) {
      return false;
    }
  }
  return true;
}

function verifyBuffers(buffer1, buffer2)
{
  ok(compareBuffers(buffer1, buffer2), "Correct blob data");
}

function verifyBlob(blob1, blob2)
{
  is(blob1 instanceof Components.interfaces.nsIDOMBlob, true,
     "Instance of nsIDOMBlob");
  is(blob1 instanceof File, blob2 instanceof File,
     "Instance of DOM File");
  is(blob1.size, blob2.size, "Correct size");
  is(blob1.type, blob2.type, "Correct type");
  if (blob2 instanceof File) {
    is(blob1.name, blob2.name, "Correct name");
  }

  let buffer1;
  let buffer2;

  for (let i = 0; i < bufferCache.length; i++) {
    if (bufferCache[i].blob == blob2) {
      buffer2 = bufferCache[i].buffer;
      break;
    }
  }

  if (!buffer2) {
    let reader = new FileReader();
    reader.readAsArrayBuffer(blob2);
    reader.onload = function(event) {
      buffer2 = event.target.result;
      bufferCache.push({ blob: blob2, buffer: buffer2 });
      if (buffer1) {
        verifyBuffers(buffer1, buffer2);
        testGenerator.next();
      }
    }
  }

  let reader = new FileReader();
  reader.readAsArrayBuffer(blob1);
  reader.onload = function(event) {
    buffer1 = event.target.result;
    if (buffer2) {
      verifyBuffers(buffer1, buffer2);
      testGenerator.next();
    }
  }
}

function verifyMutableFile(mutableFile1, file2)
{
  is(mutableFile1 instanceof IDBMutableFile, true,
     "Instance of IDBMutableFile");
  is(mutableFile1.name, file2.name, "Correct name");
  is(mutableFile1.type, file2.type, "Correct type");
  executeSoon(function() {
    testGenerator.next();
  });
}

var SpecialPowers = {
  isMainProcess: function() {
    return Components.classes["@mozilla.org/xre/app-info;1"]
                     .getService(Components.interfaces.nsIXULRuntime)
                     .processType == Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT;
  },
  notifyObservers: function(subject, topic, data) {
    var obsvc = Cc['@mozilla.org/observer-service;1']
                   .getService(Ci.nsIObserverService);
    obsvc.notifyObservers(subject, topic, data);
  },
  notifyObserversInParentProcess: function(subject, topic, data) {
    if (subject) {
      throw new Error("Can't send subject to another process!");
    }
    return this.notifyObservers(subject, topic, data);
  },
  getBoolPref: function(prefName) {
    return this._getPrefs().getBoolPref(prefName);
  },
  setBoolPref: function(prefName, value) {
    this._getPrefs().setBoolPref(prefName, value);
  },
  setIntPref: function(prefName, value) {
    this._getPrefs().setIntPref(prefName, value);
  },
  clearUserPref: function(prefName) {
    this._getPrefs().clearUserPref(prefName);
  },
  // Copied (and slightly adjusted) from specialpowersAPI.js
  exactGC: function(win, callback) {
    let count = 0;

    function doPreciseGCandCC() {
      function scheduledGCCallback() {
        Components.utils.forceCC();

        if (++count < 2) {
          doPreciseGCandCC();
        } else {
          callback();
        }
      }

      Components.utils.schedulePreciseGC(scheduledGCCallback);
    }

    doPreciseGCandCC();
  },

  _getPrefs: function() {
    var prefService =
      Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
    return prefService.getBranch(null);
  },

  get Cc() {
    return Cc;
  },

  get Ci() {
    return Ci;
  },

  get Cu() {
    return Cu;
  },

  createDOMFile: function(file, options) {
    return new File(file, options);
  },
};
