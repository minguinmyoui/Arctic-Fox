/* -*- Mode: indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set sts=2 sw=2 et tw=80: */
"use strict";

// Test that various combinations of icon details specs, for both paths
// and ImageData objects, result in the correct image being displayed in
// all display resolutions.
add_task(function* testDetailsObjects() {
  function background() {
    function getImageData(color) {
      let canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      let canvasContext = canvas.getContext("2d");

      canvasContext.clearRect(0, 0, canvas.width, canvas.height);
      canvasContext.fillStyle = color;
      canvasContext.fillRect(0, 0, 1, 1);

      return {
        url: canvas.toDataURL("image/png"),
        imageData: canvasContext.getImageData(0, 0, canvas.width, canvas.height),
      };
    }

    let imageData = {
      red: getImageData("red"),
      green: getImageData("green"),
    };

    /* eslint-disable comma-dangle, indent */
    let iconDetails = [
      // Only paths.
      { details: { "path": "a.png" },
        resolutions: {
          "1": browser.runtime.getURL("data/a.png"),
          "2": browser.runtime.getURL("data/a.png"), } },
      { details: { "path": "/a.png" },
        resolutions: {
          "1": browser.runtime.getURL("a.png"),
          "2": browser.runtime.getURL("a.png"), } },
      { details: { "path": { "19": "a.png" } },
        resolutions: {
          "1": browser.runtime.getURL("data/a.png"),
          "2": browser.runtime.getURL("data/a.png"), } },
      { details: { "path": { "38": "a.png" } },
        resolutions: {
          "1": browser.runtime.getURL("data/a.png"),
          "2": browser.runtime.getURL("data/a.png"), } },
      { details: { "path": { "19": "a.png", "38": "a-x2.png" } },
        resolutions: {
          "1": browser.runtime.getURL("data/a.png"),
          "2": browser.runtime.getURL("data/a-x2.png"), } },

      // Only ImageData objects.
      { details: { "imageData": imageData.red.imageData },
        resolutions: {
          "1": imageData.red.url,
          "2": imageData.red.url, } },
      { details: { "imageData": { "19": imageData.red.imageData } },
        resolutions: {
          "1": imageData.red.url,
          "2": imageData.red.url, } },
      { details: { "imageData": { "38": imageData.red.imageData } },
        resolutions: {
          "1": imageData.red.url,
          "2": imageData.red.url, } },
      { details: { "imageData": {
          "19": imageData.red.imageData,
          "38": imageData.green.imageData } },
        resolutions: {
          "1": imageData.red.url,
          "2": imageData.green.url, } },

      // Mixed path and imageData objects.
      //
      // The behavior is currently undefined if both |path| and
      // |imageData| specify icons of the same size.
      { details: {
          "path": { "19": "a.png" },
          "imageData": { "38": imageData.red.imageData } },
        resolutions: {
          "1": browser.runtime.getURL("data/a.png"),
          "2": imageData.red.url, } },
      { details: {
          "path": { "38": "a.png" },
          "imageData": { "19": imageData.red.imageData } },
        resolutions: {
          "1": imageData.red.url,
          "2": browser.runtime.getURL("data/a.png"), } },

      // A path or ImageData object by itself is treated as a 19px icon.
      { details: {
          "path": "a.png",
          "imageData": { "38": imageData.red.imageData } },
        resolutions: {
          "1": browser.runtime.getURL("data/a.png"),
          "2": imageData.red.url, } },
      { details: {
          "path": { "38": "a.png" },
          "imageData": imageData.red.imageData, },
        resolutions: {
          "1": imageData.red.url,
          "2": browser.runtime.getURL("data/a.png"), } },

      // Various resolutions
      { details: { "path": { "18": "a.png", "32": "a-x2.png" } },
        resolutions: {
          "1": browser.runtime.getURL("data/a.png"),
          "2": browser.runtime.getURL("data/a-x2.png"), } },
      { details: { "path": { "16": "16.png", "100": "100.png" } },
        resolutions: {
          "1": browser.runtime.getURL("data/100.png"),
          "2": browser.runtime.getURL("data/100.png"), } },
      { details: { "path": { "2": "2.png"} },
        resolutions: {
          "1": browser.runtime.getURL("data/2.png"),
          "2": browser.runtime.getURL("data/2.png"), } },
      { details: { "path": {
        "6": "6.png",
        "18": "18.png",
        "32": "32.png",
        "48": "48.png",
        "128": "128.png" } },
        resolutions: {
          "1": browser.runtime.getURL("data/18.png"),
          "2": browser.runtime.getURL("data/48.png"), } },
    ];

    // Allow serializing ImageData objects for logging.
    ImageData.prototype.toJSON = () => "<ImageData>";

    let tabId;

    browser.test.onMessage.addListener((msg, test) => {
      if (msg != "setIcon") {
        browser.test.fail("expecting 'setIcon' message");
      }

      let details = iconDetails[test.index];
      let expectedURL = details.resolutions[test.resolution];

      let detailString = JSON.stringify(details);
      browser.test.log(`Setting browerAction/pageAction to ${detailString} expecting URL ${expectedURL}`);

      browser.browserAction.setIcon(Object.assign({tabId}, details.details));
      browser.pageAction.setIcon(Object.assign({tabId}, details.details));

      browser.test.sendMessage("imageURL", expectedURL);
    });

    // Generate a list of tests and resolutions to send back to the test
    // context.
    //
    // This process is a bit convoluted, because the outer test context needs
    // to handle checking the button nodes and changing the screen resolution,
    // but it can't pass us icon definitions with ImageData objects. This
    // shouldn't be a problem, since structured clones should handle ImageData
    // objects without issue. Unfortunately, |cloneInto| implements a slightly
    // different algorithm than we use in web APIs, and does not handle them
    // correctly.
    let tests = [];
    for (let [idx, icon] of iconDetails.entries()) {
      for (let res of Object.keys(icon.resolutions)) {
        tests.push({ index: idx, resolution: Number(res) });
      }
    }

    // Sort by resolution, so we don't needlessly switch back and forth
    // between each test.
    tests.sort(test => test.resolution);

    browser.tabs.query({ active: true, currentWindow: true }, tabs => {
      tabId = tabs[0].id;
      browser.pageAction.show(tabId);

      browser.test.sendMessage("ready", tests);
    });
  }

  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      "browser_action": {},
      "page_action": {},
      "background": {
        "page": "data/background.html",
      }
    },

    files: {
      "data/background.html": `<script src="background.js"></script>`,
      "data/background.js": background,
    },
  });

  const RESOLUTION_PREF = "layout.css.devPixelsPerPx";
  registerCleanupFunction(() => {
    SpecialPowers.clearUserPref(RESOLUTION_PREF);
  });

  let browserActionId = makeWidgetId(extension.id) + "-browser-action";
  let pageActionId = makeWidgetId(extension.id) + "-page-action";

  let [, tests] = yield Promise.all([extension.startup(), extension.awaitMessage("ready")]);

  for (let test of tests) {
    SpecialPowers.setCharPref(RESOLUTION_PREF, String(test.resolution));
    is(window.devicePixelRatio, test.resolution, "window has the required resolution");

    extension.sendMessage("setIcon", test);

    let imageURL = yield extension.awaitMessage("imageURL");

    let browserActionButton = document.getElementById(browserActionId);
    is(browserActionButton.getAttribute("image"), imageURL, "browser action has the correct image");

    let pageActionImage = document.getElementById(pageActionId);
    is(pageActionImage.src, imageURL, "page action has the correct image");
  }

  yield extension.unload();
});

// Test that an error is thrown when providing invalid icon sizes
add_task(function* testInvalidIconSizes() {
  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      "browser_action": {},
      "page_action": {},
    },

    background: function() {
      browser.tabs.query({ active: true, currentWindow: true }, tabs => {
        let tabId = tabs[0].id;

        for (let api of ["pageAction", "browserAction"]) {
          // helper function to run setIcon and check if it fails
          let assertSetIconThrows = function(detail, error, message) {
            try {
              detail.tabId = tabId;
              browser[api].setIcon(detail);

              browser.test.fail("Expected an error on invalid icon size.");
              browser.test.notifyFail("setIcon with invalid icon size");
              return;
            } catch (e) {
              browser.test.succeed("setIcon with invalid icon size");
            }
          };

          // test invalid icon size inputs
          for (let type of ["path", "imageData"]) {
            assertSetIconThrows({ [type]: { "abcdef": "test.png" } });
            assertSetIconThrows({ [type]: { "48px": "test.png" } });
            assertSetIconThrows({ [type]: { "20.5": "test.png" } });
            assertSetIconThrows({ [type]: { "5.0": "test.png" } });
            assertSetIconThrows({ [type]: { "-300": "test.png" } });
            assertSetIconThrows({ [type]: {
              "abc": "test.png",
              "5": "test.png"
            }});
          }

          assertSetIconThrows({ imageData: { "abcdef": "test.png" }, path: {"5": "test.png"} });
          assertSetIconThrows({ path: { "abcdef": "test.png" }, imageData: {"5": "test.png"} });
        }

        browser.test.notifyPass("setIcon with invalid icon size");
      });
    }
  });

  yield Promise.all([extension.startup(), extension.awaitFinish("setIcon with invalid icon size")]);

  yield extension.unload();
});


// Test that default icon details in the manifest.json file are handled
// correctly.
add_task(function* testDefaultDetails() {
  // TODO: Test localized variants.
  let icons = [
    "foo/bar.png",
    "/foo/bar.png",
    { "19": "foo/bar.png" },
    { "38": "foo/bar.png" },
    { "19": "foo/bar.png", "38": "baz/quux.png" },
  ];

  let expectedURL = new RegExp(String.raw`^moz-extension://[^/]+/foo/bar\.png$`);

  for (let icon of icons) {
    let extension = ExtensionTestUtils.loadExtension({
      manifest: {
        "browser_action": { "default_icon": icon },
        "page_action": { "default_icon": icon },
      },

      background: function() {
        browser.tabs.query({ active: true, currentWindow: true }, tabs => {
          let tabId = tabs[0].id;

          browser.pageAction.show(tabId);
          browser.test.sendMessage("ready");
        });
      }
    });

    yield Promise.all([extension.startup(), extension.awaitMessage("ready")]);

    let browserActionId = makeWidgetId(extension.id) + "-browser-action";
    let pageActionId = makeWidgetId(extension.id) + "-page-action";

    let browserActionButton = document.getElementById(browserActionId);
    let image = browserActionButton.getAttribute("image");

    ok(expectedURL.test(image), `browser action image ${image} matches ${expectedURL}`);

    let pageActionImage = document.getElementById(pageActionId);
    image = pageActionImage.src;

    ok(expectedURL.test(image), `page action image ${image} matches ${expectedURL}`);

    yield extension.unload();

    let node = document.getElementById(pageActionId);
    is(node, undefined, "pageAction image removed from document");
  }
});


// Check that attempts to load a privileged URL as an icon image fail.
add_task(function* testSecureURLsDenied() {
  // Test URLs passed to setIcon.

  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      "browser_action": {},
      "page_action": {},
    },

    background: function() {
      browser.tabs.query({ active: true, currentWindow: true }, tabs => {
        let tabId = tabs[0].id;

        let urls = ["chrome://browser/content/browser.xul",
                    "javascript:true"];

        for (let url of urls) {
          for (let api of ["pageAction", "browserAction"]) {
            try {
              browser[api].setIcon({tabId, path: url});

              browser.test.fail(`Load of '${url}' succeeded. Expected failure.`);
              browser.test.notifyFail("setIcon security tests");
              return;
            } catch (e) {
              // We can't actually inspect the error here, since the
              // error object belongs to the privileged scope of the API,
              // rather than to the extension scope that calls into it.
              // Just assume it's the expected security error, for now.
              browser.test.succeed(`Load of '${url}' failed. Expected failure.`);
            }
          }
        }

        browser.test.notifyPass("setIcon security tests");
      });
    },
  });

  yield extension.startup();

  yield extension.awaitFinish("setIcon security tests");
  yield extension.unload();


  // Test URLs included in the manifest.

  let urls = ["chrome://browser/content/browser.xul",
              "javascript:true"];

  let matchURLForbidden = url => ({
    message: new RegExp(`Loading extension.*Invalid icon data: NS_ERROR_DOM_BAD_URI`),
  });

  // Because the underlying method throws an error on invalid data,
  // only the first invalid URL of each component will be logged.
  let messages = [matchURLForbidden(urls[0]),
                  matchURLForbidden(urls[1])];

  let waitForConsole = new Promise(resolve => {
    // Not necessary in browser-chrome tests, but monitorConsole gripes
    // if we don't call it.
    SimpleTest.waitForExplicitFinish();

    SimpleTest.monitorConsole(resolve, messages);
  });

  extension = ExtensionTestUtils.loadExtension({
    manifest: {
      "browser_action": {
        "default_icon": {
          "19": urls[0],
          "38": urls[1],
        },
      },
      "page_action": {
        "default_icon": {
          "19": urls[1],
          "38": urls[0],
        },
      },
    },
  });

  yield extension.startup();
  yield extension.unload();

  SimpleTest.endMonitorConsole();
  yield waitForConsole;
});
